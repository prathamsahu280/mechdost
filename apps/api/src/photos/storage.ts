/**
 * Supabase Storage over its REST API (design 2026-11-15; no SDK needed for four calls). The server SECRET key is
 * used here and only here: it never reaches a browser, a log line or an error message. The bucket is private; the
 * browser gets pictures only through the API's image route, after a rights check.
 */
export interface PhotoStorage {
  readonly bucket: string;
  put(path: string, bytes: Buffer): Promise<void>;
  get(path: string): Promise<Buffer | null>;
  remove(path: string): Promise<void>;
  /** Create the private bucket if missing; throws when it exists but is public. Idempotent. */
  ensureBucket(): Promise<void>;
}

export interface StorageConfig {
  url: string;
  secretKey: string;
  bucket: string;
}

const TIMEOUT_MS = 8_000;

export function supabaseStorage(cfg: StorageConfig, fetchImpl: typeof fetch = fetch): PhotoStorage {
  const base = `${cfg.url}/storage/v1`;
  // New-format secret keys (sb_secret_…) go in `apikey`; a legacy service_role JWT also needs the bearer header.
  const auth: Record<string, string> = { apikey: cfg.secretKey };
  if (cfg.secretKey.startsWith('eyJ')) auth.Authorization = `Bearer ${cfg.secretKey}`;
  const objectUrl = (path: string) =>
    `${base}/object/${cfg.bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
  const call = (
    url: string,
    init: { method: string; headers?: Record<string, string>; body?: string | Uint8Array },
  ) =>
    fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { ...auth, ...init.headers },
    });

  return {
    bucket: cfg.bucket,
    async put(path, bytes) {
      const res = await call(objectUrl(path), {
        method: 'POST',
        headers: { 'Content-Type': 'image/webp', 'x-upsert': 'false' },
        body: new Uint8Array(bytes),
      });
      if (!res.ok) throw new Error(`storage put failed (${String(res.status)})`);
    },
    async get(path) {
      const res = await call(objectUrl(path), { method: 'GET' });
      if (res.status === 404 || res.status === 400) return null;
      if (!res.ok) throw new Error(`storage get failed (${String(res.status)})`);
      return Buffer.from(await res.arrayBuffer());
    },
    async remove(path) {
      const res = await call(objectUrl(path), { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(`storage delete failed (${String(res.status)})`);
    },
    async ensureBucket() {
      const found = await call(`${base}/bucket/${cfg.bucket}`, { method: 'GET' });
      if (found.ok) {
        const body = (await found.json().catch(() => null)) as { public?: unknown } | null;
        if (body?.public === true) throw new Error('the photo bucket is public; make it private');
        return;
      }
      const made = await call(`${base}/bucket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: cfg.bucket,
          name: cfg.bucket,
          public: false,
          file_size_limit: 8 * 1024 * 1024,
          allowed_mime_types: ['image/webp'],
        }),
      });
      // 409 / "Duplicate": another instance created it between our check and our create.
      if (!made.ok && made.status !== 409) throw new Error(`bucket create failed (${String(made.status)})`);
    },
  };
}
