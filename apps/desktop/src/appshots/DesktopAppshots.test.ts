import { describe, expect, it } from "vite-plus/test";

import { buildAccessibleText, windowSourceIdMatches } from "./DesktopAppshots.ts";

type AccessibilityNode = Parameters<typeof buildAccessibleText>[0][number];

function node(overrides: Partial<AccessibilityNode>): AccessibilityNode {
  return {
    title: null,
    description: null,
    placeholder: null,
    value: null,
    ...overrides,
  };
}

describe("Appshot accessibility text", () => {
  it("includes all available field values without password or secret parsing", () => {
    expect(
      buildAccessibleText([
        node({ title: "Account settings" }),
        node({ title: "Password", value: "visible-password" }),
        node({ placeholder: "Paste API key", value: "sk-visible" }),
      ]),
    ).toBe("Account settings\nPassword\nvisible-password\nPaste API key\nsk-visible");
  });

  it("deduplicates repeated interface text", () => {
    expect(
      buildAccessibleText([
        node({ title: "Revenue", value: "Revenue" }),
        node({ description: "Revenue" }),
      ]),
    ).toBe("Revenue");
  });
});

describe("Appshot window identity", () => {
  it("matches Electron's macOS source ID using the captured CoreGraphics window number", () => {
    expect(windowSourceIdMatches("window:208:0", 208)).toBe(true);
    expect(windowSourceIdMatches("window:209:0", 208)).toBe(false);
    expect(windowSourceIdMatches("window:208:0", null)).toBe(false);
  });
});
