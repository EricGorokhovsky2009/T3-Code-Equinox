import type { DesktopAppshotTarget } from "@t3tools/contracts";

const RECENT_HANDLER_TTL_MS = 60_000;
type AppshotRequestHandler = (target: DesktopAppshotTarget) => void;

let activeHandler: AppshotRequestHandler | null = null;
let recentHandler: { readonly handler: AppshotRequestHandler; readonly expiresAt: number } | null =
  null;

export function registerAppshotRequestHandler(handler: AppshotRequestHandler): () => void {
  activeHandler = handler;
  recentHandler = null;
  return () => {
    if (activeHandler !== handler) return;
    activeHandler = null;
    recentHandler = { handler, expiresAt: Date.now() + RECENT_HANDLER_TTL_MS };
  };
}

export function dispatchAppshotRequest(target: DesktopAppshotTarget): boolean {
  if (activeHandler) {
    activeHandler(target);
    return true;
  }
  if (recentHandler && recentHandler.expiresAt >= Date.now()) {
    recentHandler.handler(target);
    return true;
  }
  recentHandler = null;
  return false;
}

export function resetAppshotRequestBusForTests(): void {
  activeHandler = null;
  recentHandler = null;
}
