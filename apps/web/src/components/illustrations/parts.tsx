import { C, SPIN_ORIGIN } from './palette';

/**
 * Shared drawing parts so the scenes stay one family: wheels, sparkles and the soft ground shadow.
 * Plain SVG fragments (no hooks), safe in Server Components.
 */
export function Wheel({ cx, cy, r, spin = true }: { cx: number; cy: number; r: number; spin?: boolean }) {
  const rim = r * 0.52;
  return (
    <g className={spin ? 'ill-spin' : undefined} style={spin ? SPIN_ORIGIN : undefined}>
      <circle cx={cx} cy={cy} r={r} fill={C.tyre} stroke={C.line} strokeWidth={1.5} />
      <circle cx={cx} cy={cy} r={rim} fill={C.rim} />
      <g stroke={C.tyre} strokeWidth={2.25} strokeLinecap="round">
        <line x1={cx} y1={cy - rim + 3} x2={cx} y2={cy + rim - 3} />
        <line x1={cx - rim + 3} y1={cy} x2={cx + rim - 3} y2={cy} />
      </g>
      <circle cx={cx} cy={cy} r={r * 0.18} fill={C.accent} />
    </g>
  );
}

export function Ground({ cx, cy, rx, ry = 10 }: { cx: number; cy: number; rx: number; ry?: number }) {
  return <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={C.ink} opacity={0.08} />;
}

/** Four-point sparkle. */
export function Sparkle({
  x,
  y,
  s = 10,
  color = C.star,
}: {
  x: number;
  y: number;
  s?: number;
  color?: string;
}) {
  const q = s * 0.28;
  return (
    <path
      d={`M${x} ${y - s} Q${x + q} ${y - q} ${x + s} ${y} Q${x + q} ${y + q} ${x} ${y + s} Q${x - q} ${y + q} ${x - s} ${y} Q${x - q} ${y - q} ${x} ${y - s}Z`}
      fill={color}
    />
  );
}
