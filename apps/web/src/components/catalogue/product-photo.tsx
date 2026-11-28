import { getImageProps } from 'next/image';
import type { CataloguePhoto } from '@mechdost/shared/catalogue';
import { productPhotoLoader } from '@/lib/product-photo-loader';

export { productPhotoLoader };

/**
 * A product photo, rendered on the server with `getImageProps` (spec 02, design 2026-11-15): the browser gets a plain
 * `<img>` with width, height, `srcset`, the stored placeholder as its background while loading, and lazy loading;
 * no client JavaScript at all, which keeps the shop pages inside their budget (spec 16). `priority` is for the one
 * image that is the page's largest paint (the first photo on the product page) and nothing else.
 */
export function ProductPhoto({
  photo,
  sizes,
  priority = false,
  size = 'card',
  className = '',
}: {
  photo: CataloguePhoto;
  sizes: string;
  priority?: boolean;
  size?: 'card' | 'hero' | 'thumb';
  className?: string;
}) {
  const { props } = getImageProps({
    src: photo.path,
    alt: photo.alt,
    width: photo.width,
    height: photo.height,
    sizes,
    preload: priority,
    loader: productPhotoLoader,
    // Inline `contain` makes Next size the blur placeholder like the photo (a class would leave it `cover`, so it showed
    // as a haze around the picture once the image fills its box; 2026-11-23).
    style: { objectFit: 'contain' },
    ...(photo.lqip ? { placeholder: 'blur' as const, blurDataURL: photo.lqip } : {}),
  });
  const shape =
    size === 'hero'
      ? 'aspect-square rounded-card'
      : size === 'thumb'
        ? 'aspect-square rounded-inset'
        : 'aspect-[4/3] rounded-inset';
  return (
    <div
      className={`relative flex w-full min-w-0 items-center justify-center overflow-hidden bg-white ${shape} ${className}`}
    >
      {/* Never larger than the stored picture (a small source stays sharp instead of being stretched); the frame's
          aspect ratio is fixed, so nothing shifts while it loads. */}
      <img
        {...props}
        // `min(100%, …)`: an inline px cap alone overrode `max-w-full`, so a photo wider than its card pushed the grid
        // cell open (live 2026-11-23: overlapping cards and a sideways scroll on /shop).
        style={{
          ...props.style,
          maxWidth: `min(100%, ${String(photo.width)}px)`,
          maxHeight: `min(100%, ${String(photo.height)}px)`,
        }}
        className="h-full max-h-full w-full max-w-full object-contain"
      />
    </div>
  );
}
