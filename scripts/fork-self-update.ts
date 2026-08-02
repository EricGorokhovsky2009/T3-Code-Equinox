#!/usr/bin/env bun
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalTimers:off - Host-side fork updater performs guarded Git, build, and macOS bundle replacement operations.

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const EXPECTED_ORIGIN = "github.com/EricGorokhovsky2009/T3-Code-Equinox";
const EXPECTED_UPSTREAM = "github.com/pingdotgg/t3code";
const EXPECTED_BRANCH = "main";
const FORK_DISPLAY_NAME = "T3 Code (Equinox)";
const EXPECTED_APP_NAME = `${FORK_DISPLAY_NAME}.app`;
const FORK_COMMIT_TITLE = "Adding Fork Functionality";
const FORK_COMMIT_BODY = `Add the Equinox desktop identity and artwork, source-based personal updates, official Alpha and Nightly track builds, guarded upstream synchronization, progress reporting, conflict recovery, stable local signing, and safe in-place app replacement.`;
const REPLACEABLE_APP_NAMES = new Set([
  EXPECTED_APP_NAME,
  "T3 Code.app",
  "T3 Code (Alpha).app",
  "T3 Code (Nightly).app",
]);

type CommandResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

class ForkUpdateError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function reportProgress(percent: number) {
  console.log(JSON.stringify({ event: "download-progress", percent }));
}

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function requireFlag(name: string): string {
  const value = readFlag(name)?.trim();
  if (!value) {
    throw new ForkUpdateError("missing-argument", `Missing required argument ${name}.`);
  }
  return value;
}

async function run(
  command: string,
  args: readonly string[],
  options: {
    readonly cwd?: string;
    readonly env?: Record<string, string | undefined>;
    readonly inherit?: boolean;
  } = {},
): Promise<CommandResult> {
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env as NodeJS.ProcessEnv | undefined,
    stdio: options.inherit ? ["ignore", "inherit", "inherit"] : ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolveExit(code ?? 1));
  });
  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
}

async function git(repoPath: string, args: readonly string[], allowFailure = false) {
  const result = await run("git", args, { cwd: repoPath });
  if (!allowFailure && result.exitCode !== 0) {
    throw new ForkUpdateError(
      "git-command-failed",
      result.stderr || result.stdout || `git ${args[0] ?? ""} failed.`,
      { args, exitCode: result.exitCode },
    );
  }
  return result;
}

function normalizeGitHubRemote(value: string): string {
  return value
    .trim()
    .replace(/^git@github\.com:/, "github.com/")
    .replace(/^ssh:\/\/git@github\.com\//, "github.com/")
    .replace(/^https?:\/\/github\.com\//, "github.com/")
    .replace(/\.git$/, "")
    .toLowerCase();
}

async function resolveRepository(inputPath: string): Promise<string> {
  const repoPath = await realpath(resolve(inputPath));
  if (!existsSync(join(repoPath, ".git"))) {
    throw new ForkUpdateError("not-a-checkout", `${repoPath} is not a Git checkout.`);
  }

  const [origin, upstream, branch] = await Promise.all([
    git(repoPath, ["remote", "get-url", "origin"]),
    git(repoPath, ["remote", "get-url", "upstream"]),
    git(repoPath, ["branch", "--show-current"]),
  ]);
  if (normalizeGitHubRemote(origin.stdout) !== EXPECTED_ORIGIN.toLowerCase()) {
    throw new ForkUpdateError("wrong-origin", "The source checkout is not your T3 Code fork.", {
      actual: origin.stdout,
      expected: EXPECTED_ORIGIN,
    });
  }
  if (normalizeGitHubRemote(upstream.stdout) !== EXPECTED_UPSTREAM.toLowerCase()) {
    throw new ForkUpdateError(
      "wrong-upstream",
      "The source checkout is not tracking official T3 Code.",
      {
        actual: upstream.stdout,
        expected: EXPECTED_UPSTREAM,
      },
    );
  }
  if (branch.stdout !== EXPECTED_BRANCH) {
    throw new ForkUpdateError(
      "wrong-branch",
      `Fork updates require the ${EXPECTED_BRANCH} branch; currently on ${branch.stdout || "detached HEAD"}.`,
    );
  }
  return repoPath;
}

async function inspect(repoPath: string, fetch: boolean) {
  if (fetch) {
    await git(repoPath, ["fetch", "--prune", "upstream", EXPECTED_BRANCH]);
  }
  const [current, upstream, behind, ahead, status] = await Promise.all([
    git(repoPath, ["rev-parse", "HEAD"]),
    git(repoPath, ["rev-parse", `upstream/${EXPECTED_BRANCH}`]),
    git(repoPath, ["rev-list", "--count", `HEAD..upstream/${EXPECTED_BRANCH}`]),
    git(repoPath, ["rev-list", "--count", `upstream/${EXPECTED_BRANCH}..HEAD`]),
    git(repoPath, ["status", "--porcelain=v1", "--untracked-files=normal"]),
  ]);
  const installedCommit = await readFile(
    join(repoPath, ".t3", "fork-updater", "installed-commit"),
    "utf8",
  )
    .then((value) => value.trim())
    .catch(() => "");
  const installedTrack = await readFile(
    join(repoPath, ".t3", "fork-updater", "installed-track"),
    "utf8",
  )
    .then((value) => value.trim())
    .catch(() => "unknown");
  const dirtyEntries = status.stdout.length === 0 ? [] : status.stdout.split("\n");
  const trackedDirtyEntries = dirtyEntries.filter((entry) => !entry.startsWith("?? "));
  const sourceBuildPending = installedCommit !== current.stdout || installedTrack !== "equinox";
  return {
    status: Number(behind.stdout) > 0 || sourceBuildPending ? "available" : "up-to-date",
    repositoryPath: repoPath,
    currentCommit: current.stdout,
    upstreamCommit: upstream.stdout,
    behindCount: Number(behind.stdout),
    aheadCount: Number(ahead.stdout),
    sourceBuildPending,
    installedTrack,
    dirty: trackedDirtyEntries.length > 0,
    dirtyEntries,
  } as const;
}

async function findAppBundle(root: string, expectedAppName = EXPECTED_APP_NAME): Promise<string> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory() && entry.name === expectedAppName) {
      return path;
    }
    if (entry.isDirectory()) {
      try {
        return await findAppBundle(path, expectedAppName);
      } catch (error) {
        if (!(error instanceof ForkUpdateError && error.code === "app-not-produced")) throw error;
      }
    }
  }
  throw new ForkUpdateError("app-not-produced", `The build did not produce ${expectedAppName}.`);
}

async function verifyForkBundle(appPath: string, repoPath: string) {
  if (!REPLACEABLE_APP_NAMES.has(basename(appPath))) {
    throw new ForkUpdateError("wrong-app-name", "The build must use a known T3 Code app name.");
  }
  const packageArchive = await readFile(join(appPath, "Contents", "Resources", "app.asar"));
  const sourceRepositoryKey = Buffer.from('"t3codeForkSourceRepository"');
  const sourceRepositoryPath = Buffer.from(repoPath);
  if (
    !packageArchive.includes(sourceRepositoryKey) ||
    !packageArchive.includes(sourceRepositoryPath)
  ) {
    throw new ForkUpdateError(
      "missing-fork-identity",
      "The built app does not contain this fork checkout's embedded identity.",
    );
  }
  const signature = await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath]);
  if (signature.exitCode !== 0) {
    throw new ForkUpdateError(
      "invalid-app-signature",
      signature.stderr || "The built app has an invalid local signature.",
    );
  }
}

async function resolveLocalCodeSigningIdentity(): Promise<string> {
  const configuredIdentity = process.env.T3CODE_FORK_CODESIGN_IDENTITY?.trim();
  if (configuredIdentity) return configuredIdentity;

  const identities = await run("/usr/bin/security", ["find-identity", "-p", "codesigning", "-v"]);
  if (identities.exitCode !== 0) return "-";

  const identityHash = identities.stdout.match(/^\s*\d+\)\s+([0-9A-F]{40})\s+"/mu)?.[1];
  return identityHash ?? "-";
}

async function build(
  repoPath: string,
  commit: string,
  sourceRepository = repoPath,
  outputRoot = repoPath,
  version?: string,
  displayName = FORK_DISPLAY_NAME,
): Promise<string> {
  reportProgress(20);
  const buildRoot = join(outputRoot, ".t3", "fork-updater", `build-${commit.slice(0, 12)}`);
  await rm(buildRoot, { recursive: true, force: true });
  await mkdir(buildRoot, { recursive: true });

  const install = await run("vp", ["i", "--frozen-lockfile"], {
    cwd: repoPath,
    env: process.env,
    inherit: true,
  });
  if (install.exitCode !== 0) {
    throw new ForkUpdateError("dependency-install-failed", "Dependencies could not be installed.", {
      exitCode: install.exitCode,
    });
  }
  reportProgress(40);

  const buildEnv = { ...process.env };
  const rustupBin = "/opt/homebrew/opt/rustup/bin";
  if (existsSync(rustupBin)) {
    buildEnv.PATH = `${rustupBin}:${buildEnv.PATH ?? ""}`;
  }
  delete buildEnv.GITHUB_REPOSITORY;
  buildEnv.T3CODE_DESKTOP_UPDATE_REPOSITORY = "pingdotgg/t3code";
  buildEnv.T3CODE_FORK_SOURCE_REPOSITORY = sourceRepository;
  buildEnv.T3CODE_FORK_DISPLAY_NAME = displayName;
  buildEnv.T3CODE_FORK_APP_ID = "com.t3tools.t3code.copy";
  if (version) buildEnv.T3CODE_DESKTOP_VERSION = version;

  const result = await run(
    process.execPath,
    [
      "scripts/build-desktop-artifact.ts",
      "--platform",
      "mac",
      "--target",
      "dir",
      "--arch",
      "arm64",
      "--output-dir",
      buildRoot,
    ],
    { cwd: repoPath, env: buildEnv, inherit: true },
  );
  if (result.exitCode !== 0) {
    throw new ForkUpdateError("build-failed", "The fork merged, but the macOS build failed.", {
      exitCode: result.exitCode,
    });
  }
  reportProgress(90);
  const appPath = await findAppBundle(buildRoot, `${displayName}.app`);
  await writeFile(
    join(appPath, "Contents", "Resources", "app-update.yml"),
    "provider: github\nowner: pingdotgg\nrepo: t3code\n",
  );
  const signingIdentity = await resolveLocalCodeSigningIdentity();
  const signed = await run("/usr/bin/codesign", [
    "--force",
    "--deep",
    "--timestamp=none",
    "--sign",
    signingIdentity,
    appPath,
  ]);
  if (signed.exitCode !== 0) {
    throw new ForkUpdateError(
      "app-signing-failed",
      signed.stderr || "The local app signature could not be created.",
    );
  }
  await verifyForkBundle(appPath, sourceRepository);
  reportProgress(100);
  return appPath;
}

const TRACK_OVERLAY_PATHS = [
  "apps/desktop/resources",
  "apps/desktop/src/app/DesktopClerk.ts",
  "apps/desktop/src/app/DesktopEnvironment.ts",
  "apps/desktop/src/electron/ElectronApp.ts",
  "apps/desktop/src/updates",
  "apps/web/src/components/SidebarStageBackdrop.tsx",
  "apps/web/src/components/desktopUpdate.logic.ts",
  "apps/web/src/components/settings/SettingsPanels.tsx",
  "apps/web/src/components/sidebar/SidebarUpdatePill.tsx",
  "assets/equinox",
  "packages/contracts/src/ipc.ts",
  "scripts/build-desktop-artifact.ts",
  "scripts/fork-self-update.ts",
  "scripts/lib/brand-assets.ts",
] as const;

async function resolveOfficialTrackRef(repoPath: string, track: "alpha" | "nightly") {
  await git(repoPath, ["fetch", "upstream", "--tags"]);
  const tags = await git(repoPath, ["tag", "--list", "v*", "--sort=-v:refname"]);
  const candidates = tags.stdout.split("\n").filter(Boolean);
  const match = candidates.find((tag) =>
    track === "nightly"
      ? /^v\d+\.\d+\.\d+-nightly\.\d{8}\.\d+$/.test(tag)
      : /^v\d+\.\d+\.\d+$/.test(tag),
  );
  if (!match) throw new ForkUpdateError("track-not-found", `No official ${track} tag was found.`);
  return match;
}

async function buildTrack(repoPath: string, track: "alpha" | "nightly" | "equinox") {
  reportProgress(5);
  if (track === "equinox") return update(repoPath);
  const inspected = await inspect(repoPath, true);
  const trackedDirtyEntries = inspected.dirtyEntries.filter((entry) => !entry.startsWith("?? "));
  if (trackedDirtyEntries.length > 0) {
    throw new ForkUpdateError(
      "dirty-checkout",
      "Commit or stash local source changes before switching tracks.",
      { entries: trackedDirtyEntries },
    );
  }
  const targetRef = await resolveOfficialTrackRef(repoPath, track);
  const targetCommit = (await git(repoPath, ["rev-list", "-n1", targetRef])).stdout;
  const worktreePath = join(repoPath, ".t3", "fork-updater", `track-source-${track}`);
  await git(repoPath, ["worktree", "remove", "--force", worktreePath], true);
  await rm(worktreePath, { recursive: true, force: true });
  await git(repoPath, ["worktree", "add", "--detach", worktreePath, targetRef]);
  reportProgress(10);
  const applied = await new Promise<CommandResult>((resolveRun, reject) => {
    const diff = spawn(
      "git",
      ["diff", "--binary", "upstream/main..main", "--", ...TRACK_OVERLAY_PATHS],
      { cwd: repoPath, stdio: ["ignore", "pipe", "pipe"] },
    );
    const child = spawn("git", ["apply", "--3way", "-"], {
      cwd: worktreePath,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    diff.once("error", reject);
    child.once("error", reject);
    child.once("close", (code) =>
      resolveRun({ exitCode: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() }),
    );
    diff.stdout.pipe(child.stdin);
  });
  if (applied.exitCode !== 0)
    throw new ForkUpdateError(
      "track-overlay-failed",
      applied.stderr || "Equinox shell could not be applied to the official track.",
    );
  const version = targetRef.replace(/^v/, "");
  const displayName = track === "nightly" ? "T3 Code (Nightly)" : "T3 Code (Alpha)";
  const appPath = await build(
    worktreePath,
    `${targetCommit}-${track}`,
    repoPath,
    repoPath,
    version,
    displayName,
  );
  return {
    ...inspected,
    status: "built",
    appPath,
    currentCommit: targetCommit,
    upstreamCommit: targetCommit,
    track,
    version,
  };
}

async function update(repoPath: string) {
  reportProgress(5);
  await git(repoPath, ["fetch", "--prune", "origin", EXPECTED_BRANCH]);
  const before = await inspect(repoPath, true);
  const trackedDirtyEntries = before.dirtyEntries.filter((entry) => !entry.startsWith("?? "));
  if (trackedDirtyEntries.length > 0) {
    throw new ForkUpdateError(
      "dirty-checkout",
      "Commit or stash local source changes before updating the installed app.",
      { entries: trackedDirtyEntries },
    );
  }
  if (before.behindCount === 0 && !before.sourceBuildPending) {
    return { ...before, status: "up-to-date" };
  }

  const expectedOriginCommit = (await git(repoPath, ["rev-parse", `origin/${EXPECTED_BRANCH}`]))
    .stdout;
  if (before.behindCount > 0) {
    const rebase = await git(repoPath, ["rebase", `upstream/${EXPECTED_BRANCH}`], true);
    if (rebase.exitCode !== 0) {
      const conflicts = await git(repoPath, ["diff", "--name-only", "--diff-filter=U"], true);
      return {
        ...(await inspect(repoPath, false)),
        status: "conflict",
        conflictFiles: conflicts.stdout ? conflicts.stdout.split("\n") : [],
        message: rebase.stderr || rebase.stdout || "Upstream synchronization has conflicts.",
      };
    }
  }

  const ahead = Number(
    (await git(repoPath, ["rev-list", "--count", `upstream/${EXPECTED_BRANCH}..HEAD`])).stdout,
  );
  if (ahead > 1) {
    await git(repoPath, ["reset", "--soft", `upstream/${EXPECTED_BRANCH}`]);
    await git(repoPath, ["commit", "-m", FORK_COMMIT_TITLE, "-m", FORK_COMMIT_BODY]);
  }

  reportProgress(15);

  const merged = await inspect(repoPath, false);
  const appPath = await build(repoPath, merged.currentCommit);
  const push = await git(
    repoPath,
    [
      "push",
      `--force-with-lease=${EXPECTED_BRANCH}:${expectedOriginCommit}`,
      "origin",
      EXPECTED_BRANCH,
    ],
    true,
  );
  if (push.exitCode !== 0) {
    throw new ForkUpdateError(
      "push-failed",
      "The fork built successfully, but the merged main branch could not be pushed to GitHub.",
      { stderr: push.stderr, appPath },
    );
  }
  return { ...merged, status: "built", appPath };
}

async function waitForExit(pid: number) {
  for (;;) {
    try {
      process.kill(pid, 0);
      await new Promise((resolveSleep) => {
        setTimeout(resolveSleep, 250);
      });
    } catch {
      return;
    }
  }
}

async function collectProcessTree(rootPid: number): Promise<readonly number[]> {
  const processes = await run("/bin/ps", ["-axo", "pid=,ppid="]);
  if (processes.exitCode !== 0) return [rootPid];

  const childrenByParent = new Map<number, number[]>();
  for (const line of processes.stdout.split("\n")) {
    const [pidValue, parentPidValue] = line.trim().split(/\s+/);
    const pid = Number(pidValue);
    const parentPid = Number(parentPidValue);
    if (!Number.isInteger(pid) || !Number.isInteger(parentPid)) continue;
    const children = childrenByParent.get(parentPid) ?? [];
    children.push(pid);
    childrenByParent.set(parentPid, children);
  }

  const processTree = [rootPid];
  for (let index = 0; index < processTree.length; index += 1) {
    const pid = processTree[index];
    if (pid === undefined || pid === process.pid) continue;
    processTree.push(...(childrenByParent.get(pid) ?? []));
  }
  return processTree.filter((pid) => pid !== process.pid);
}

async function install(
  builtAppInput: string,
  targetAppInput: string,
  runningPid: number,
  previousAppInput?: string,
  track: "alpha" | "nightly" | "equinox" = "equinox",
) {
  const builtApp = await realpath(resolve(builtAppInput));
  const targetApp = resolve(targetAppInput);
  const previousApp = previousAppInput ? resolve(previousAppInput) : targetApp;
  if (
    !REPLACEABLE_APP_NAMES.has(basename(builtApp)) ||
    !REPLACEABLE_APP_NAMES.has(basename(targetApp)) ||
    !REPLACEABLE_APP_NAMES.has(basename(previousApp))
  ) {
    throw new ForkUpdateError(
      "unsafe-app-target",
      "Fork installs may only replace a known T3 Code application bundle.",
    );
  }
  if (targetApp !== previousApp && existsSync(targetApp) && existsSync(previousApp)) {
    throw new ForkUpdateError(
      "ambiguous-app-target",
      "Both the fork target and the previous T3 Code app exist; refusing to choose one.",
    );
  }
  if (!builtApp.includes(`${join(".t3", "fork-updater")}/`)) {
    throw new ForkUpdateError("untrusted-build", "The app was not produced by the fork updater.");
  }
  const marker = `${join(".t3", "fork-updater")}/`;
  const repoPath = resolve(builtApp.slice(0, builtApp.indexOf(marker)));
  await resolveRepository(repoPath);
  const installedCommit = await git(repoPath, ["rev-parse", "HEAD"]);
  await verifyForkBundle(builtApp, repoPath);

  const exitingProcessTree = await collectProcessTree(runningPid);
  await Promise.all(exitingProcessTree.map(waitForExit));
  const targetDirectory = dirname(targetApp);
  const stagedApp = join(targetDirectory, `.T3 Code.update-${process.pid}.app`);
  const backupApp = join(targetDirectory, `.T3 Code.previous-${process.pid}.app`);
  await rm(stagedApp, { recursive: true, force: true });
  await rm(backupApp, { recursive: true, force: true });

  const copied = await run("/usr/bin/ditto", [builtApp, stagedApp]);
  if (copied.exitCode !== 0) {
    throw new ForkUpdateError("install-copy-failed", copied.stderr || "Could not stage the app.");
  }

  const installedApp = existsSync(targetApp) ? targetApp : previousApp;
  if (existsSync(installedApp)) {
    await rename(installedApp, backupApp);
  }
  try {
    await rename(stagedApp, targetApp);
    const opened = await run("/usr/bin/open", [targetApp]);
    if (opened.exitCode !== 0) {
      throw new ForkUpdateError("relaunch-failed", opened.stderr || "Could not relaunch T3 Code.");
    }
    const installedCommitPath = join(repoPath, ".t3", "fork-updater", "installed-commit");
    await mkdir(dirname(installedCommitPath), { recursive: true });
    await writeFile(installedCommitPath, `${installedCommit.stdout}\n`);
    await writeFile(join(repoPath, ".t3", "fork-updater", "installed-track"), `${track}\n`);
    await rm(backupApp, { recursive: true, force: true });
  } catch (error) {
    if (existsSync(backupApp) && !existsSync(targetApp)) {
      await rename(backupApp, installedApp);
    }
    throw error;
  }
  return { status: "installed", targetApp };
}

async function main() {
  const action = process.argv[2];
  if (action === "check") {
    const repoPath = await resolveRepository(requireFlag("--repo"));
    return inspect(repoPath, true);
  }
  if (action === "update") {
    const repoPath = await resolveRepository(requireFlag("--repo"));
    return update(repoPath);
  }
  if (action === "build-track") {
    const repoPath = await resolveRepository(requireFlag("--repo"));
    const track = requireFlag("--track");
    if (track !== "alpha" && track !== "nightly" && track !== "equinox") {
      throw new ForkUpdateError("invalid-track", "Expected alpha, nightly, or equinox.");
    }
    return buildTrack(repoPath, track);
  }
  if (action === "install") {
    const track = readFlag("--track") ?? "equinox";
    if (track !== "alpha" && track !== "nightly" && track !== "equinox") {
      throw new ForkUpdateError("invalid-track", "Expected alpha, nightly, or equinox.");
    }
    return install(
      requireFlag("--built-app"),
      requireFlag("--target-app"),
      Number(requireFlag("--pid")),
      readFlag("--previous-app"),
      track,
    );
  }
  throw new ForkUpdateError("unknown-action", "Expected check, update, build-track, or install.");
}

try {
  console.log(JSON.stringify(await main()));
} catch (error) {
  const failure =
    error instanceof ForkUpdateError
      ? { status: "error", code: error.code, message: error.message, ...error.details }
      : {
          status: "error",
          code: "unexpected",
          message: error instanceof Error ? error.message : String(error),
        };
  console.log(JSON.stringify(failure));
  process.exitCode = 1;
}
