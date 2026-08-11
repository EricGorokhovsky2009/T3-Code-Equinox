import type {
  DesktopAppshotCaptureInput,
  DesktopAppshotCaptureResult,
  DesktopAppshotShortcutConfig,
  DesktopAppshotStatus,
  DesktopAppshotTarget,
} from "@t3tools/contracts";
import { DEFAULT_APPSHOT_SHORTCUT } from "@t3tools/contracts/settings";
import { randomUUID } from "node:crypto";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import * as Electron from "electron";

import * as ElectronWindow from "../electron/ElectronWindow.ts";
import { APPSHOT_REQUESTED_CHANNEL } from "../ipc/channels.ts";

const REQUEST_TTL_MS = 60_000;
const MAX_ACCESSIBLE_TEXT_CHARS = 40_000;
const MAX_ACCESSIBILITY_NODES = 4_000;
const MAX_ACCESSIBILITY_DEPTH = 12;

interface AccessibilityRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface AccessibilityNode {
  readonly title: string | null;
  readonly description: string | null;
  readonly placeholder: string | null;
  readonly value: string | null;
}

interface AccessibilitySnapshot {
  readonly windowTitle: string | null;
  readonly windowNumber: number | null;
  readonly windowBounds: AccessibilityRect | null;
  readonly nodes: readonly AccessibilityNode[];
}

interface PendingTarget extends DesktopAppshotTarget {
  readonly appPath: string | null;
  readonly windowNumber: number | null;
  readonly activateBeforeCapture: boolean;
  readonly requestedAtMs: number;
}

const AccessibilityRectSchema = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});
const AccessibilityNodeSchema = Schema.Struct({
  title: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  placeholder: Schema.NullOr(Schema.String),
  value: Schema.NullOr(Schema.String),
});
const AccessibilitySnapshotSchema = Schema.Struct({
  windowTitle: Schema.NullOr(Schema.String),
  windowNumber: Schema.NullOr(Schema.Int),
  windowBounds: Schema.NullOr(AccessibilityRectSchema),
  nodes: Schema.Array(AccessibilityNodeSchema),
});
const FrontmostApplicationSchema = Schema.Struct({
  pid: Schema.Int.check(Schema.isGreaterThan(0)),
  appName: Schema.String,
  bundleId: Schema.NullOr(Schema.String),
  appPath: Schema.NullOr(Schema.String),
  windowNumber: Schema.NullOr(Schema.Int),
});
const decodeAccessibilitySnapshot = Schema.decodeEffect(
  Schema.fromJsonString(AccessibilitySnapshotSchema),
);
const decodeFrontmostApplication = Schema.decodeEffect(
  Schema.fromJsonString(FrontmostApplicationSchema),
);

class DesktopAppshotAutomationError extends Schema.TaggedErrorClass<DesktopAppshotAutomationError>()(
  "DesktopAppshotAutomationError",
  { cause: Schema.Defect() },
) {}

export class DesktopAppshots extends Context.Service<
  DesktopAppshots,
  {
    readonly getStatus: Effect.Effect<DesktopAppshotStatus>;
    readonly configureShortcut: (
      config: DesktopAppshotShortcutConfig,
    ) => Effect.Effect<DesktopAppshotStatus>;
    readonly request: Effect.Effect<DesktopAppshotTarget, DesktopAppshotAutomationError>;
    readonly capture: (
      input: DesktopAppshotCaptureInput,
    ) => Effect.Effect<DesktopAppshotCaptureResult>;
  }
>()("@t3tools/desktop/appshots/DesktopAppshots") {}

function normalizeMediaAccessStatus(
  status: ReturnType<typeof Electron.systemPreferences.getMediaAccessStatus>,
): DesktopAppshotStatus["screenPermission"] {
  return status === "granted" || status === "denied" || status === "restricted"
    ? status
    : "unknown";
}

export function captureTargetJxa(ownPid: number): string {
  return String.raw`
ObjC.import("AppKit");
ObjC.import("CoreGraphics");
const workspace = $.NSWorkspace.sharedWorkspace;
const activeApp = workspace.frontmostApplication;
const activePid = Number(activeApp.processIdentifier);
const ownPid = ${ownPid};
let selectedWindow = null;
let unnamedWindow = null;

try {
  const windowListRef = $.CGWindowListCopyWindowInfo(16, 0);
  const windowList = ObjC.castRefToObject(windowListRef);
  const count = Number(ObjC.unwrap(windowList.count));
  for (let index = 0; index < count; index += 1) {
    const window = ObjC.deepUnwrap(windowList.objectAtIndex(index));
    const ownerPid = Number(window.kCGWindowOwnerPID);
    const width = Number(window.kCGWindowBounds?.Width);
    const height = Number(window.kCGWindowBounds?.Height);
    const belongsToTarget = activePid === ownPid ? ownerPid !== ownPid : ownerPid === activePid;
    if (
      belongsToTarget &&
      Number(window.kCGWindowLayer) === 0 &&
      Number(window.kCGWindowSharingState) !== 0 &&
      width >= 240 &&
      height >= 140
    ) {
      if (String(window.kCGWindowName || "").trim().length > 0) {
        selectedWindow = window;
        break;
      }
      if (!unnamedWindow) unnamedWindow = window;
    }
  }
} catch (_) {}

if (!selectedWindow) selectedWindow = unnamedWindow;

if (activePid === ownPid && !selectedWindow) {
  throw new Error("No application window is available behind T3 Code");
}

const pid = selectedWindow ? Number(selectedWindow.kCGWindowOwnerPID) : activePid;
const selectedApp = pid === activePid
  ? activeApp
  : $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
const app = selectedApp || activeApp;
const windowNumber = selectedWindow ? Number(selectedWindow.kCGWindowNumber) : null;

JSON.stringify({
  pid,
  appName: ObjC.unwrap(app.localizedName) || "Unknown application",
  bundleId: ObjC.unwrap(app.bundleIdentifier) || null,
  appPath: app.bundleURL ? ObjC.unwrap(app.bundleURL.path) : null,
  windowNumber: Number.isInteger(windowNumber) ? windowNumber : null
});
`;
}

function activateApplicationJxa(pid: number): string {
  return String.raw`
ObjC.import("AppKit");
const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid});
if (!app) throw new Error("Application is no longer running");
app.activateWithOptions(3);
`;
}

function accessibilitySnapshotJxa(pid: number): string {
  return String.raw`
const se = Application("System Events");
const proc = se.processes.whose({ unixId: ${pid} })[0];
const windows = proc.windows();
if (windows.length === 0) throw new Error("No accessible window");
const win = windows[0];
const nodes = [];
const maxNodes = ${MAX_ACCESSIBILITY_NODES};
const maxDepth = ${MAX_ACCESSIBILITY_DEPTH};

function attribute(element, name) {
  try { return element.attributes.byName(name).value(); } catch (_) { return null; }
}
function stringValue(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function bounds(element) {
  let position = attribute(element, "AXPosition");
  let size = attribute(element, "AXSize");
  try { if (!position) position = element.position(); } catch (_) {}
  try { if (!size) size = element.size(); } catch (_) {}
  if (!Array.isArray(position) || !Array.isArray(size)) return null;
  const x = Number(position[0]);
  const y = Number(position[1]);
  const width = Number(size[0]);
  const height = Number(size[1]);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}
function walk(element, depth) {
  if (depth > maxDepth || nodes.length >= maxNodes) return;
  let properties = {};
  try { properties = element.properties(); } catch (_) {}
  const title = stringValue(properties.title) || stringValue(properties.name);
  const description = stringValue(properties.accessibilityDescription) || stringValue(properties.description);
  const placeholder = stringValue(properties.placeholderValue);
  const value = stringValue(properties.value);
  nodes.push({ title, description, placeholder, value });
  let children = [];
  try { children = element.uiElements(); } catch (_) {}
  for (const child of children) walk(child, depth + 1);
}
walk(win, 0);
let windowNumber = attribute(win, "AXWindowNumber");
windowNumber = Number.isInteger(Number(windowNumber)) ? Number(windowNumber) : null;
JSON.stringify({
  windowTitle: (() => { try { return stringValue(win.name()); } catch (_) { return null; } })(),
  windowNumber,
  windowBounds: bounds(win),
  nodes
});
`;
}

export function buildAccessibleText(nodes: readonly AccessibilityNode[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  let length = 0;
  for (const node of nodes) {
    const candidates = [node.title, node.description, node.placeholder, node.value];
    for (const candidate of candidates) {
      const text = candidate?.replace(/\s+/g, " ").trim();
      if (!text || seen.has(text)) continue;
      if (length + text.length + 1 > MAX_ACCESSIBLE_TEXT_CHARS) {
        return lines.join("\n");
      }
      seen.add(text);
      lines.push(text);
      length += text.length + 1;
    }
  }
  return lines.join("\n");
}

export function windowSourceIdMatches(sourceId: string, windowNumber: number | null): boolean {
  return windowNumber !== null && sourceId.startsWith(`window:${windowNumber}:`);
}

function sourceMatchesWindow(
  source: Electron.DesktopCapturerSource,
  snapshot: AccessibilitySnapshot,
  appName: string,
  requestedWindowNumber: number | null,
): boolean {
  if (
    windowSourceIdMatches(source.id, requestedWindowNumber) ||
    windowSourceIdMatches(source.id, snapshot.windowNumber)
  ) {
    return true;
  }
  const sourceName = source.name.trim().toLocaleLowerCase();
  const title = snapshot.windowTitle?.trim().toLocaleLowerCase();
  if (title && (sourceName === title || sourceName.includes(title) || title.includes(sourceName))) {
    return true;
  }
  const normalizedAppName = appName.trim().toLocaleLowerCase();
  return normalizedAppName.length > 0 && sourceName.includes(normalizedAppName);
}

function captureError(
  code: Extract<DesktopAppshotCaptureResult, { status: "error" }>["code"],
  message: string,
): DesktopAppshotCaptureResult {
  return { status: "error", code, message };
}

export const make = Effect.gen(function* () {
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const path = yield* Path.Path;
  const serviceScope = yield* Scope.Scope;
  const shortcutMutex = yield* Semaphore.make(1);
  const context = yield* Effect.context<ElectronWindow.ElectronWindow>();
  const runPromise = Effect.runPromiseWith(context);
  const pendingTargets = new Map<string, PendingTarget>();
  let configuredShortcut = "";
  let shortcutEnabled = false;
  let shortcutRegistered = false;
  let shortcutError: DesktopAppshotStatus["error"] = null;
  let optionMonitor: ChildProcessSpawner.ChildProcessHandle | null = null;

  const currentStatus = (): DesktopAppshotStatus => ({
    available: process.platform === "darwin",
    enabled: shortcutEnabled,
    shortcut: configuredShortcut,
    registered: shortcutRegistered,
    screenPermission:
      process.platform === "darwin"
        ? normalizeMediaAccessStatus(Electron.systemPreferences.getMediaAccessStatus("screen"))
        : "unknown",
    accessibilityPermission:
      process.platform === "darwin" &&
      Electron.systemPreferences.isTrustedAccessibilityClient(false),
    error: shortcutError,
  });
  const getStatus = Effect.sync(currentStatus);

  const runJxaString = (source: string) =>
    spawner
      .string(ChildProcess.make("/usr/bin/osascript", ["-l", "JavaScript", "-e", source]))
      .pipe(
        Effect.timeout("8 seconds"),
        Effect.mapError((cause) => new DesktopAppshotAutomationError({ cause })),
      );
  const readCaptureTarget = runJxaString(captureTargetJxa(process.pid)).pipe(
    Effect.flatMap(decodeFrontmostApplication),
    Effect.mapError((cause) => new DesktopAppshotAutomationError({ cause })),
  );
  const readAccessibilitySnapshot = (pid: number) =>
    runJxaString(accessibilitySnapshotJxa(pid)).pipe(
      Effect.flatMap(decodeAccessibilitySnapshot),
      Effect.mapError((cause) => new DesktopAppshotAutomationError({ cause })),
    );

  const request = Effect.gen(function* () {
    // Read the topmost foreign window directly when T3 owns focus. Avoiding a hide/reveal cycle
    // keeps ScreenCaptureKit away from macOS window-transition frames that blur the image.
    const activateBeforeCapture = Electron.BrowserWindow.getFocusedWindow() !== null;
    const frontmost = yield* readCaptureTarget;
    const now = yield* DateTime.now;
    const nowMs = DateTime.toEpochMillis(now);
    const requestId = randomUUID();
    const capturedAt = DateTime.formatIso(now);
    const appIconDataUrl = yield* Effect.tryPromise({
      try: async () =>
        frontmost.appPath
          ? (
              await Electron.app.getFileIcon(frontmost.appPath, {
                size: "small",
              })
            ).toDataURL()
          : null,
      catch: () => null,
    }).pipe(Effect.orElseSucceed(() => null));
    const target: PendingTarget = {
      requestId,
      pid: frontmost.pid,
      appName: frontmost.appName,
      bundleId: frontmost.bundleId,
      appIconDataUrl,
      appPath: frontmost.appPath,
      windowNumber: frontmost.windowNumber,
      activateBeforeCapture,
      capturedAt,
      requestedAtMs: nowMs,
    };
    pendingTargets.set(requestId, target);
    for (const [id, pending] of pendingTargets) {
      if (nowMs - pending.requestedAtMs > REQUEST_TTL_MS) pendingTargets.delete(id);
    }
    return {
      requestId,
      pid: target.pid,
      appName: target.appName,
      bundleId: target.bundleId,
      appIconDataUrl,
      capturedAt,
    } satisfies DesktopAppshotTarget;
  });

  const requestFromShortcut = () => {
    void runPromise(
      request.pipe(
        Effect.flatMap((target) => electronWindow.sendAll(APPSHOT_REQUESTED_CHANNEL, target)),
        Effect.catch(() => Effect.void),
      ),
    );
  };

  const unregisterShortcut = Effect.gen(function* () {
    yield* Effect.sync(() => {
      if (
        configuredShortcut &&
        configuredShortcut.toLocaleLowerCase() !== DEFAULT_APPSHOT_SHORTCUT.toLocaleLowerCase()
      ) {
        try {
          if (Electron.globalShortcut.isRegistered(configuredShortcut)) {
            Electron.globalShortcut.unregister(configuredShortcut);
          }
        } catch {}
      }
    });
    const monitor = optionMonitor;
    optionMonitor = null;
    if (monitor) yield* monitor.kill().pipe(Effect.ignore);
  });

  const startOptionMonitor = Effect.gen(function* () {
    const packaged = Electron.app.isPackaged;
    const sourcePath = path.join(process.cwd(), "native", "appshot-shortcut", "main.swift");
    const commandOptions = {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      killSignal: "SIGTERM",
      forceKillAfter: "2 seconds",
    } as const;
    const command = packaged
      ? ChildProcess.make(
          path.join(process.resourcesPath, "appshot-shortcut", "t3-appshot-shortcut"),
          [],
          commandOptions,
        )
      : ChildProcess.make("xcrun", ["swift", sourcePath], commandOptions);
    const monitor = yield* spawner.spawn(command);
    optionMonitor = monitor;
    const startup = yield* Deferred.make<boolean>();
    yield* monitor.stdout.pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.map((line) => line.trim()),
      Stream.filter((line) => line.length > 0),
      Stream.runForEach((line) => {
        if (line === "capture") return Effect.sync(requestFromShortcut);
        if (line === "ready") return Deferred.succeed(startup, true).pipe(Effect.ignore);
        if (line === "unavailable") return Deferred.succeed(startup, false).pipe(Effect.ignore);
        return Effect.void;
      }),
      Effect.ignore,
      Effect.forkScoped,
    );
    yield* monitor.stderr.pipe(Stream.runDrain, Effect.ignore, Effect.forkScoped);
    yield* monitor.exitCode.pipe(
      Effect.andThen(
        Effect.sync(() => {
          if (optionMonitor === monitor) {
            optionMonitor = null;
            shortcutRegistered = false;
            shortcutError = "conflict";
          }
        }),
      ),
      Effect.andThen(Deferred.succeed(startup, false)),
      Effect.ignore,
      Effect.forkScoped,
    );
    const ready = yield* Deferred.await(startup).pipe(
      Effect.timeout(packaged ? "2 seconds" : "10 seconds"),
      Effect.orElseSucceed(() => false),
    );
    if (!ready) {
      if (optionMonitor === monitor) optionMonitor = null;
      yield* monitor.kill().pipe(Effect.ignore);
    }
    return ready;
  }).pipe(
    Effect.provideService(Scope.Scope, serviceScope),
    Effect.orElseSucceed(() => false),
  );

  const configureShortcut = (config: DesktopAppshotShortcutConfig) =>
    shortcutMutex.withPermit(
      Effect.gen(function* () {
        const nextShortcut = config.shortcut.trim();
        if (
          nextShortcut === configuredShortcut &&
          config.enabled === shortcutEnabled &&
          (!config.enabled || shortcutRegistered)
        ) {
          return currentStatus();
        }
        yield* unregisterShortcut;
        configuredShortcut = nextShortcut;
        shortcutEnabled = config.enabled;
        shortcutRegistered = false;
        shortcutError = null;
        if (process.platform !== "darwin") {
          shortcutError = "unsupported-platform";
          return currentStatus();
        }
        if (!shortcutEnabled) return currentStatus();
        if (configuredShortcut.length === 0) {
          shortcutError = "invalid-shortcut";
          return currentStatus();
        }
        if (
          configuredShortcut.toLocaleLowerCase() === DEFAULT_APPSHOT_SHORTCUT.toLocaleLowerCase()
        ) {
          shortcutRegistered = yield* startOptionMonitor;
          if (!shortcutRegistered) shortcutError = "conflict";
          return currentStatus();
        }
        const registration = yield* Effect.try({
          try: () => Electron.globalShortcut.register(configuredShortcut, requestFromShortcut),
          catch: () => null,
        }).pipe(Effect.orElseSucceed(() => null));
        if (registration === null) {
          shortcutError = "invalid-shortcut";
        } else {
          shortcutRegistered = registration;
          if (!shortcutRegistered) shortcutError = "conflict";
        }
        return currentStatus();
      }),
    );

  const capture = Effect.fn("DesktopAppshots.capture")(function* (
    input: DesktopAppshotCaptureInput,
  ): Effect.fn.Return<DesktopAppshotCaptureResult> {
    const target = pendingTargets.get(input.requestId);
    pendingTargets.delete(input.requestId);
    const now = yield* DateTime.now;
    if (!target || DateTime.toEpochMillis(now) - target.requestedAtMs > REQUEST_TTL_MS) {
      return captureError(
        "request-expired",
        "This Appshot request expired. Press the shortcut again.",
      );
    }

    if (input.runtimeMode === "approval-required") {
      const approval = yield* Effect.promise(() =>
        Electron.dialog.showMessageBox({
          type: "question",
          title: "Capture Appshot?",
          message: `Capture the front window from ${target.appName}?`,
          detail: "Nothing from the window is read until you choose Capture.",
          buttons: ["Cancel", "Capture"],
          cancelId: 0,
          defaultId: 1,
          noLink: true,
        }),
      );
      if (approval.response !== 1) return { status: "cancelled" };
    }

    const screenPermission = normalizeMediaAccessStatus(
      Electron.systemPreferences.getMediaAccessStatus("screen"),
    );
    if (screenPermission === "denied" || screenPermission === "restricted") {
      return captureError(
        "screen-permission-required",
        "Enable Screen Recording for T3 Code in System Settings, then try again.",
      );
    }

    if (!Electron.systemPreferences.isTrustedAccessibilityClient(false)) {
      return captureError(
        "accessibility-permission-required",
        "Enable Accessibility for T3 Code so the Appshot can include all available window text.",
      );
    }

    const restoreWindow = target.activateBeforeCapture
      ? Electron.BrowserWindow.getFocusedWindow()
      : null;
    // Stage Manager presents inactive windows as transformed thumbnails. Activate the selected
    // app and wait for its window transition before sampling, then return to T3 after the native
    // image and accessibility text have both been captured.
    const captureParts = yield* Effect.gen(function* () {
      if (target.activateBeforeCapture) {
        yield* runJxaString(activateApplicationJxa(target.pid));
        yield* Effect.sleep("650 millis");
      }
      return yield* Effect.all(
        {
          snapshot: readAccessibilitySnapshot(target.pid),
          sources: Effect.tryPromise({
            try: () =>
              Electron.desktopCapturer.getSources({
                types: ["window"],
                fetchWindowIcons: true,
                thumbnailSize: { width: 2_560, height: 1_600 },
              }),
            catch: () => new DesktopAppshotAutomationError({ cause: "capture-failed" }),
          }),
        },
        { concurrency: "unbounded" },
      );
    }).pipe(
      Effect.ensuring(
        restoreWindow && !restoreWindow.isDestroyed()
          ? electronWindow.reveal(restoreWindow)
          : Effect.void,
      ),
      Effect.orElseSucceed(() => null),
    );
    if (captureParts === null) {
      return captureError("capture-failed", "The window could not be captured.");
    }

    const { snapshot, sources } = captureParts;
    const captured = yield* Effect.try({
      try: () => {
        const source = sources.find((candidate) =>
          sourceMatchesWindow(candidate, snapshot, target.appName, target.windowNumber),
        );
        if (!source || source.thumbnail.isEmpty()) {
          return captureError(
            "window-not-found",
            `The captured ${target.appName} window is no longer available.`,
          );
        }
        const size = source.thumbnail.getSize();
        return {
          status: "captured",
          appName: target.appName,
          windowTitle: snapshot.windowTitle,
          appIconDataUrl:
            target.appIconDataUrl ||
            (source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null),
          dataUrl: source.thumbnail.toDataURL(),
          width: size.width,
          height: size.height,
          accessibleText: buildAccessibleText(snapshot.nodes),
          approval: input.runtimeMode === "approval-required" ? "supervised" : "automatic",
        } satisfies DesktopAppshotCaptureResult;
      },
      catch: () => new DesktopAppshotAutomationError({ cause: "capture-failed" }),
    }).pipe(
      Effect.orElseSucceed(() =>
        captureError("capture-failed", "The window could not be captured."),
      ),
    );
    return captured;
  });

  yield* Effect.acquireRelease(Effect.void, () => unregisterShortcut);
  // Appshots are enabled by default, so install the desktop default before any renderer mounts.
  // The settings controller reconciles a saved custom shortcut or disabled state once it loads.
  yield* configureShortcut({ enabled: true, shortcut: DEFAULT_APPSHOT_SHORTCUT });

  return DesktopAppshots.of({ getStatus, configureShortcut, request, capture });
});

export const layer = Layer.effect(DesktopAppshots, make);
