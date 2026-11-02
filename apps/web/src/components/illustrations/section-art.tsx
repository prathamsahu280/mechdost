import type { ReactNode } from 'react';
import { C } from './palette';
import { Sparkle } from './parts';

interface Props {
  className?: string;
}

const round = { strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function Frame({
  className,
  children,
  viewBox = '0 0 120 120',
}: Props & { children: ReactNode; viewBox?: string }) {
  return (
    <svg viewBox={viewBox} aria-hidden="true" focusable="false" className={className}>
      {children}
    </svg>
  );
}

/** Step 1 · Tell us what you need: phone with a chat bubble and a small car. */
export function StepTellUs({ className }: Props) {
  return (
    <Frame className={className}>
      <circle cx={60} cy={60} r={52} fill={C.pale} />
      <ellipse cx={60} cy={104} rx={30} ry={4} fill={C.ink} opacity={0.08} />
      <rect x={36} y={22} width={44} height={78} rx={10} fill={C.surface} stroke={C.line} strokeWidth={2.5} />
      <rect x={52} y={27} width={12} height={4} rx={2} fill={C.line} />
      <path
        d="M44 74c0-6 3-9 8-10l6-1c4-6 8-8 14-8h3c5 0 8 3 10 6"
        stroke={C.accent}
        strokeWidth={4}
        fill="none"
        {...round}
      />
      <circle cx={52} cy={80} r={5} fill={C.tyre} />
      <circle cx={70} cy={80} r={5} fill={C.tyre} />
      <g className="ill-float">
        <path
          d="M66 18h34c5 0 8 3 8 8v14c0 5-3 8-8 8H82l-8 8v-8h-8c-5 0-8-3-8-8V26c0-5 3-8 8-8Z"
          fill={C.accent}
        />
        <path d="M70 30h26M70 38h16" stroke={C.surface} strokeWidth={3.5} {...round} />
      </g>
    </Frame>
  );
}

/** Step 2 · Review the estimate: itemised receipt with rupee lines. */
export function StepEstimate({ className }: Props) {
  return (
    <Frame className={className}>
      <circle cx={60} cy={60} r={52} fill={C.pale} />
      <ellipse cx={60} cy={106} rx={28} ry={4} fill={C.ink} opacity={0.08} />
      <path
        d="M34 18h52v82l-6-5-7 5-6-5-7 5-6-5-7 5-6-5-7 5Z"
        fill={C.surface}
        stroke={C.line}
        strokeWidth={2.5}
        {...round}
      />
      {[34, 48, 62].map((y, i) => (
        <g key={y}>
          <text
            x={42}
            y={y + 4}
            fontSize={11}
            fontWeight={800}
            fill={C.accent}
            fontFamily="system-ui, sans-serif"
          >
            ₹
          </text>
          <rect x={52} y={y - 3} width={i === 1 ? 18 : 24} height={6} rx={3} fill={C.line} />
          <rect x={72} y={y - 3} width={8} height={6} rx={3} fill={C.mint} />
        </g>
      ))}
      <path d="M42 78h36" stroke={C.deep} strokeWidth={4} {...round} />
      <g className="ill-twinkle">
        <Sparkle x={96} y={30} s={7} />
      </g>
    </Frame>
  );
}

/** Step 3 · Confirm the next step: calendar with a tick. */
export function StepConfirm({ className }: Props) {
  return (
    <Frame className={className}>
      <circle cx={60} cy={60} r={52} fill={C.pale} />
      <ellipse cx={60} cy={104} rx={30} ry={4} fill={C.ink} opacity={0.08} />
      <rect x={26} y={28} width={68} height={70} rx={12} fill={C.surface} stroke={C.line} strokeWidth={2.5} />
      <path d="M26 40c0-7 5-12 12-12h44c7 0 12 5 12 12v6H26Z" fill={C.accent} />
      <path d="M42 22v12M78 22v12" stroke={C.ink} strokeWidth={5} {...round} />
      {[0, 1, 2].map((r) =>
        [0, 1, 2, 3].map((c) => (
          <rect
            key={`${String(r)}-${String(c)}`}
            x={36 + c * 13}
            y={54 + r * 12}
            width={8}
            height={6}
            rx={2}
            fill={C.pill}
          />
        )),
      )}
      <g className="ill-float">
        <circle cx={86} cy={84} r={16} fill={C.deep} />
        <path d="M79 84l5 5 9-10" stroke={C.surface} strokeWidth={3.5} fill="none" {...round} />
      </g>
    </Frame>
  );
}

/** Partners: a small shop front with a verified badge. */
export function PartnerArt({ className }: Props) {
  return (
    <Frame className={className} viewBox="0 0 200 160">
      <circle cx={100} cy={82} r={70} fill={C.pale} />
      <ellipse cx={100} cy={146} rx={64} ry={6} fill={C.ink} opacity={0.08} />
      <rect
        x={46}
        y={66}
        width={108}
        height={78}
        rx={10}
        fill={C.surface}
        stroke={C.line}
        strokeWidth={2.5}
      />
      <path d="M38 68h124l-12-32H50Z" fill={C.accent} />
      <path d="M62 68v14m26-14v14m26-14v14m26-14v14" stroke={C.surface} strokeWidth={7} {...round} />
      <rect x={62} y={96} width={30} height={48} rx={4} fill={C.mint} />
      <rect x={104} y={96} width={36} height={24} rx={4} fill={C.pill} />
      <g className="ill-float">
        <circle cx={152} cy={44} r={20} fill={C.deep} />
        <path d="M143 44l6 6 12-12" stroke={C.surface} strokeWidth={4} fill="none" {...round} />
      </g>
      <g className="ill-twinkle">
        <Sparkle x={40} y={40} s={8} />
      </g>
    </Frame>
  );
}
