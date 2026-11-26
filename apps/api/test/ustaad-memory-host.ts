/** In-memory media host for Ustaad API tests (spec 23 § 10): objects keyed by bucket and key. */
import type { UstaadMediaBucket } from '@mechdost/shared/ustaad/codes';
import type { MediaHost } from '../src/ustaad/media/host';

export class MemoryHost implements MediaHost {
  readonly id = 'supabase' as const;
  readonly maxFileBytes = 50 * 1024 * 1024;
  readonly supportsMultipart = false;
  readonly objects = new Map<string, { bytes: Uint8Array; mime: string }>();
  private k = (b: UstaadMediaBucket, key: string) => `${b}:${key}`;
  presignPut(bucket: UstaadMediaBucket, key: string, file: { mime: string; bytes: number }) {
    return Promise.resolve({
      url: `memory://${bucket}/${key}`,
      headers: { 'content-type': file.mime },
      method: 'PUT' as const,
    });
  }
  createMultipart(): Promise<{ uploadId: string }> {
    return Promise.reject(new Error('no multipart'));
  }
  presignPart(): Promise<{ url: string; headers: Record<string, string> }> {
    return Promise.reject(new Error('no multipart'));
  }
  completeMultipart(): Promise<void> {
    return Promise.reject(new Error('no multipart'));
  }
  head(bucket: UstaadMediaBucket, key: string) {
    const o = this.objects.get(this.k(bucket, key));
    return Promise.resolve(o ? { bytes: o.bytes.byteLength, mime: o.mime } : null);
  }
  getRange(bucket: UstaadMediaBucket, key: string, start: number, end: number) {
    const o = this.objects.get(this.k(bucket, key));
    if (!o) return Promise.reject(new Error('missing'));
    return Promise.resolve(o.bytes.subarray(start, end + 1));
  }
  /** Test hook: runs after every copy (an attacker re-uploading to the URL they were given). */
  afterCopy: ((from: string) => void) | null = null;
  copy(from: UstaadMediaBucket, key: string, to: UstaadMediaBucket, toKey: string) {
    const o = this.objects.get(this.k(from, key));
    if (!o) return Promise.reject(new Error('missing'));
    this.objects.set(this.k(to, toKey), o);
    this.afterCopy?.(this.k(from, key));
    return Promise.resolve();
  }
  presignGet(bucket: UstaadMediaBucket, key: string, ttlSec: number) {
    return Promise.resolve(`memory://${bucket}/${key}?ttl=${String(ttlSec)}`);
  }
  put(bucket: UstaadMediaBucket, key: string, bytes: Uint8Array, mime: string) {
    this.objects.set(this.k(bucket, key), { bytes, mime });
    return Promise.resolve();
  }
  remove(bucket: UstaadMediaBucket, key: string) {
    this.objects.delete(this.k(bucket, key));
    return Promise.resolve();
  }
  /** What the phone does with the presigned PUT. */
  upload(url: string, bytes: Uint8Array, mime: string) {
    const [, bucket, ...rest] = /^memory:\/\/([a-z]+)\/(.+)$/.exec(url) ?? [];
    this.objects.set(`${bucket ?? ''}:${rest.join('/')}`, { bytes, mime });
  }
}
