import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ComposerImageAttachment } from "../composerDraftStore";
import {
  appendAppshotContextsToPrompt,
  appshotBadgeLabel,
  captureToComposerImage,
} from "./appshots";

afterEach(() => {
  vi.unstubAllGlobals();
});

function appshotImage(
  approval: NonNullable<ComposerImageAttachment["appshot"]>["approval"] = "automatic",
): ComposerImageAttachment {
  return {
    type: "image",
    id: "appshot-1",
    name: "Appshot-Excel.png",
    mimeType: "image/png",
    sizeBytes: 10,
    previewUrl: "blob:appshot",
    file: {} as File,
    appshot: {
      appName: "Microsoft Excel",
      windowTitle: "Budget.xlsx",
      accessibleText: "Revenue\nExpenses",
      appIconDataUrl: null,
      approval,
    },
  };
}

describe("Appshot composer context", () => {
  it("attaches an unredacted capture without fetching its data URL", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    vi.stubGlobal("fetch", fetchMock);

    const image = await captureToComposerImage({
      status: "captured",
      appName: "Microsoft Excel",
      windowTitle: "Budget.xlsx",
      dataUrl: "data:image/png;base64,cG5n",
      width: 1,
      height: 1,
      accessibleText: "Revenue",
      appIconDataUrl: null,
      approval: "automatic",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(image.file.type).toBe("image/png");
    expect(await image.file.text()).toBe("png");
    URL.revokeObjectURL(image.previewUrl);
  });

  it("marks accessibility text as untrusted context", () => {
    const prompt = appendAppshotContextsToPrompt("Explain this sheet", [appshotImage()]);
    expect(prompt).toContain("Explain this sheet");
    expect(prompt).toContain("untrusted page content");
    expect(prompt).toContain("Microsoft Excel");
    expect(prompt).toContain("Revenue\nExpenses");
  });

  it("leaves ordinary image prompts unchanged", () => {
    const { appshot: _appshot, ...ordinary } = appshotImage();
    expect(appendAppshotContextsToPrompt("Keep me", [ordinary])).toBe("Keep me");
  });

  it("reports capture policy in the tile badge", () => {
    expect(appshotBadgeLabel(appshotImage("automatic"))).toBeNull();
    expect(appshotBadgeLabel(appshotImage("supervised"))).toBe("Supervised");
  });
});
