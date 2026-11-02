import type { ReactElement, ReactNode } from 'react';
import type { CategoryKey } from '@/demo/catalogue';
import { C } from './palette';

interface Props {
  className?: string;
}

/** Common frame: soft rounded backdrop, a ground shadow, the drawing on top (viewBox 0 0 96 96). */
function Spot({ className, children }: Props & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 96 96" aria-hidden="true" focusable="false" className={className}>
      <rect x={4} y={4} width={88} height={88} rx={26} fill={C.pale} />
      <ellipse cx={48} cy={78} rx={24} ry={4} fill={C.ink} opacity={0.08} />
      {children}
    </svg>
  );
}

const stroke = { strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function Tyres({ className }: Props) {
  return (
    <Spot className={className}>
      <circle cx={48} cy={46} r={27} fill={C.tyre} stroke={C.line} strokeWidth={1.5} />
      <circle cx={48} cy={46} r={21} fill="none" stroke={C.muted} strokeWidth={2.5} strokeDasharray="3 5" />
      <circle cx={48} cy={46} r={13} fill={C.rim} />
      <circle cx={48} cy={46} r={5} fill={C.accent} />
    </Spot>
  );
}

function Lubricants({ className }: Props) {
  return (
    <Spot className={className}>
      <path d="M28 76V42c0-5 4-9 9-9h20c5 0 9 4 9 9v34Z" fill={C.accent} />
      <path d="M52 33l8-10h8" stroke={C.deep} strokeWidth={4} fill="none" {...stroke} />
      <rect x={40} y={26} width={12} height={8} rx={2} fill={C.ink} />
      <rect x={34} y={50} width={26} height={12} rx={4} fill={C.surface} opacity={0.9} />
      <path d="M74 36c-4 6-7 10-7 13a7 7 0 0 0 14 0c0-3-3-7-7-13Z" fill={C.mint} className="ill-float" />
    </Spot>
  );
}

function Batteries({ className }: Props) {
  return (
    <Spot className={className}>
      <rect x={22} y={34} width={52} height={40} rx={7} fill={C.accent} />
      <rect x={30} y={27} width={10} height={8} rx={2} fill={C.ink} />
      <rect x={56} y={27} width={10} height={8} rx={2} fill={C.ink} />
      <path d="M50 42l-8 13h8l-4 11 12-16h-8l4-8Z" fill={C.star} className="ill-twinkle" />
      <path d="M30 62h8M34 58v8M58 62h8" stroke={C.surface} strokeWidth={2.5} {...stroke} />
    </Spot>
  );
}

function Bearings({ className }: Props) {
  const balls = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2;
    return { x: 48 + Math.cos(a) * 18, y: 46 + Math.sin(a) * 18 };
  });
  return (
    <Spot className={className}>
      <circle cx={48} cy={46} r={27} fill={C.line} />
      <circle cx={48} cy={46} r={23} fill={C.surface} />
      {balls.map((b) => (
        <circle key={`${b.x.toFixed(1)}-${b.y.toFixed(1)}`} cx={b.x} cy={b.y} r={4.5} fill={C.accent} />
      ))}
      <circle cx={48} cy={46} r={12} fill={C.line} />
      <circle cx={48} cy={46} r={7} fill={C.pale} />
    </Spot>
  );
}

function Filters({ className }: Props) {
  return (
    <Spot className={className}>
      <rect x={28} y={24} width={40} height={52} rx={10} fill={C.accent} />
      <rect x={28} y={24} width={40} height={10} rx={5} fill={C.deep} />
      {[42, 50, 58, 66].map((y) => (
        <path key={y} d={`M34 ${String(y)}h28`} stroke={C.mint} strokeWidth={3} {...stroke} />
      ))}
      <circle cx={48} cy={29} r={2.5} fill={C.surface} />
    </Spot>
  );
}

function SpareParts({ className }: Props) {
  return (
    <Spot className={className}>
      <circle cx={44} cy={48} r={25} fill={C.line} />
      <circle cx={44} cy={48} r={18} fill={C.surface} />
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        return (
          <circle key={i} cx={44 + Math.cos(a) * 10} cy={48 + Math.sin(a) * 10} r={2.5} fill={C.muted} />
        );
      })}
      <circle cx={44} cy={48} r={4} fill={C.ink} />
      <path d="M62 26c10 4 16 14 16 24s-6 18-14 22l-6-10c4-3 6-7 6-12s-3-10-8-12Z" fill={C.accent} />
    </Spot>
  );
}

function Accessories({ className }: Props) {
  return (
    <Spot className={className}>
      <g className="ill-float">
        <path d="M48 18v12" stroke={C.muted} strokeWidth={2.5} {...stroke} />
        <path d="M48 30c12 0 20 8 18 20-2 13-10 24-18 24S32 63 30 50c-2-12 6-20 18-20Z" fill={C.accent} />
        <path d="M48 40c5 0 9 4 8 10-1 6-4 11-8 11s-7-5-8-11c-1-6 3-10 8-10Z" fill={C.mint} />
      </g>
      <path d="M22 70h12M62 70h12" stroke={C.line} strokeWidth={4} {...stroke} />
    </Spot>
  );
}

function WorkshopTools({ className }: Props) {
  return (
    <Spot className={className}>
      <path
        d="M30 70l26-26m4-16a12 12 0 0 0-16 15l-2 2 6 6 2-2a12 12 0 0 0 15-16l-7 7-6-6Z"
        stroke={C.accent}
        strokeWidth={7}
        fill="none"
        {...stroke}
      />
      <rect x={58} y={52} width={18} height={22} rx={5} fill={C.deep} />
      <rect x={62} y={56} width={10} height={6} rx={2} fill={C.mint} />
    </Spot>
  );
}

function EvEssentials({ className }: Props) {
  return (
    <Spot className={className}>
      <path d="M30 40h28v12c0 8-6 14-14 14s-14-6-14-14Z" fill={C.accent} />
      <path d="M38 28v12M50 28v12" stroke={C.ink} strokeWidth={5} {...stroke} />
      <path d="M44 66v10" stroke={C.deep} strokeWidth={6} {...stroke} />
      <path d="M70 30l-8 12h7l-4 12 11-15h-7l4-9Z" fill={C.star} className="ill-twinkle" />
    </Spot>
  );
}

/** One spot illustration per catalogue category (decision 2026-11-02 "SpareVillage-style redesign"). */
export const CATEGORY_ART: Record<CategoryKey, (p: Props) => ReactElement> = {
  tyres: Tyres,
  lubricants: Lubricants,
  batteries: Batteries,
  bearings: Bearings,
  filters: Filters,
  spareParts: SpareParts,
  accessories: Accessories,
  workshopTools: WorkshopTools,
  evEssentials: EvEssentials,
};
