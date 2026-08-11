import { describe, expect, it } from "vite-plus/test";

import {
  findMissingConnectPublicConfig,
  listTrackedDirtyEntries,
  normalizeGitHubRemote,
  TRACK_OVERLAY_PATHS,
} from "./fork-self-update.ts";

describe("fork self updater guards", () => {
  it.each([
    "https://github.com/EricGorokhovsky2009/T3-Code-Equinox.git",
    "git@github.com:EricGorokhovsky2009/T3-Code-Equinox.git",
    "ssh://git@github.com/EricGorokhovsky2009/T3-Code-Equinox.git",
  ])("normalizes supported GitHub remote forms", (remote) => {
    expect(normalizeGitHubRemote(remote)).toBe("github.com/ericgorokhovsky2009/t3-code-equinox");
  });

  it("allows preserved untracked artwork while refusing tracked source changes", () => {
    expect(
      listTrackedDirtyEntries([
        " M apps/web/src/App.tsx",
        "?? assets/equinox/concept-sheets/",
        "?? assets/equinox/variants/",
      ]),
    ).toEqual([" M apps/web/src/App.tsx"]);
  });

  it("fails closed when any required public T3 Connect value is missing", () => {
    expect(
      findMissingConnectPublicConfig({
        T3CODE_CLERK_PUBLISHABLE_KEY: "pk_test",
        T3CODE_CLERK_JWT_TEMPLATE: "template",
        T3CODE_RELAY_URL: "https://relay.example.test",
      }),
    ).toEqual(["T3CODE_CLERK_CLI_OAUTH_CLIENT_ID"]);
    expect(
      findMissingConnectPublicConfig({
        T3CODE_CLERK_PUBLISHABLE_KEY: "pk_test",
        T3CODE_CLERK_JWT_TEMPLATE: "template",
        T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: "oauth-client",
        T3CODE_RELAY_URL: "https://relay.example.test",
      }),
    ).toEqual([]);
  });

  it("carries root conflict routing into Alpha and Nightly overlay builds", () => {
    expect(TRACK_OVERLAY_PATHS).toEqual(
      expect.arrayContaining([
        "apps/web/src/components/DesktopUpdateConflictDispatcher.tsx",
        "apps/web/src/components/desktopUpdateConflict.logic.ts",
        "apps/web/src/environments/primary/auth.ts",
        "apps/web/src/routes/__root.tsx",
      ]),
    );
  });
});
