import { describe, expect, it } from 'vitest';
import { tlsFor } from '../src/client';

describe('database connections are encrypted in transit (spec 13)', () => {
  it('requires TLS for any non-local database', () => {
    expect(tlsFor('postgresql://u:p@aws-0-ap-south-1.pooler.supabase.com:6543/postgres', {})).toBe('require');
  });
  it('refuses to start in production without certificate verification (no MITM downgrade)', () => {
    expect(() =>
      tlsFor('postgresql://u:p@aws-0-ap-south-1.pooler.supabase.com:6543/postgres', {
        NODE_ENV: 'production',
      }),
    ).toThrow(/DATABASE_CA_CERT is required in production/);
  });
  it('allows plain connections only to this machine', () => {
    expect(tlsFor('postgresql://postgres:postgres@127.0.0.1:54322/postgres', {})).toBe(false);
    expect(tlsFor('postgresql://postgres:postgres@localhost:5432/postgres', {})).toBe(false);
  });
});
