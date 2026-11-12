# Research: product comparison, buyer GSTIN, seller onboarding (2026-11-13)

Requested by the user on 2026-11-13 (decisions entry "Seller onboarding, price approval, buyer GSTIN, comparison").

**Labels:**

- **[P]** primary text was read.
- **[F]** the page was fetched.
- **[S]** search snippet or secondary source.
- **[U]** not verified.

Confirm tax points with the CA before launch.

## 1. Product comparison

### How others do it

- **CarDekho:** 4 "Add car" slots. Entry points are the navigation, "Compare with" on model cards, and popular pairs. [F] https://www.cardekho.com/compare-cars
- **BikeWale:** a slot picker, plus popular and expert comparisons. [F] https://www.bikewale.com/compare-bikes/
- **Flipkart:** a "Compare" checkbox, same category only. [S] https://www.gonukkad.com/blog/how-to-compare-products-in-flipkart
- **Not verified [U]:** Amazon.in, boodmo, Autodoc, GoMechanic Spares, Koovers, SparesHub.

### Usability research

- **NN/g:**
  - At most about 5 items; 3–4 when the table is built by the user; about 2 at a time on mobile.
  - Say what the limit is; keep column headers sticky; hide rows that are the same for every item.
  - Incomplete attribute data is the biggest problem.
  - [F] https://www.nngroup.com/articles/comparison-tables/
- **Baymard:**
  - Hide identical rows; shading the differences is the fallback.
  - Group attributes; keep the name, image and price sticky.
  - 67 % of participants used comparison on spec-driven sites.
  - On mobile only 3 of 38 participants used it, and one comparison panel took 51 % of the screen, so keep the tray small.
  - [F] https://baymard.com/blog/user-friendly-comparison-tools · https://baymard.com/blog/provide-comparison-features

### Recommendations

- **MUST:**
  - Same category only, at most 4 products, with the count visible.
  - A sticky header with image, name, price and "Add to cart".
  - An "Only differences" toggle, and rows grouped as Price · Fitment · Specs · Warranty.
- **MUST, mobile:** 2 columns visible with horizontal scroll-snap; entry from the product page plus a small tray chip.
- **MUST, accessibility:** a semantic `<table>` with `<caption>` and `<th scope>`; the toggle is a button with `aria-pressed` (https://www.w3.org/WAI/tutorials/tables/).
- **MUST, data:**
  - Typed, coded attributes per category (data for ML, rule 16).
  - Events for add, remove, open, toggle and add-to-cart.

### Attributes by category

- **Engine oil:** SAE grade; API class; JASO MA/MA2 (motorcycles with a wet clutch) vs MB (scooters, where MB oil can make an MA clutch slip); base type; pack size; ₹ per litre. [S] https://www.intertek.com/resources/faqs/2026/automotive-jaso-t903-2023/
- **Tyres:** size, load index, speed symbol, tubeless, tread, front/rear, BIS mark. [S] https://www.apollotyres.com/en-in/stories/blogs/tyre-guides/car-and-bike-tyre-markings/
- **Batteries (domain knowledge, unsourced):** Ah, CCA, warranty (free months plus pro-rata months), dimensions, terminal layout, type.
- **Others (domain knowledge, unsourced):**
  - Brake pads: axle, material, dimensions.
  - Filters: type, OEM cross-reference.
  - Spark plugs: thread and reach, heat range, electrode.

### Unit price (Legal Metrology, Packaged Commodities Rules 2011)

- **Rule 6(11)**, in force 01-01-2024: the unit sale price (₹ per kg/litre/metre/unit, 2 decimals) goes on every pre-packed commodity.
- **Rule 6(10):** e-commerce entities must show the rule 6(1) declarations.
- **Reading, to confirm with counsel:** online display of the unit price is not expressly required, but it is recommended.
- **Rule 6(10-A)**, from 01-07-2026: platforms selling imported goods need a searchable, sortable country-of-origin filter.
- Source: [P] https://www.khaitanco.com/sites/default/files/2026-03/Legal%20Metrology%20%28Packaged%20Commodities%29%20Rules%202011.pdf
- **SHOULD:** show ₹ per litre/unit everywhere.
- **MUST:** capture per listing:
  - net quantity and unit;
  - MRP;
  - country of origin;
  - manufacturer or importer.

## 2. Optional buyer GSTIN at checkout

### GSTIN check

- **Format:** 15 characters. A 2-digit state code, a 10-character PAN, an entity number, a letter (`Z` for normal taxpayers), then a check character.
- **Pattern:** `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$`.
- **Check character (Luhn mod 36):**
  1. Map `0-9A-Z` to 0–35.
  2. For the first 14 characters, multiply each by 1 when its index is even and by 2 when it is odd.
  3. Add `floor(p/36) + p mod 36` for each product `p`.
  4. The check character is `(36 − sum mod 36) mod 36`.
  - Verified: `27AAPFU0939F1ZV` and the company GSTIN both pass.
  - [S] https://arthurdejong.org/python-stdnum/doc/stdnum.in_.gstin

### Invoices (CGST rule 46)

- **Registered buyer:** name, address and GSTIN.
- **Unregistered buyer:**
  - From ₹50,000 of taxable value: name, address, delivery address, and state name and code.
  - Below that, only if the buyer asks.
- **Inter-state:** the place of supply, with the state name.
- **Serial number:** up to 16 characters, unique per financial year.
- [P] https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule46_v1.00.html
- **E-invoicing:** applies to a supplier whose turnover exceeded ₹5 crore (from 01-08-2023); checked per seller. [F] https://einvoice1.gst.gov.in/Others/EinvEnabled
- **Section 52 TCS:** 0.5 % of net taxable value (since 10-07-2024), reported in GSTR-8. [S]
- **Who issues the invoice:** the seller (seller GSTIN, the seller's own series); the platform may generate it on the seller's behalf. **Confirm with the CA:** the series per seller. [S]

### How others ask for it

- **Flipkart:** "Use GST invoice" → GSTIN + business name. It cannot be changed afterwards, and a delivery state that differs from the GSTIN state can lose the input tax credit. [S]
- **Amazon:** an Amazon Business account, with GSTINs saved per state. [S]
- **MUST:**
  - An optional checkbox, then GSTIN and the legal business name.
  - Format and checksum checked in the shared Zod schema; a snapshot on the order.
  - Say that it cannot be changed after invoicing.
  - Warn, never block, when the GSTIN state differs from the delivery state.
- **MUST, routing:** an order with a buyer GSTIN goes only to GST-registered shops.

### Verification

- **GST portal "Search Taxpayer":** free, with a CAPTCHA and no API.
- **GSP and aggregator APIs:** about ₹0.10–₹5 per call.
- **At launch:** format and checksum for buyers; a manual portal check by the admin for sellers.
- **LATER:** an API check of status and legal name.

## 3. Seller onboarding

### Fields

- **What others ask** (Amazon, Flipkart, Meesho):
  - phone and email;
  - GSTIN, PAN, and legal name as on GST;
  - store name;
  - pickup address with PIN;
  - bank account and IFSC;
  - categories.
- **Amazon:** lets sellers skip the GSTIN in categories that do not need GST.
- [S] https://sell.amazon.in/seller-blog/amazon-seller-registration · https://cleartax.in/s/flipkart-seller-registration

### GSTIN or enrolment number

- **Notification 34/2023-CT** (from 01-10-2023) exempts sellers below the registration threshold who sell through a TCS-collecting operator. Conditions:
  - no inter-state supply;
  - one state only;
  - a PAN;
  - an enrolment number from the GST portal before the first sale.
  - [P] https://gstcouncil.gov.in/sites/default/files/2024-05/gst-ct-34-2023.pdf
- **MUST:**
  - Ask for "GSTIN or enrolment number". This is a refinement of the KYC decision "GSTIN or declaration" and is recorded in decisions.
  - Store a `gst_status` code.
  - Enrolled sellers get no inter-state orders and no orders with a buyer GSTIN.

### Location capture

- **Geolocation API:**
  - Only over HTTPS, and only after a tap.
  - Use `enableHighAccuracy` and a timeout, and read `coords.accuracy`.
  - [F] https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition
- **MUST:**
  - Three ways to place the pin: use my location, search, drag the pin.
  - The seller confirms the pin.
  - Store latitude and longitude, accuracy, and how the pin was set.

| Provider                  | Free tier               | Paid                         | Terms that matter                                                      |
| ------------------------- | ----------------------- | ---------------------------- | ---------------------------------------------------------------------- |
| Nominatim (public)        | 1 request/s             | –                            | **No autocomplete**, caching required, attribution, real User-Agent    |
| Photon (komoot)           | Throttled fair use      | –                            | Search-as-you-type allowed; no SLA                                     |
| MapTiler                  | 100,000 requests/month  | Flex $30/month               | Logo required; the free plan is for non-commercial use                 |
| Ola Maps                  | 100,000 calls/API/month | Autocomplete ≈ ₹56 per 1,000 | Prepaid; storage terms not read                                        |
| Google (India price list) | 70,000/SKU/month        | Autocomplete $0.85 per 1,000 | 30-day cache; the 2023 terms barred use with non-Google maps (recheck) |

Sources: https://operations.osmfoundation.org/policies/nominatim/ · https://photon.komoot.io/ · https://www.maptiler.com/cloud/pricing/ · https://maps.olakrutrim.com/pricing · https://developers.google.com/maps/billing-and-pricing/pricing-india

## Top extras (ranked)

1. "Fits your vehicle" row in compare (needs exact fitment, Q76).
2. ₹ per litre/unit on cards, search and compare.
3. Enrolled (non-GST) seller route with a routing guard.
4. Shareable compare URL (product slugs in the query), for WhatsApp.
5. Onboarding save-and-resume with a document checklist and status tracker (English and Hindi).
6. Compare from search results via the tray chip.
7. LATER: GSTIN API check that fills in the legal name.
8. LATER: "Best value" and "Longest warranty" badges from admin-editable rules.
9. LATER: saved business profiles (GSTIN + name) and a B2B order filter.
10. LATER: a plain-language summary of differences; price history.
