import type { DesktopAppshotStatus } from "@t3tools/contracts";
import { DEFAULT_APPSHOT_SHORTCUT } from "@t3tools/contracts/settings";
import { CameraIcon, CheckCircle2Icon, ShieldCheckIcon, ShieldAlertIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

function statusCopy(status: DesktopAppshotStatus | null, desktopAvailable = true): string {
  if (!desktopAvailable || status?.available === false) {
    return "Appshots are available only in the macOS desktop app.";
  }
  if (!status) return "Checking desktop permissions…";
  if (status.error === "conflict") return "This shortcut is already registered by another app.";
  if (status.error === "invalid-shortcut")
    return "Choose Option Option or a valid key combination.";
  if (!status.enabled) return "Global capture is disabled.";
  if (!status.registered) return "The global shortcut is not registered.";
  return "The global shortcut is active.";
}

function eventToAccelerator(event: React.KeyboardEvent<HTMLInputElement>): string | null {
  const modifierKeys = new Set(["Meta", "Control", "Alt", "Shift"]);
  if (modifierKeys.has(event.key)) return null;
  const parts: string[] = [];
  if (event.metaKey) parts.push("Command");
  if (event.ctrlKey) parts.push("Control");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (parts.length === 0) return null;
  const key =
    event.key === " " ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return [...parts, key].join("+");
}

export function AppshotsSettingsPanel() {
  const enabled = useClientSettings((settings) => settings.appshotsEnabled);
  const shortcut = useClientSettings((settings) => settings.appshotShortcut);
  const updateSettings = useUpdateClientSettings();
  const [draftShortcut, setDraftShortcut] = useState(shortcut);
  const lastOptionPressAt = useRef(0);
  const [status, setStatus] = useState<DesktopAppshotStatus | null>(null);
  const bridge = window.desktopBridge?.appshots;

  useEffect(() => setDraftShortcut(shortcut), [shortcut]);
  useEffect(() => {
    let active = true;
    void bridge?.getStatus().then((next) => {
      if (active) setStatus(next);
    });
    return () => {
      active = false;
    };
  }, [bridge]);

  const configure = useCallback(
    async (nextEnabled: boolean, nextShortcut: string) => {
      const normalized = nextShortcut.trim();
      if (!bridge) {
        updateSettings({ appshotsEnabled: nextEnabled, appshotShortcut: normalized });
        return;
      }
      const nextStatus = await bridge.configureShortcut({
        enabled: nextEnabled,
        shortcut: normalized,
      });
      setStatus(nextStatus);
      if (nextStatus.error) {
        toastManager.add({
          type: "error",
          title: "Appshot shortcut was not saved",
          description: statusCopy(nextStatus),
        });
        return;
      }
      updateSettings({ appshotsEnabled: nextEnabled, appshotShortcut: normalized });
      setDraftShortcut(normalized);
    },
    [bridge, updateSettings],
  );

  return (
    <SettingsPageContainer>
      <SettingsSection title="Appshots" icon={<CameraIcon className="size-5" />}>
        <SettingsRow
          {...searchableSetting("global-appshot-shortcut")}
          description="Capture the frontmost macOS window and attach it to the active task. Double-press Option (the default), type Option Option, or press another key combination."
          status={statusCopy(status, bridge !== undefined)}
          control={
            <div className="flex items-center gap-2">
              <Input
                nativeInput
                className="w-52"
                value={draftShortcut}
                aria-label="Appshot global shortcut"
                onChange={(event) => setDraftShortcut(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Alt") {
                    event.preventDefault();
                    const now = performance.now();
                    if (now - lastOptionPressAt.current <= 450) {
                      setDraftShortcut(DEFAULT_APPSHOT_SHORTCUT);
                      lastOptionPressAt.current = 0;
                    } else {
                      lastOptionPressAt.current = now;
                    }
                    return;
                  }
                  const accelerator = eventToAccelerator(event);
                  if (!accelerator) return;
                  event.preventDefault();
                  setDraftShortcut(accelerator);
                }}
              />
              <Button
                size="sm"
                disabled={draftShortcut.trim() === shortcut}
                onClick={() => void configure(enabled, draftShortcut)}
              >
                Apply
              </Button>
            </div>
          }
          resetAction={
            <SettingResetButton
              label="Appshot shortcut"
              onClick={() => void configure(enabled, DEFAULT_APPSHOT_SHORTCUT)}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("enable-appshots")}
          description="Register the shortcut globally while T3 Code is running. Captures remain local until attached through the normal task composer."
          control={
            <Switch
              checked={enabled}
              onCheckedChange={(checked) => void configure(Boolean(checked), shortcut)}
              aria-label="Enable Appshots"
            />
          }
        />
        <SettingsRow
          {...searchableSetting("appshot-macos-permissions")}
          description="Screen Recording captures the window image. Accessibility adds the full available interface text, including content outside the visible scroll area."
          status={
            status ? (
              <span className="flex flex-wrap gap-x-4 gap-y-1">
                <span className="inline-flex items-center gap-1">
                  {status.screenPermission === "granted" ? (
                    <CheckCircle2Icon className="size-3.5 text-emerald-500" />
                  ) : (
                    <ShieldAlertIcon className="size-3.5 text-amber-500" />
                  )}
                  Screen Recording: {status.screenPermission}
                </span>
                <span className="inline-flex items-center gap-1">
                  {status.accessibilityPermission ? (
                    <CheckCircle2Icon className="size-3.5 text-emerald-500" />
                  ) : (
                    <ShieldAlertIcon className="size-3.5 text-amber-500" />
                  )}
                  Accessibility: {status.accessibilityPermission ? "granted" : "required for text"}
                </span>
              </span>
            ) : null
          }
        />
      </SettingsSection>

      <SettingsSection title="Permission behavior" icon={<ShieldCheckIcon className="size-5" />}>
        <SettingsRow
          {...searchableSetting("appshot-supervised")}
          description="Shows a native confirmation before the target window image or interface text is read. Once approved, the complete available Appshot is attached."
        />
        <SettingsRow
          {...searchableSetting("appshot-auto")}
          description="Capture the complete available window image and interface text immediately, without an extra confirmation."
        />
        <SettingsRow
          {...searchableSetting("appshot-full-access")}
          description="Capture the same complete available window image and interface text immediately. Appshots do not perform password or secret parsing in any mode."
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
