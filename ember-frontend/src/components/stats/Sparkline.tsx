"use client";

/**
 * Inline SVG sparkline. Used in the detail tray to show the raw
 * inter-arrival samples that feed the p50/p95/p99 aggregates, so the
 * user can directly see what's behind those numbers.
 *
 * Responsive width: the SVG uses a viewBox + 100% width so it grows
 * to fill its container instead of getting clipped on narrow trays.
 * The reference label (e.g. "p50 999ms") moves to the footer so it
 * never overlaps the data path.
 */
interface Props {
  values: number[];
  /** Internal viewBox height. Actual rendered height controlled by parent CSS. */
  height?: number;
  stroke?: string;
  fill?: string;
  /** Draw a horizontal reference line at this y-value (e.g. p50). */
  reference?: number;
  referenceLabel?: string;
}

const VIEWBOX_WIDTH = 1000;  // internal coordinate space; SVG scales to fit container

export function Sparkline({
  values,
  height = 64,
  stroke = "#f97316",                  // ember-orange
  fill = "rgba(249, 115, 22, 0.12)",
  reference,
  referenceLabel,
}: Props) {
  if (values.length === 0) {
    return (
      <div
        className="flex w-full items-center justify-center border border-dashed border-ember-border/40 font-mono text-[10px] text-text-secondary/40"
        style={{ height }}
      >
        no samples yet
      </div>
    );
  }

  const dataMax = Math.max(...values);
  const dataMin = Math.min(...values);
  // Pad the y-range slightly above/below so the line never touches the
  // top/bottom edges (looks cleaner; also keeps the reference line
  // visible if it equals the max).
  const refConsidered = reference != null ? [reference] : [];
  const yMax = Math.max(dataMax, ...refConsidered);
  const yMin = Math.min(dataMin, ...refConsidered);
  const pad = (yMax - yMin) * 0.1 || 1;
  const yTop = yMax + pad;
  const yBot = Math.max(0, yMin - pad);
  const yRange = yTop - yBot || 1;

  const xStep = values.length > 1 ? VIEWBOX_WIDTH / (values.length - 1) : VIEWBOX_WIDTH;
  const yFor = (v: number) => height - ((v - yBot) / yRange) * (height - 2) - 1;
  const points = values.map((v, i) => `${(i * xStep).toFixed(1)},${yFor(v).toFixed(1)}`).join(" ");
  const refY = reference != null ? yFor(reference) : null;

  return (
    <div className="w-full">
      <div className="relative">
        {/*
          preserveAspectRatio="none" lets the SVG stretch horizontally
          to fill the container while keeping vertical proportions. The
          viewBox keeps internal coordinates consistent regardless of
          actual pixel width.
        */}
        <svg
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${height}`}
          preserveAspectRatio="none"
          width="100%"
          height={height}
          className="block"
        >
          {/* Area fill */}
          <polyline
            points={`0,${height} ${points} ${VIEWBOX_WIDTH},${height}`}
            fill={fill}
            stroke="none"
          />
          {/* Reference line (subtle, drawn first so the data line sits on top) */}
          {refY != null && (
            <line
              x1="0"
              x2={VIEWBOX_WIDTH}
              y1={refY}
              y2={refY}
              stroke="rgba(255,255,255,0.18)"
              strokeDasharray="4 4"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {/* Data line */}
          <polyline
            points={points}
            fill="none"
            stroke={stroke}
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {/* Y-axis range hints — overlaid on the SVG corners */}
        <span className="pointer-events-none absolute right-1 top-0 font-mono text-[9px] text-text-secondary/45">
          {Math.round(yMax)}ms
        </span>
        <span className="pointer-events-none absolute right-1 bottom-0 font-mono text-[9px] text-text-secondary/45">
          {Math.round(yBot)}ms
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 font-mono text-[9px] text-text-secondary/60">
        <span className="text-text-secondary/45">oldest</span>
        <div className="flex items-center gap-3">
          {referenceLabel && (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-px w-3 bg-text-secondary/40" style={{ borderTop: "1px dashed currentColor" }} />
              {referenceLabel}
            </span>
          )}
          <span>min <span className="tabular-nums text-text-secondary/75">{Math.round(dataMin)}ms</span></span>
          <span>max <span className="tabular-nums text-text-secondary/75">{Math.round(dataMax)}ms</span></span>
          <span>n=<span className="tabular-nums text-text-secondary/75">{values.length}</span></span>
        </div>
        <span className="text-text-secondary/45">newest</span>
      </div>
    </div>
  );
}
