# Updating this T3 Code fork

This macOS build updates from source instead of downloading official T3 Code release binaries.

The app checks `pingdotgg/t3code` for new commits automatically. When the sidebar shows **Fork
update available**, select **Update Fork**. T3 Code then:

1. verifies that the local checkout is `EricGorokhovsky2009/t3code` with
   `pingdotgg/t3code` configured as `upstream`;
2. merges `upstream/main` into the fork's local `main`;
3. builds and locally signs a new Apple Silicon `T3 Code.app`;
4. pushes the merged `main` branch to the GitHub fork; and
5. offers **Restart & Install** to replace `/Applications/T3 Code.app`.

The updater never deletes `~/.t3` or the app's Application Support data.

If Git reports merge conflicts, the app leaves the merge in place and shows **Fix with AI** in
Settings. That starts a thread in the source checkout with the conflicted files and resolution
instructions already filled in. The updater never resets or discards custom changes.

Settings → About shows the fork repository and the local/upstream commit IDs used by the update
check.
