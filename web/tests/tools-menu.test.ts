import { expect, it } from "vitest";
import { toolsMenuPosition, toolsMenuScroll } from "../src/acenta/tools-menu";

it.each([
  [
    { right: 1235, bottom: 480 },
    { width: 1440, height: 924 },
    { width: "560px", left: "675px", top: "488px", maxHeight: "420px" },
  ],
  [
    { right: 1350, bottom: 620 },
    { width: 1440, height: 924 },
    { width: "560px", left: "790px", top: "628px", maxHeight: "280px" },
  ],
  [
    { right: 1500, bottom: 480 },
    { width: 1440, height: 762 },
    { width: "560px", left: "864px", top: "488px", maxHeight: "258px" },
  ],
  [
    { right: 350, bottom: 615 },
    { width: 390, height: 844 },
    { width: "358px", left: "16px", top: "623px", maxHeight: "205px" },
  ],
  [
    { right: 299, bottom: 480 },
    { width: 320, height: 568 },
    { width: "288px", left: "16px", top: "488px", maxHeight: "64px" },
  ],
])(
  "anchors downwards within the viewport for %j",
  (anchor, viewport, expected) => {
    expect(toolsMenuPosition(anchor, viewport)).toEqual(expected);
  },
);

it.each([
  [{ top: 798, bottom: 838 }, 844, 210, 192],
  [{ top: 716, bottom: 756 }, 762, 210, 192],
  [{ top: 558, bottom: 598 }, 400, 414, 192],
  [{ top: 120, bottom: 160 }, 180, 104, 100],
  [{ top: 120.5, bottom: 160.5 }, 180, 104, 99.5],
  [{ top: -80, bottom: -40 }, 400, -96, 320],
  [{ top: 550, bottom: 590 }, 844, 0, 230],
])(
  "recovers room below %j in a %ipx viewport",
  (anchor, height, scroll, available) => {
    expect(toolsMenuScroll(anchor, height)).toBe(scroll);
    const moved = { top: anchor.top - scroll, bottom: anchor.bottom - scroll };
    expect(toolsMenuScroll(moved, height)).toBe(0);
    expect(
      toolsMenuPosition(
        { right: 350, bottom: moved.bottom },
        { width: 390, height },
      ).maxHeight,
    ).toBe(`${available}px`);
    expect(moved.top).toBeGreaterThanOrEqual(16);
  },
);
