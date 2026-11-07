import { C } from './palette';
import { Ground, Sparkle, Wheel } from './parts';

interface Props {
  className?: string;
}

const svgProps = { viewBox: '0 0 560 420', 'aria-hidden': true, focusable: false } as const;

/** Hatchback side view; wheels sit on y = ground - r. */
function Hatchback({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${String(x)} ${String(y)})`}>
      <path
        d="M0 88c0-22 8-30 26-34l40-6c20-30 42-46 76-48h50c30 0 48 14 62 36l8 14c12 4 18 14 18 28v10c0 8-6 12-14 12H14C6 100 0 96 0 88Z"
        fill={C.accent}
      />
      <path d="M76 48c16-24 32-34 62-34h14v34Z" fill={C.surface} opacity={0.92} />
      <path d="M164 14h26c20 0 34 10 46 28l2 6h-74Z" fill={C.surface} opacity={0.92} />
      <path d="M158 54v40" stroke={C.deep} strokeWidth={2.5} strokeLinecap="round" />
      <path d="M140 66h10" stroke={C.deep} strokeWidth={2.5} strokeLinecap="round" />
      <rect x={262} y={62} width={14} height={8} rx={4} fill={C.star} className="ill-twinkle" />
      <rect x={2} y={70} width={10} height={8} rx={3} fill={C.mint} />
      <path d="M22 100h236" stroke={C.deep} strokeWidth={2.5} strokeLinecap="round" opacity={0.5} />
      <Wheel cx={60} cy={102} r={30} />
      <Wheel cx={212} cy={102} r={30} />
    </g>
  );
}

function Scooter({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${String(x)} ${String(y)})`}>
      <path d="M6 70c0-22 18-32 38-32h28c8 0 12 6 10 14l-4 18Z" fill={C.accent} />
      <rect x={40} y={66} width={62} height={10} rx={5} fill={C.deep} />
      <path d="M92 76 110 6" stroke={C.deep} strokeWidth={11} strokeLinecap="round" />
      <path d="M100 46c10-4 20 0 22 12l-6 20H96Z" fill={C.accent} />
      <rect x={20} y={28} width={52} height={12} rx={6} fill={C.tyre} />
      <path d="M102 6 124 0" stroke={C.tyre} strokeWidth={5} strokeLinecap="round" />
      <circle cx={122} cy={20} r={5} fill={C.star} className="ill-twinkle" />
      <Wheel cx={26} cy={88} r={21} />
      <Wheel cx={112} cy={88} r={21} />
    </g>
  );
}

/** Products for your car. Care for your bike: scooter + hatchback beside a stack of parts. */
export function HeroShopScene({ className }: Props) {
  return (
    <svg {...svgProps} className={className}>
      <circle cx={300} cy={200} r={176} fill={C.pale} />
      <circle cx={92} cy={110} r={10} fill={C.mint} opacity={0.7} />
      <circle cx={498} cy={92} r={6} fill={C.mint} />
      <Ground cx={290} cy={372} rx={250} ry={12} />

      <Scooter x={12} y={262} />
      <Hatchback x={150} y={258} />

      {/* Parts stack */}
      <g>
        <rect x={452} y={302} width={86} height={68} rx={10} fill={C.mint} />
        <path d="M452 326h86" stroke={C.deep} strokeWidth={2.5} opacity={0.35} />
        <rect x={462} y={246} width={66} height={56} rx={10} fill={C.accent} />
        <rect x={476} y={262} width={38} height={14} rx={4} fill={C.surface} opacity={0.9} />
      </g>
      {/* Oil can, floating gently on the stack */}
      <g className="ill-float">
        <path d="M478 236v-38c0-6 4-10 10-10h22c6 0 10 4 10 10v38Z" fill={C.deep} />
        <rect x={492} y={176} width={12} height={12} rx={3} fill={C.ink} />
        <path d="M486 212h28" stroke={C.mint} strokeWidth={4} strokeLinecap="round" />
        <path d="M534 168c-6 8-10 14-10 19a10 10 0 0 0 20 0c0-5-4-11-10-19Z" fill={C.mint} />
      </g>
      {/* Spare tyre leaning in front */}
      <g>
        <circle cx={500} cy={346} r={26} fill={C.tyre} stroke={C.line} strokeWidth={1.5} />
        <circle cx={500} cy={346} r={12} fill={C.rim} />
        <circle cx={500} cy={346} r={20} fill="none" stroke={C.muted} strokeWidth={2} strokeDasharray="4 6" />
      </g>
      <g className="ill-twinkle">
        <Sparkle x={420} y={150} s={11} />
        <Sparkle x={150} y={196} s={7} color={C.mint} />
      </g>
    </svg>
  );
}

/** A nearby workshop. A clear estimate: car on a two-post lift, toolboard, checklist. */
export function HeroWorkshopScene({ className }: Props) {
  return (
    <svg {...svgProps} className={className}>
      <circle cx={290} cy={196} r={176} fill={C.pale} />
      <Ground cx={280} cy={372} rx={248} ry={12} />

      {/* Toolboard */}
      <g>
        <rect x={34} y={96} width={118} height={128} rx={14} fill={C.pill} stroke={C.line} strokeWidth={2} />
        <path
          d="M58 120l22 22m0-22-6 6M94 122v52m-8 0h16"
          stroke={C.muted}
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M118 118h14v40c0 4-3 7-7 7s-7-3-7-7Z" fill={C.accent} />
        <circle cx={70} cy={196} r={12} fill="none" stroke={C.accent} strokeWidth={4} />
        <rect x={98} y={186} width={34} height={20} rx={5} fill={C.mint} />
      </g>

      {/* Two-post lift */}
      <g>
        <rect x={176} y={118} width={16} height={252} rx={6} fill={C.line} />
        <rect x={438} y={118} width={16} height={252} rx={6} fill={C.line} />
        <rect x={168} y={110} width={32} height={14} rx={6} fill={C.deep} />
        <rect x={430} y={110} width={32} height={14} rx={6} fill={C.deep} />
        <path d="M192 268h56M382 268h56" stroke={C.muted} strokeWidth={6} strokeLinecap="round" />
      </g>
      {/* Raised car */}
      <g className="ill-float-slow">
        <path
          d="M214 250c0-18 7-25 22-28l33-5c17-25 35-38 63-40h41c25 0 40 12 51 30l7 12c10 3 15 12 15 23v8c0 7-5 10-12 10H226c-7 0-12-3-12-10Z"
          fill={C.accent}
        />
        <path d="M277 217c13-20 26-28 51-28h12v28Z" fill={C.surface} opacity={0.92} />
        <path d="M352 189h21c17 0 28 8 38 23l2 5h-61Z" fill={C.surface} opacity={0.92} />
        <rect x={426} y={232} width={12} height={7} rx={3} fill={C.star} className="ill-twinkle" />
        <Wheel cx={264} cy={262} r={24} spin={false} />
        <Wheel cx={390} cy={262} r={24} spin={false} />
      </g>

      {/* Clipboard checklist */}
      <g className="ill-float">
        <rect
          x={462}
          y={226}
          width={82}
          height={112}
          rx={12}
          fill={C.surface}
          stroke={C.line}
          strokeWidth={2.5}
        />
        <rect x={486} y={216} width={34} height={18} rx={6} fill={C.deep} />
        {[256, 284, 312].map((y, i) => (
          <g key={y}>
            <circle cx={480} cy={y} r={8} fill={i < 2 ? C.accent : C.pill} />
            {i < 2 ? (
              <path
                d={`M476 ${String(y)}l3 3 6-6`}
                stroke={C.surface}
                strokeWidth={2.5}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
            <rect x={494} y={y - 4} width={i === 2 ? 30 : 38} height={8} rx={4} fill={C.line} />
          </g>
        ))}
      </g>
      <g className="ill-twinkle">
        <Sparkle x={316} y={96} s={11} />
        <Sparkle x={108} y={268} s={7} color={C.mint} />
      </g>
    </svg>
  );
}

/** How your order reaches you: van on a curving road from a local shop to a home, linked by map pins. */
export function HeroDeliveryScene({ className }: Props) {
  return (
    <svg {...svgProps} className={className}>
      <circle cx={280} cy={204} r={176} fill={C.pale} />
      <Ground cx={280} cy={380} rx={240} ry={10} />

      {/* Road */}
      <path d="M-10 372C120 340 160 268 280 262s200-40 290-92" stroke={C.pill} strokeWidth={46} fill="none" />
      <path
        d="M-10 372C120 340 160 268 280 262s200-40 290-92"
        stroke={C.surface}
        strokeWidth={3}
        strokeDasharray="14 14"
        strokeLinecap="round"
        fill="none"
      />

      {/* Shop */}
      <g>
        <rect
          x={58}
          y={150}
          width={104}
          height={84}
          rx={10}
          fill={C.surface}
          stroke={C.line}
          strokeWidth={2.5}
        />
        <path d="M50 152h120l-10-30H60Z" fill={C.accent} />
        <path
          d="M74 152v12m24-12v12m24-12v12m24-12v12"
          stroke={C.surface}
          strokeWidth={6}
          strokeLinecap="round"
        />
        <rect x={74} y={182} width={30} height={52} rx={4} fill={C.mint} />
        <rect x={116} y={182} width={32} height={24} rx={4} fill={C.pill} />
      </g>
      {/* Home */}
      <g>
        <path
          d="M398 110l58-44 58 44v74c0 5-4 9-9 9H407c-5 0-9-4-9-9Z"
          fill={C.surface}
          stroke={C.line}
          strokeWidth={2.5}
        />
        <path
          d="M388 116l68-54 68 54"
          stroke={C.deep}
          strokeWidth={8}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <rect x={442} y={140} width={28} height={53} rx={4} fill={C.accent} />
        <rect x={414} y={128} width={18} height={18} rx={3} fill={C.mint} />
      </g>

      {/* Route between the pins */}
      <path
        d="M110 100C210 40 340 36 456 54"
        stroke={C.accent}
        strokeWidth={2.5}
        strokeDasharray="2 9"
        strokeLinecap="round"
        fill="none"
        opacity={0.7}
      />
      <g className="ill-float">
        <path d="M110 112c-14-16-22-27-22-38a22 22 0 0 1 44 0c0 11-8 22-22 38Z" fill={C.deep} />
        <circle cx={110} cy={74} r={8} fill={C.surface} />
      </g>
      <g className="ill-float-slow">
        <path d="M456 58c-12-13-18-22-18-31a18 18 0 0 1 36 0c0 9-6 18-18 31Z" fill={C.accent} />
        <circle cx={456} cy={27} r={6.5} fill={C.surface} />
      </g>

      {/* Van */}
      <g transform="translate(216 196)">
        <path d="M0 64V22C0 14 6 8 14 8h88v56Z" fill={C.accent} />
        <path d="M102 20h26c8 0 14 4 18 10l14 18c3 4 4 8 4 12v4h-62Z" fill={C.deep} />
        <path d="M112 28h18l14 20h-32Z" fill={C.surface} opacity={0.92} />
        <path d="M20 30h60M20 44h40" stroke={C.mint} strokeWidth={5} strokeLinecap="round" />
        <rect x={156} y={52} width={8} height={7} rx={3} fill={C.star} className="ill-twinkle" />
        <Wheel cx={34} cy={68} r={15} />
        <Wheel cx={130} cy={68} r={15} />
      </g>
      <g className="ill-twinkle">
        <Sparkle x={300} y={132} s={10} />
      </g>
    </svg>
  );
}
