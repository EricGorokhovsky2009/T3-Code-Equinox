import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  findDesktopUpdateSourceProject,
  readDesktopUpdateConflictDispatch,
  resolveDesktopUpdateConflict,
  writeDesktopUpdateConflictDispatch,
} from "./desktopUpdateConflict.logic";

const PRIMARY_ENVIRONMENT_ID = EnvironmentId.make("primary-environment");
const REMOTE_ENVIRONMENT_ID = EnvironmentId.make("remote-environment");

describe("resolveDesktopUpdateConflict", () => {
  it("returns a stable task for a source conflict", () => {
    const first = resolveDesktopUpdateConflict({
      updateKind: "source",
      status: "error",
      sourceRepositoryPath: "/repo/equinox",
      sourceUpstreamCommit: "1234567890abcdef",
      sourceConflictFiles: ["b.ts", "a.ts", "b.ts"],
    });
    const second = resolveDesktopUpdateConflict({
      updateKind: "source",
      status: "error",
      sourceRepositoryPath: "/repo/equinox",
      sourceUpstreamCommit: "1234567890abcdef",
      sourceConflictFiles: ["a.ts", "b.ts"],
    });

    expect(first).not.toBeNull();
    expect(first?.signature).toBe(second?.signature);
    expect(first?.conflictFiles).toEqual(["a.ts", "b.ts"]);
    expect(first?.title).toContain("1234567890ab");
    expect(first?.prompt).toContain("The rebase is already in progress");
    expect(first?.prompt).toContain("- a.ts\n- b.ts");
    expect(first?.prompt).toContain("Do not stop after explaining the conflicts");
  });

  it("ignores release errors and incomplete source conflict states", () => {
    expect(
      resolveDesktopUpdateConflict({
        updateKind: "release",
        status: "error",
        sourceRepositoryPath: "/repo/equinox",
        sourceUpstreamCommit: null,
        sourceConflictFiles: ["a.ts"],
      }),
    ).toBeNull();
    expect(
      resolveDesktopUpdateConflict({
        updateKind: "source",
        status: "error",
        sourceRepositoryPath: "/repo/equinox",
        sourceUpstreamCommit: null,
        sourceConflictFiles: [],
      }),
    ).toBeNull();
  });
});

describe("findDesktopUpdateSourceProject", () => {
  it("selects the primary-environment checkout instead of a remote path duplicate", () => {
    const remote = {
      environmentId: REMOTE_ENVIRONMENT_ID,
      workspaceRoot: "/repo/equinox",
      marker: "remote",
    };
    const primary = {
      environmentId: PRIMARY_ENVIRONMENT_ID,
      workspaceRoot: "/repo/equinox",
      marker: "primary",
    };

    expect(
      findDesktopUpdateSourceProject([remote, primary], PRIMARY_ENVIRONMENT_ID, "/repo/equinox"),
    ).toBe(primary);
    expect(findDesktopUpdateSourceProject([remote], PRIMARY_ENVIRONMENT_ID, "/repo/equinox")).toBe(
      null,
    );
  });
});

describe("desktop update conflict dispatch storage", () => {
  it("round-trips only the minimal versioned dispatch record", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const record = {
      signature: "signature",
      environmentId: PRIMARY_ENVIRONMENT_ID,
      threadId: ThreadId.make("thread-id"),
    };

    writeDesktopUpdateConflictDispatch(storage, record);

    expect([...values.keys()]).toEqual(["t3code.desktop-update-conflict:v1"]);
    expect(readDesktopUpdateConflictDispatch(storage)).toEqual(record);
  });

  it("treats unavailable or malformed storage as empty", () => {
    expect(
      readDesktopUpdateConflictDispatch({
        getItem: () => "not-json",
      }),
    ).toBeNull();
    expect(
      readDesktopUpdateConflictDispatch({
        getItem: () => {
          throw new Error("storage unavailable");
        },
      }),
    ).toBeNull();
  });
});
