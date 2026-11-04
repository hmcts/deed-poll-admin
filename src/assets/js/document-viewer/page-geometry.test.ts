import { describe, expect, it } from "vitest";
import { canvasDensity, canvasSize, fitWidthScale, MAX_CANVAS_PIXELS } from "./page-geometry.js";

describe("fitWidthScale", () => {
  it("should scale a page to fill the frame's width", () => {
    expect(fitWidthScale(595, 1190)).toBe(2);
    expect(fitWidthScale(842, 421)).toBe(0.5);
  });

  it("should fall back to actual size for a frame or page with no width", () => {
    expect(fitWidthScale(595, 0)).toBe(1);
    expect(fitWidthScale(0, 800)).toBe(1);
  });
});

describe("canvasDensity", () => {
  it("should use the screen's density when the canvas fits", () => {
    expect(canvasDensity(800, 1100, 2)).toBe(2);
  });

  it("should lower the density just enough to keep the canvas under the pixel limit", () => {
    const density = canvasDensity(3000, 4000, 2);
    const { width, height } = canvasSize(3000, 4000, density);

    expect(density).toBeLessThan(2);
    expect(width * height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
  });

  it("should treat an unreported density as one", () => {
    expect(canvasDensity(100, 100, 0)).toBe(1);
  });
});

describe("canvasSize", () => {
  it("should round down to whole pixels and never answer zero", () => {
    expect(canvasSize(100.7, 50.2, 1)).toEqual({ width: 100, height: 50 });
    expect(canvasSize(0.1, 0.1, 1)).toEqual({ width: 1, height: 1 });
  });
});
