#!/usr/bin/env bun
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalTimers:off - Host-side fork updater performs guarded Git, build, and macOS bundle replacement operations.

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const EXPECTED_ORIGIN = "github.com/EricGorokhovsky2009/T3Code";
const EXPECTED_UPSTREAM = "github.com/pingdotgg/t3code";
const EXPECTED_BRANCH = "main";
const EXPECTED_APP_NAME = "T3 Code.app";
const REPLACEABLE_APP_NAMES = new Set([
  EXPECTED_APP_NAME,
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
  return {
    status: Number(behind.stdout) > 0 ? "available" : "up-to-date",
    repositoryPath: repoPath,
    currentCommit: current.stdout,
    upstreamCommit: upstream.stdout,
    behindCount: Number(behind.stdout),
    aheadCount: Number(ahead.stdout),
    dirty: status.stdout.length > 0,
    dirtyEntries: status.stdout.length === 0 ? [] : status.stdout.split("\n"),
  } as const;
}

async function findAppBundle(root: string): Promise<string> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory() && entry.name === EXPECTED_APP_NAME) {
      return path;
    }
    if (entry.isDirectory()) {
      try {
        return await findAppBundle(path);
      } catch (error) {
        if (!(error instanceof ForkUpdateError && error.code === "app-not-produced")) throw error;
      }
    }
  }
  throw new ForkUpdateError("app-not-produced", `The build did not produce ${EXPECTED_APP_NAME}.`);
}

async function verifyForkBundle(appPath: string, repoPath: string) {
  if (basename(appPath) !== EXPECTED_APP_NAME) {
    throw new ForkUpdateError("wrong-app-name", `The build must be named ${EXPECTED_APP_NAME}.`);
  }
  const packageArchive = await readFile(join(appPath, "Contents", "Resources", "app.asar"));
  const embeddedIdentity = `"t3codeForkSourceRepository":"${repoPath}"`;
  if (!packageArchive.includes(Buffer.from(embeddedIdentity))) {
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

async function build(repoPath: string, commit: string): Promise<string> {
  const buildRoot = join(repoPath, ".t3", "fork-updater", `build-${commit.slice(0, 12)}`);
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

  const buildEnv = { ...process.env };
  const rustupBin = "/opt/homebrew/opt/rustup/bin";
  if (existsSync(rustupBin)) {
    buildEnv.PATH = `${rustupBin}:${buildEnv.PATH ?? ""}`;
  }
  delete buildEnv.GITHUB_REPOSITORY;
  delete buildEnv.T3CODE_DESKTOP_UPDATE_REPOSITORY;
  buildEnv.T3CODE_FORK_SOURCE_REPOSITORY = repoPath;
  buildEnv.T3CODE_FORK_DISPLAY_NAME = "T3 Code";

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
  const appPath = await findAppBundle(buildRoot);
  const signed = await run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", appPath]);
  if (signed.exitCode !== 0) {
    throw new ForkUpdateError(
      "app-signing-failed",
      signed.stderr || "The local app signature could not be created.",
    );
  }
  await verifyForkBundle(appPath, repoPath);
  return appPath;
}

async function update(repoPath: string) {
  const before = await inspect(repoPath, true);
  if (before.dirty) {
    throw new ForkUpdateError(
      "dirty-checkout",
      "Commit or stash local source changes before updating the installed app.",
      { entries: before.dirtyEntries },
    );
  }
  if (before.behindCount === 0) {
    return { ...before, status: "up-to-date" };
  }

  const merge = await git(repoPath, ["merge", "--no-edit", `upstream/${EXPECTED_BRANCH}`], true);
  if (merge.exitCode !== 0) {
    const conflicts = await git(repoPath, ["diff", "--name-only", "--diff-filter=U"], true);
    return {
      ...(await inspect(repoPath, false)),
      status: "conflict",
      conflictFiles: conflicts.stdout ? conflicts.stdout.split("\n") : [],
      message: merge.stderr || merge.stdout || "Upstream merge has conflicts.",
    };
  }

  const merged = await inspect(repoPath, false);
  const appPath = await build(repoPath, merged.currentCommit);
  const push = await git(repoPath, ["push", "origin", EXPECTED_BRANCH], true);
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

async function install(
  builtAppInput: string,
  targetAppInput: string,
  runningPid: number,
  previousAppInput?: string,
) {
  const builtApp = await realpath(resolve(builtAppInput));
  const targetApp = resolve(targetAppInput);
  const previousApp = previousAppInput ? resolve(previousAppInput) : targetApp;
  if (
    basename(builtApp) !== EXPECTED_APP_NAME ||
    basename(targetApp) !== EXPECTED_APP_NAME ||
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
  const repoPath = builtApp.slice(0, builtApp.indexOf(marker));
  await resolveRepository(repoPath);
  await verifyForkBundle(builtApp, repoPath);

  await waitForExit(runningPid);
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
  if (action === "install") {
    return install(
      requireFlag("--built-app"),
      requireFlag("--target-app"),
      Number(requireFlag("--pid")),
      readFlag("--previous-app"),
    );
  }
  throw new ForkUpdateError("unknown-action", "Expected check, update, or install.");
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
