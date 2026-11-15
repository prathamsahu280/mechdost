import type { ImageLoaderProps } from 'next/image';
import { productPhotoPath, variantForWidth } from '@mechdost/shared/product-photos';

const API = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');

/**
 * Maps the widths `next/image` asks for onto the three variants the API stores (320, 640, 1600). The photos are
 * already WebP at those sizes, so the Next image optimizer is not involved: no remote pattern, no server work. Kept
 * apart from the component so client screens (the account wishlist) can use it without the server component.
 */
export const productPhotoLoader = ({ src, width }: ImageLoaderProps): string =>
  `${API}/v1${productPhotoPath(src, variantForWidth(width))}`;
