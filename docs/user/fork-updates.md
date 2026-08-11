# Syncing this T3 Code fork

This macOS build updates from source instead of downloading official T3 Code release binaries.

The app checks `pingdotgg/t3code` for new commits automatically. When the sidebar shows **Sync
With T3 Code**, select it. T3 Code then:

1. verifies that the local checkout is `EricGorokhovsky2009/T3-Code-Equinox` with
   `pingdotgg/t3code` configured as `upstream`;
2. rebases the Equinox commits onto `upstream/main` without combining them;
3. builds and locally signs a new Apple Silicon `T3 Code (Equinox).app`;
4. updates the fork's `main` with lease protection while preserving its intentional commit boundaries; and
5. offers **Restart & Install** to replace `/Applications/T3 Code (Equinox).app`.

The updater never deletes `~/.t3` or the app's Application Support data.

If Git reports synchronization conflicts, the app leaves the rebase in place and immediately opens
a dedicated chat task for the local Equinox source project. That task receives the repository path,
target upstream commit, conflicted files, and the requirements needed to preserve both upstream and
Equinox behavior. Settings continues to show the conflict state while the task resolves and verifies
the interrupted rebase. If the source project or a coding provider is unavailable, the app reports
that instead of silently losing the conflict. The updater never resets, combines, or discards custom
changes.

Settings → About shows the fork repository and the local/upstream commit IDs used by the update
check.
