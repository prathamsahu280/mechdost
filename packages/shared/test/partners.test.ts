import { describe, expect, it } from 'vitest';
import { InviteSchema, SellerApplicationSchema } from '../src/partners';

const valid = {
  name: 'Ravi Sahu',
  phone: '9876543210',
  email: 'ravi@example.com',
  businessName: 'Sahu Auto Parts',
  shopName: 'Sahu Auto Parts',
  gstStatus: 'registered',
  gstNumber: '22ABVCS4888H1ZL',
  addressLine: 'Shop 4, GE Road, Pandri',
  pincode: '492004',
  location: { lat: 21.25, lng: 81.65, accuracyM: 12, source: 'gps' },
  productSlugs: ['castrol-activ-4t-20w40-900ml', 'exide-xltz4a-2w-battery'],
  consent: true,
};

describe('seller application (design 2026-11-13)', () => {
  it('parses a valid application and normalises the phone to +91', () => {
    const app = SellerApplicationSchema.parse(valid);
    expect(app.phone).toBe('+919876543210');
    expect(app.gstNumber).toBe('22ABVCS4888H1ZL');
  });

  it('the GST number must match the chosen status', () => {
    expect(SellerApplicationSchema.safeParse({ ...valid, gstNumber: '221234567890' }).success).toBe(false);
    expect(
      SellerApplicationSchema.safeParse({ ...valid, gstStatus: 'enrolled', gstNumber: '221234567890' })
        .success,
    ).toBe(true);
    expect(SellerApplicationSchema.safeParse({ ...valid, gstNumber: '22ABVCS4888H1ZM' }).success).toBe(false);
  });

  it('needs at least one product, without duplicates', () => {
    expect(SellerApplicationSchema.safeParse({ ...valid, productSlugs: [] }).success).toBe(false);
    expect(
      SellerApplicationSchema.safeParse({
        ...valid,
        productSlugs: ['castrol-activ-4t-20w40-900ml', 'castrol-activ-4t-20w40-900ml'],
      }).success,
    ).toBe(false);
  });

  it('refuses unknown keys, missing consent, bad PIN and a location without a source', () => {
    expect(SellerApplicationSchema.safeParse({ ...valid, status: 'approved' }).success).toBe(false);
    expect(SellerApplicationSchema.safeParse({ ...valid, consent: false }).success).toBe(false);
    expect(SellerApplicationSchema.safeParse({ ...valid, pincode: '012345' }).success).toBe(false);
    expect(
      SellerApplicationSchema.safeParse({ ...valid, location: { lat: 21.25, lng: 81.65, accuracyM: 12 } })
        .success,
    ).toBe(false);
  });

  it('an invite needs a name, an email and an Indian mobile number', () => {
    expect(
      InviteSchema.parse({ name: 'Asha', email: 'asha@example.com', phone: '+919812345670' }).phone,
    ).toBe('+919812345670');
    expect(InviteSchema.safeParse({ name: 'Asha', email: 'not-an-email', phone: '9812345670' }).success).toBe(
      false,
    );
    expect(
      InviteSchema.safeParse({ name: 'Asha', email: 'asha@example.com', phone: '5812345670' }).success,
    ).toBe(false);
  });
});
