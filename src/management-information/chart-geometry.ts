/**
 * The geometry of the management information line charts (plan `docs/plans/20261103-mi-dashboard-page.md`, decisions
 * A3 and A4): scales, ticks, polyline points and label positions, as numbers for `line-chart.njk` to draw. No
 * charting library, so nothing reaches the browser bundle or the CSP.
 *
 * A null value is a period with no cases, which is not zero, so it is a gap in its line: the line breaks there and a
 * value with no neighbour is a marker on its own.
 */

export const CHART_WIDTH = 640;
export const CHART_HEIGHT = 240;
/** One shape per series, in order, so colour is never the only thing telling two lines apart (A3). */
export const CHART_MARKERS = ["circle", "square", "triangle", "diamond"] as const;

// The right margin holds each line's direct label.
const PLOT = { left: 56, right: CHART_WIDTH - 168, top: 12, bottom: CHART_HEIGHT - 36 };
const LABEL_OFFSET = 12;
const LABEL_SPACING = 18;
const TARGET_TICKS = 4;
const MAX_X_TICKS = 6;

/** The chart for `categoryCount` periods, or null when there is nothing to draw: no periods, or no value in any. */
export function lineChart(categoryCount: number, series: ChartSeriesInput[]): LineChartGeometry | null {
  if (series.length > CHART_MARKERS.length) throw new Error(`a chart has at most ${CHART_MARKERS.length} lines`);
  const values = series.flatMap((each) => each.values).filter((value): value is number => value !== null);
  if (categoryCount === 0 || values.length === 0) return null;

  const { top, step } = yScale(Math.max(...values));
  const x = (index: number) => round(categoryCount === 1 ? (PLOT.left + PLOT.right) / 2 : PLOT.left + (index * (PLOT.right - PLOT.left)) / (categoryCount - 1));
  const y = (value: number) => round(PLOT.bottom - (value / top) * (PLOT.bottom - PLOT.top));

  const drawn = series.map((each, index) => {
    const points = each.values.flatMap((value, at) => (value === null ? [] : [{ index: at, x: x(at), y: y(value) }]));
    return { key: each.key, marker: CHART_MARKERS[index], points, segments: segments(points) };
  });
  const labelYs = spreadLabels(drawn.map((each) => each.points.at(-1)?.y ?? null));

  return {
    width: CHART_WIDTH,
    height: CHART_HEIGHT,
    plot: PLOT,
    yTicks: Array.from({ length: Math.round(top / step) + 1 }, (_, index) => ({ value: round(index * step, 6), y: y(index * step) })),
    xTicks: xTickIndexes(categoryCount).map((index) => ({ index, x: x(index) })),
    series: drawn.map((each, index) => {
      const labelY = labelYs[index];
      return {
        key: each.key,
        marker: each.marker,
        points: each.points.map(({ x, y }) => ({ x, y })),
        segments: each.segments,
        label: labelY === null ? null : { x: PLOT.right + LABEL_OFFSET, y: labelY }
      };
    })
  };
}

/** A top of the axis and a step of 1, 2 or 5 times a power of ten, with about four steps; [0, 1] when all are zero. */
function yScale(max: number): { top: number; step: number } {
  if (max <= 0) return { top: 1, step: 1 };
  const raw = max / TARGET_TICKS;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const residual = raw / magnitude;
  const step = (residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10) * magnitude;
  return { top: round(Math.ceil(round(max / step, 6)) * step, 6), step };
}

/** Runs of two or more consecutive periods with a value, as SVG `points` lists. */
function segments(points: Point[]): string[] {
  const runs: Point[][] = [];
  for (const point of points) {
    const run = runs.at(-1);
    if (run && run[run.length - 1].index === point.index - 1) run.push(point);
    else runs.push([point]);
  }
  return runs.filter((run) => run.length > 1).map((run) => run.map(({ x, y }) => `${x},${y}`).join(" "));
}

/** Each label beside its line's last value, pushed apart so none overlaps another, and kept within the plot. */
function spreadLabels(ys: (number | null)[]): (number | null)[] {
  const placed = ys.flatMap((y, index) => (y === null ? [] : [{ index, y }])).sort((a, b) => a.y - b.y || a.index - b.index);
  for (let at = 1; at < placed.length; at++) placed[at].y = Math.max(placed[at].y, placed[at - 1].y + LABEL_SPACING);
  for (let at = placed.length - 1; at >= 0; at--) {
    const below = at === placed.length - 1 ? PLOT.bottom : placed[at + 1].y - LABEL_SPACING;
    placed[at].y = Math.max(PLOT.top, Math.min(placed[at].y, below));
  }
  return ys.map((_, index) => {
    const label = placed.find((each) => each.index === index);
    return label ? round(label.y) : null;
  });
}

/** Every period when they fit, otherwise every nth from the first, so at most six labels share the axis. */
function xTickIndexes(categoryCount: number): number[] {
  const every = Math.ceil(categoryCount / MAX_X_TICKS);
  return Array.from({ length: Math.ceil(categoryCount / every) }, (_, index) => index * every);
}

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export type ChartMarker = (typeof CHART_MARKERS)[number];

type Point = { index: number; x: number; y: number };

export interface ChartSeriesInput {
  key: string;
  /** One per period, in the periods' order; null where the period had no cases. */
  values: (number | null)[];
}

export interface LineChartGeometry {
  width: number;
  height: number;
  plot: { left: number; right: number; top: number; bottom: number };
  yTicks: { value: number; y: number }[];
  /** The periods whose start is written under the axis, by their index in the periods. */
  xTicks: { index: number; x: number }[];
  series: {
    key: string;
    marker: ChartMarker;
    points: { x: number; y: number }[];
    segments: string[];
    /** Where the line's direct label goes; null for a line with no values, which draws nothing. */
    label: { x: number; y: number } | null;
  }[];
}
