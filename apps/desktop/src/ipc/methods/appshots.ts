import {
  DesktopAppshotCaptureInputSchema,
  DesktopAppshotCaptureResultSchema,
  DesktopAppshotShortcutConfigSchema,
  DesktopAppshotStatusSchema,
  DesktopAppshotTargetSchema,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopAppshots from "../../appshots/DesktopAppshots.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const getAppshotStatus = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.APPSHOT_GET_STATUS_CHANNEL,
  payload: Schema.Void,
  result: DesktopAppshotStatusSchema,
  handler: Effect.fn("desktop.ipc.appshots.getStatus")(function* () {
    const appshots = yield* DesktopAppshots.DesktopAppshots;
    return yield* appshots.getStatus;
  }),
});

export const configureAppshotShortcut = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.APPSHOT_CONFIGURE_SHORTCUT_CHANNEL,
  payload: DesktopAppshotShortcutConfigSchema,
  result: DesktopAppshotStatusSchema,
  handler: Effect.fn("desktop.ipc.appshots.configureShortcut")(function* (config) {
    const appshots = yield* DesktopAppshots.DesktopAppshots;
    return yield* appshots.configureShortcut(config);
  }),
});

export const captureAppshot = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.APPSHOT_CAPTURE_CHANNEL,
  payload: DesktopAppshotCaptureInputSchema,
  result: DesktopAppshotCaptureResultSchema,
  handler: Effect.fn("desktop.ipc.appshots.capture")(function* (input) {
    const appshots = yield* DesktopAppshots.DesktopAppshots;
    return yield* appshots.capture(input);
  }),
});

export const requestAppshot = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.APPSHOT_REQUEST_CHANNEL,
  payload: Schema.Void,
  result: DesktopAppshotTargetSchema,
  handler: Effect.fn("desktop.ipc.appshots.request")(function* () {
    const appshots = yield* DesktopAppshots.DesktopAppshots;
    return yield* appshots.request;
  }),
});

export const methods = [
  getAppshotStatus,
  configureAppshotShortcut,
  requestAppshot,
  captureAppshot,
] as const;
