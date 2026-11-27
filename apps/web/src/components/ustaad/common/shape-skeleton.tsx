/**
 * Loading shapes for member pages (UI upgrade U1, design § 7.3): boxes in the real page's shape inside the reserved
 * content column, shown only after 300 ms (`skeleton-late`, CSS only) so a fast load never flashes them. Every box is
 * decorative; the region says it is busy. Server-renderable, no client code. Each batch adds its own variant here
 * only through U1 (this file is U1's); pages pick one.
 */
export type ShapeVariant = 'home' | 'card' | 'list' | 'thread';

const box = 'skeleton rounded-card';

function Shapes({ variant }: { variant: ShapeVariant }) {
  if (variant === 'home')
    return (
      <>
        <div className="flex h-24 gap-3 overflow-hidden" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="skeleton size-16 shrink-0 rounded-full" />
          ))}
        </div>
        <div className={`${box} h-[120px]`} />
        <div className={`${box} h-72`} />
        <div className={`${box} h-72`} />
      </>
    );
  if (variant === 'card')
    return (
      <>
        <div className={`${box} h-[280px]`} />
        <div className={`${box} h-[120px]`} />
      </>
    );
  if (variant === 'thread')
    return (
      <>
        <div className={`${box} h-40`} />
        <div className={`${box} h-24`} />
        <div className={`${box} h-24`} />
      </>
    );
  return (
    <>
      <div className={`${box} h-20`} />
      <div className={`${box} h-20`} />
      <div className={`${box} h-20`} />
    </>
  );
}

export function ShapeSkeleton({ variant }: { variant: ShapeVariant }) {
  return (
    <div aria-busy="true" className="skeleton-late mx-auto grid w-full max-w-2xl gap-4" data-shape={variant}>
      <Shapes variant={variant} />
    </div>
  );
}

/** Which shape a member path shows while it loads (canonical path, no locale). */
export function shapeForPath(path: string): ShapeVariant {
  if (path === '/ustaad') return 'home';
  if (path === '/ustaad/me' || path.startsWith('/ustaad/u/')) return 'card';
  if (/^\/ustaad\/(q|p|messages)\/[^/]+/.test(path)) return 'thread';
  return 'list';
}

/**
 * The neutral frame (design § 7.1): the final geometry of the network shell — a 56 px header bar, the content column
 * filling the screen and a 64 px dock area — with **no network words**, so the staff-preview gate can swap it for the
 * real shell without anything below moving and without telling outsiders what the page is.
 */
export function NeutralFrame() {
  return (
    <div aria-hidden="true">
      <div className="sticky top-0 z-30 h-14 border-b border-line bg-surface" />
      <div className="mx-auto min-h-[calc(100dvh-56px-64px)] w-full max-w-[1200px] px-4 pt-4" />
      <div className="fixed inset-x-0 bottom-0 z-40 h-16 border-t border-line bg-surface nav:hidden" />
    </div>
  );
}
