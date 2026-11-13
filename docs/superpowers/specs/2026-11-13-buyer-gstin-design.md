# Buyer GSTIN at checkout: short design

User request (2026-11-13, decisions entry "Seller onboarding, price approval, buyer GSTIN, comparison", item 2): customers may add a GSTIN at checkout, optionally, for a GST invoice.

## Intent

A workshop, fleet owner or business buying parts wants an invoice with its GSTIN so it can claim input tax credit. Most shoppers never see the field.

## What it does

- **Checkout:** a "Business purchase (GST invoice)" checkbox under the address, off by default. Ticked, it shows **GSTIN** and **Business name (as on GST)**. The GSTIN is checked with the shared checksum (`isGstin`); a wrong one shows an error next to the field, like the seller form.
- **State check:** the first two digits of the GSTIN are its state. When that state is not the delivery state, a note (not an error) says: "This GSTIN is registered in {state}. Goods delivered in Chhattisgarh are invoiced with Chhattisgarh as the place of supply." The order can still be placed.
- **Stored on the order:** `order_groups.gstin` and `order_groups.business_name` (columns already exist, unused), as a snapshot. A database CHECK on the GSTIN format, like `shops.gstin`. Sub-orders inherit them through the group.
- **Shown back:** the order page and the shop's order card show "GST invoice for {business} ({GSTIN})". Invoices are not issued yet; when the invoice work lands, a group with a GSTIN gets a B2B invoice.
- **Shops:** every shop that can be priced or routed is GST-registered already (seller-onboarding guard), so any shop can issue the B2B invoice.

## Approaches considered

1. **Plain columns on `order_groups` with a format CHECK (recommended).** The columns exist; a GSTIN is a public business identifier printed on every invoice; nothing to decrypt for invoicing.
2. **Encrypted like seller KYC.** Adds key handling for data that is public on the GST portal and must be printed anyway. Not worth it.
3. **Saved business profile on the account** (reuse the GSTIN next time). Useful later; P1, not in this change.

## Rules

- Zod `.strict()` on the checkout input: `business` is optional `{ gstin, businessName }`; both or neither.
- No GSTIN or business name in analytics: the checkout event carries `businessPurchase: true|false` only.
- English and Hindi strings; the Hindi crawl covers checkout.
- Admin can see the GSTIN on the order (support for invoice questions).

## Tests

- Shared: GSTIN schema accepts a valid GSTIN and rejects a bad checksum.
- DB: the CHECK refuses a malformed GSTIN; placing with a business purchase stores both fields on the group.
- API: checkout with `business` stores it; a bad GSTIN is 422 next to the field; half-filled is 422.
- e2e: tick business purchase, wrong GSTIN error, valid GSTIN from another state shows the note, order page shows "GST invoice for …"; unticked checkout unchanged.

## Left to the builder

Exact placement in the checkout form and the state-name list (from the GST state codes).

## As built (2026-11-13)

Built as designed (commits 114678c, b270a6b, 12ff0f1, 05e1c56). Builder calls:

- The demo website uses its single demo city's GST state (`apps/web/src/demo/city.ts`); in API mode the quote's `deliveryStateCode` gives the delivery state per PIN.
- The form checks with the Zod-free `isGstin`/`normaliseGstin` (same rules as `BusinessPurchaseSchema`), keeping Zod out of the page bundle.
- The "GST invoice for …" line lives in the `order` namespace, which the order page, the shop portal and the admin console all load.
- A bad or half-filled `business` is a **400** `VALIDATION` with the field path (`business.gstin`), the API's standard body-validation answer, not 422 as written in "Tests" above.
