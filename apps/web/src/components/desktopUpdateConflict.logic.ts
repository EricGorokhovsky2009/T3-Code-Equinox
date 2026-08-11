import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { EnvironmentId, ThreadId, type DesktopUpdateState } from "@t3tools/contracts";

const DISPATCH_STORAGE_KEY = "t3code.desktop-update-conflict:v1";

export interface DesktopUpdateConflictDescriptor {
  readonly signature: string;
  readonly repositoryPath: string;
  readonly upstreamCommit: string | null;
  readonly conflictFiles: ReadonlyArray<string>;
  readonly title: string;
  readonly prompt: string;
}

export interface DesktopUpdateConflictDispatchRecord {
  readonly signature: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

type ConflictState = Pick<
  DesktopUpdateState,
  "updateKind" | "status" | "sourceRepositoryPath" | "sourceUpstreamCommit" | "sourceConflictFiles"
>;

export function resolveDesktopUpdateConflict(
  state: ConflictState | null,
): DesktopUpdateConflictDescriptor | null {
  if (state?.updateKind !== "source" || state.status !== "error") return null;

  const repositoryPath = state.sourceRepositoryPath?.trim();
  const conflictFiles = [...new Set(state.sourceConflictFiles?.map((path) => path.trim()) ?? [])]
    .filter(Boolean)
    .toSorted();
  if (!repositoryPath || conflictFiles.length === 0) return null;

  const upstreamCommit = state.sourceUpstreamCommit?.trim() || null;
  const signature = JSON.stringify([repositoryPath, upstreamCommit, conflictFiles]);
  const shortUpstream = upstreamCommit?.slice(0, 12) ?? "upstream";
  const title = `Resolve Equinox update conflicts (${shortUpstream})`;
  const conflictList = conflictFiles.map((path) => `- ${path}`).join("\n");

  return {
    signature,
    repositoryPath,
    upstreamCommit,
    conflictFiles,
    title,
    prompt: [
      "Resolve the interrupted upstream rebase for the T3 Code Equinox fork and finish the update.",
      "",
      `Repository: ${repositoryPath}`,
      upstreamCommit ? `Target upstream commit: ${upstreamCommit}` : null,
      "",
      "The rebase is already in progress. Inspect its exact state and resolve every conflict by integrating current upstream behavior with all Equinox functionality; do not choose either side wholesale and do not abort or restart the rebase.",
      "",
      "Requirements:",
      "- Follow the repository AGENTS.md and preserve unrelated user work.",
      "- Preserve Equinox identity, artwork, source updates, Alpha/Nightly tracks, T3 Connect build configuration, and shared ~/.t3 runtime state.",
      "- Do not restore the live-token display or alter assets/equinox/concept-sheets or assets/equinox/variants.",
      "- Check every affected entry point and reverse state, including Settings, both sidebar implementations, the macOS application menu, local/remote connections, contracts, tests, and user documentation.",
      "- Use Bun for the updater/build path. Run focused tests only; do not run the repository-wide suite.",
      "- Continue the rebase, verify the resulting net diff, then finish the guarded fork updater flow with lease protection. Do not stop after explaining the conflicts.",
      "- Do not quit or replace the currently running app while this resolution task is active.",
      "",
      "Conflicted files:",
      conflictList,
    ]
      .filter((line): line is string => line !== null)
      .join("\n"),
  };
}

export function findDesktopUpdateSourceProject<
  Project extends Pick<EnvironmentProject, "environmentId" | "workspaceRoot">,
>(
  projects: ReadonlyArray<Project>,
  primaryEnvironmentId: EnvironmentId | null,
  repositoryPath: string,
): Project | null {
  if (primaryEnvironmentId === null) return null;
  return (
    projects.find(
      (project) =>
        project.environmentId === primaryEnvironmentId && project.workspaceRoot === repositoryPath,
    ) ?? null
  );
}

export function readDesktopUpdateConflictDispatch(
  storage: Pick<Storage, "getItem">,
): DesktopUpdateConflictDispatchRecord | null {
  try {
    const raw = storage.getItem(DISPATCH_STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (
      typeof record.signature !== "string" ||
      typeof record.environmentId !== "string" ||
      typeof record.threadId !== "string"
    ) {
      return null;
    }
    return {
      signature: record.signature,
      environmentId: EnvironmentId.make(record.environmentId),
      threadId: ThreadId.make(record.threadId),
    };
  } catch {
    return null;
  }
}

export function writeDesktopUpdateConflictDispatch(
  storage: Pick<Storage, "setItem">,
  record: DesktopUpdateConflictDispatchRecord,
): void {
  try {
    storage.setItem(DISPATCH_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Storage can be unavailable or full. The in-memory guard still prevents
    // duplicate dispatches for the lifetime of this renderer.
  }
}
