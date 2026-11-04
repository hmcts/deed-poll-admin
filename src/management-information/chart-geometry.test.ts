import { describe, expect, it } from "vitest";
import { lineChart } from "./chart-geometry.js";

// The plot is x 56 to 472 (416 wide) and y 12 to 204 (192 high); every expected number below is worked from those.

describe("lineChart", () => {
  it("should draw nothing when there are no periods", () => {
    expect(lineChart(0, [{ key: "received", values: [] }])).toBeNull();
  });

  it("should draw nothing when every value is null, because no cases is not zero", () => {
    expect(
      lineChart(3, [
        { key: "medianDays", values: [null, null, null] },
        { key: "p95Days", values: [null, null, null] }
      ])
    ).toBeNull();
  });

  it("should centre a single point, with a marker and no line, and an axis rounded up to a nice step", () => {
    const chart = lineChart(1, [{ key: "received", values: [5] }]);

    // A top of 5 over four steps is 1.25 a step, rounded up to 2, so the axis runs to 6 and 5 sits 160 below 204.
    expect(chart?.yTicks).toEqual([
      { value: 0, y: 204 },
      { value: 2, y: 140 },
      { value: 4, y: 76 },
      { value: 6, y: 12 }
    ]);
    expect(chart?.xTicks).toEqual([{ index: 0, x: 264 }]);
    expect(chart?.series).toEqual([{ key: "received", marker: "circle", points: [{ x: 264, y: 44 }], segments: [], label: { x: 484, y: 44 } }]);
  });

  it("should give a chart whose values are all zero an axis from 0 to 1, with the line along the bottom", () => {
    const chart = lineChart(2, [{ key: "received", values: [0, 0] }]);

    expect(chart?.yTicks).toEqual([
      { value: 0, y: 204 },
      { value: 1, y: 12 }
    ]);
    expect(chart?.series[0].segments).toEqual(["56,204 472,204"]);
  });

  it("should break the line at a null, leaving a value with no neighbour as a marker on its own", () => {
    const chart = lineChart(4, [{ key: "medianDays", values: [4, null, 2, 3] }]);

    expect(chart?.series[0].points).toEqual([
      { x: 56, y: 12 },
      { x: 333.3, y: 108 },
      { x: 472, y: 60 }
    ]);
    expect(chart?.series[0].segments).toEqual(["333.3,108 472,60"]);
    expect(chart?.series[0].label).toEqual({ x: 484, y: 60 });
  });

  it("should label a line by its last value even when its last period is empty", () => {
    const chart = lineChart(3, [{ key: "medianDays", values: [4, 2, null] }]);

    expect(chart?.series[0].label?.y).toBe(108);
  });

  it("should give a line with no values no label and draw nothing for it", () => {
    const chart = lineChart(2, [
      { key: "approved", values: [2, 2] },
      { key: "withdrawn", values: [null, null] }
    ]);

    expect(chart?.series[1]).toEqual({ key: "withdrawn", marker: "square", points: [], segments: [], label: null });
  });

  it("should give each line its own marker shape, in order", () => {
    const chart = lineChart(1, [
      { key: "a", values: [1] },
      { key: "b", values: [1] },
      { key: "c", values: [1] },
      { key: "d", values: [1] }
    ]);

    expect(chart?.series.map((each) => each.marker)).toEqual(["circle", "square", "triangle", "diamond"]);
  });

  it("should refuse a fifth line, which would have no marker of its own", () => {
    expect(() =>
      lineChart(
        1,
        ["a", "b", "c", "d", "e"].map((key) => ({ key, values: [1] }))
      )
    ).toThrow("at most 4 lines");
  });

  it("should push labels for lines ending together apart, downwards from the top", () => {
    const chart = lineChart(2, [
      { key: "a", values: [2, 2] },
      { key: "b", values: [2, 2] }
    ]);

    expect(chart?.series.map((each) => each.label?.y)).toEqual([12, 30]);
  });

  it("should push labels for lines ending together at the bottom upwards, keeping them inside the plot", () => {
    const chart = lineChart(2, [
      { key: "a", values: [1, 0] },
      { key: "b", values: [1, 0] }
    ]);

    expect(chart?.series.map((each) => each.label?.y)).toEqual([186, 204]);
  });

  it("should step a large axis in thousands", () => {
    const chart = lineChart(1, [{ key: "openAtEnd", values: [2048] }]);

    expect(chart?.yTicks.map((tick) => tick.value)).toEqual([0, 1000, 2000, 3000]);
  });

  it("should step a small decimal axis in whole days", () => {
    const chart = lineChart(1, [{ key: "medianDays", values: [3.25] }]);

    expect(chart?.yTicks.map((tick) => tick.value)).toEqual([0, 1, 2, 3, 4]);
  });

  it("should label every period when six fit, and every third of thirteen", () => {
    expect(lineChart(6, [{ key: "a", values: [1, 1, 1, 1, 1, 1] }])?.xTicks.map((tick) => tick.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(lineChart(13, [{ key: "a", values: Array(13).fill(1) }])?.xTicks.map((tick) => tick.index)).toEqual([0, 3, 6, 9, 12]);
  });
});
