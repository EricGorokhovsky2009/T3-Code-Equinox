import { useEffect } from "react";

import { dispatchAppshotRequest } from "../../appshotRequestBus";
import { useClientSettings } from "../../hooks/useSettings";
import { toastManager } from "../ui/toast";

export function AppshotController() {
  const enabled = useClientSettings((settings) => settings.appshotsEnabled);
  const shortcut = useClientSettings((settings) => settings.appshotShortcut);

  useEffect(() => {
    const appshots = window.desktopBridge?.appshots;
    if (!appshots) return;
    void appshots.configureShortcut({ enabled, shortcut }).then((status) => {
      if (!status.error) return;
      toastManager.add({
        type: "error",
        title: "Appshot shortcut is unavailable",
        description:
          status.error === "conflict"
            ? "Another app is already using this shortcut. Choose a different one in Settings → Appshots."
            : status.error === "invalid-shortcut"
              ? "Choose a shortcut with at least one modifier and one non-modifier key."
              : "Global Appshots are available only in the macOS desktop app.",
      });
    });
  }, [enabled, shortcut]);

  useEffect(() => {
    const appshots = window.desktopBridge?.appshots;
    if (!appshots) return;
    return appshots.onRequested((target) => {
      if (dispatchAppshotRequest(target)) return;
      toastManager.add({
        type: "warning",
        title: "Open a task before capturing an Appshot",
        description: `${target.appName} was not captured.`,
      });
    });
  }, []);

  return null;
}
