import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  dispatchAppshotRequest,
  registerAppshotRequestHandler,
  resetAppshotRequestBusForTests,
} from "./appshotRequestBus";

const target = {
  requestId: "request-1",
  pid: 123,
  appName: "Microsoft Excel",
  bundleId: "com.microsoft.Excel",
  appIconDataUrl: null,
  capturedAt: "2026-08-11T00:00:00.000Z",
};

afterEach(() => {
  vi.useRealTimers();
  resetAppshotRequestBusForTests();
});

describe("Appshot request routing", () => {
  it("routes to the active task", () => {
    const handler = vi.fn();
    registerAppshotRequestHandler(handler);
    expect(dispatchAppshotRequest(target)).toBe(true);
    expect(handler).toHaveBeenCalledWith(target);
  });

  it("keeps the most recent task available for sixty seconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T00:00:00.000Z"));
    const handler = vi.fn();
    const unregister = registerAppshotRequestHandler(handler);
    unregister();
    vi.advanceTimersByTime(59_999);
    expect(dispatchAppshotRequest(target)).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("does not route to a stale task", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T00:00:00.000Z"));
    const unregister = registerAppshotRequestHandler(vi.fn());
    unregister();
    vi.advanceTimersByTime(60_001);
    expect(dispatchAppshotRequest(target)).toBe(false);
  });
});
