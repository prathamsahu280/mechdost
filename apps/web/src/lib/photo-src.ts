/**
 * An API image URL (`/service-photos/…`, issued by the API after its rights check) as an absolute address for
 * `next/image`. Kept apart from `photos-api.ts` so the viewer pulls in no API client code.
 */
const API = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');

export const photoSrc = (url: string): string => `${API}/v1${url}`;
