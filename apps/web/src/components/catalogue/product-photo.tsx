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
    ...(photo.lqip ? { placeholder: 'blur' as const, blurDataURL: photo.lqip } : {}),
  });
  const shape =
    size === 'hero'
      ? 'aspect-square rounded-card'
      : size === 'thumb'
        ? 'aspect-square rounded-tile'
        : 'aspect-[4/3] rounded-tile';
  return (
    <div className={`relative overflow-hidden bg-white ${shape} ${className}`}>
      <img {...props} className="size-full object-contain" />
    </div>
  );
}
