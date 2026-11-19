# SEO and Google Search Console

What the site does for search engines, how to check it, and the one-time Google Search Console setup (2026-11-17,
decisions "2026-11-17 — SEO"). Code: `apps/web/src/lib/seo.ts`, `src/lib/structured-data.ts`,
`src/lib/sitemap-entries.ts`, `src/app/robots.ts`, `src/app/sitemap.ts`; tests `apps/web/test/seo.test.ts`.

## 1. What is built

| Piece                 | Where / rule                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `robots.txt`          | `/robots.txt`. Allows everything except the private screens (account, admin, portals, cart, checkout, compare, sign-in, notifications, order / service / quote / application records, partner invite links) in both languages, and `/api/`; allows the Bulk orders form `/quotes/new`. Points to the sitemap.                                                                              |
| `sitemap.xml`         | `/sitemap.xml`, rebuilt on request at most hourly in demo mode and every 30 s with real data (the catalogue fetch's cache, ISR). Open in both data modes (user 2026-11-19). Every public page in English and Hindi (incl. Bulk orders `/quotes/new`), each with its `hreflang` pair; the 9 category pages; every product; every real workshop (API mode). Demo workshops are never listed. |
| Titles + descriptions | From the locale files, namespace `seo` (+ `meta` for the home page), English and Hindi. Pattern: what + where ("… in Raipur"). The layout adds `· MechDost`. Copy based on the competitor study in § 5.                                                                                                                                                                                    |
| Canonical + hreflang  | Every public page: its own canonical, `en` / `hi` / `x-default` alternates (`alternatesFor`). The shop with one category is its own canonical (`/shop?category=lubricants`); sort, vehicle and page parameters point back to it; a search result (`?q=`) is `noindex, follow`.                                                                                                             |
| Open Graph            | Site-wide default share image; product pages share the product photo; pages with their own title set `og:url`, title and description (`openGraphFor`).                                                                                                                                                                                                                                     |
| Structured data       | Home: `Organization` + `WebSite`. Product: `BreadcrumbList` always; `Product` + `Offer` (INR, stock, seller) + `AggregateRating` **in API mode only**. Workshop: `BreadcrumbList`; `AutoRepair` (address, geo, hours, price range, services, rating) **in API mode only**. Home FAQ: `FAQPage`.                                                                                            |
| `noindex`             | Private screens (as before), search results, and demo workshop pages (they are not real businesses).                                                                                                                                                                                                                                                                                       |

Why API mode only for products and workshops: the demo build's prices and seed reviews are not real, and Google treats
structured data that does not match reality as spam (manual action risk). Breadcrumbs and the organisation are true in
both modes.

## 2. Checks after a deploy (2 minutes)

```bash
curl -s https://mechdost.com/robots.txt
curl -s https://mechdost.com/sitemap.xml | grep -c '<url>'          # demo: ~96, real data: grows with the catalogue
curl -s https://mechdost.com/shop | grep -o '<link rel="canonical"[^>]*>'
curl -s https://mechdost.com/ | grep -o 'application/ld+json'        # structured data present
```

Paste a product and a workshop URL into the Rich Results Test (https://search.google.com/test/rich-results) once the
site runs on real data: Product (merchant listing) and Breadcrumb must show "valid".

## 3. Google Search Console: one-time setup (you)

Do this **after** this change is deployed (so `robots.txt` and `sitemap.xml` are live).

1. Open https://search.google.com/search-console and sign in with the Google account that should **own** MechDost's
   search data long-term (a company account, not a personal one if possible).
2. **Add property → Domain** (left box), type `mechdost.com` (no `https://`, no `www`). A Domain property covers
   `https`, `http`, `www` and `api.mechdost.com` in one go.
3. Google shows a TXT record like `google-site-verification=AbC…`. Copy it.
4. At the registrar where mechdost.com's DNS lives (the nameservers are `dns-parking.com`, i.e. Hostinger, see
   `deploy.md` § 3.6): DNS / Nameservers → **DNS records → Add record**: Type `TXT`, Name / Host `@`, Value = the
   copied string, TTL default. **Do not change or delete the existing A / CNAME / MX / TXT records** (the site, email
   and Resend depend on them).
5. Back in Search Console press **Verify**. If it fails, wait 10-60 minutes and press again (DNS takes time). Check with
   `nslookup -type=TXT mechdost.com`.
6. **Sitemaps** (left menu) → enter `sitemap.xml` → Submit. Status should become "Success" with the discovered URLs (~96 on demo data).
7. **URL inspection** (top search bar): inspect `https://mechdost.com/`, then **Request indexing**. Repeat for
   `https://mechdost.com/hi`, `/shop`, `/workshops`, `/partners` (Google allows roughly 10 requests a day).
8. **Settings → Users and permissions → Add user**: add a second owner as backup (whoever else runs the business).
9. Optional, 2 minutes: Bing Webmaster Tools (https://www.bing.com/webmasters) → **Import from Google Search Console**.
   Covers Bing, DuckDuckGo and Yahoo.
10. Optional but strongly recommended for Raipur searches: a **Google Business Profile** for MechDost
    (https://business.google.com), with the registered address, the support number 7978776551, website
    `https://mechdost.com`, and categories "Auto parts store" and "Car repair and maintenance service". Local results
    ("near me", maps) come mostly from Business Profiles, not from the website.

Nothing needs to go into the code or `.env` for verification (DNS method). If you'd rather use the HTML-tag
method, say so: it needs a new build variable.

## 4. What to watch, and when

| When                   | Where in Search Console                       | What good looks like                                                                                       |
| ---------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 2-7 days               | Indexing → Pages                              | Public pages "Indexed"; private screens under "Blocked by robots.txt" or "Excluded by noindex" (expected). |
| 1-2 weeks              | Search results (Performance)                  | Impressions for "MechDost", then for "engine oil Raipur", "car service Raipur".                            |
| After real data launch | Enhancements → Breadcrumbs, Merchant listings | Valid items; fix any "missing field" errors that Google lists (warnings are optional).                     |
| Monthly                | Experience → Core Web Vitals                  | All URLs "Good" (spec 16 budgets).                                                                         |

**At the launch switch to real data (Q89):** re-submit `sitemap.xml` (real products and workshops join it by themselves, and product / workshop structured data switches on). Demo product URLs that no longer exist return
404 and Google drops them by itself; nothing to do.

## 5. Competitor study (2026-11-17) and next steps

Looked at GoMechanic, CarDekho / BikeDekho, Boodmo, Koovers, SparesHub and the Raipur results (carchhe, Tata Green
Batteries and TotalEnergies store locators). What ranks: city in the title and H1, city × service landing pages
(`/raipur/car-service`), locality pages, price tables ("Battery price list in Raipur, 2026"), city-specific FAQs with
`FAQPage`, `AutoRepair` markup with ratings, per-type sitemaps, Hindi titles written fully in Devanagari (CarDekho; the
half-English BikeDekho Hindi page is the anti-pattern). Boodmo ships an empty HTML shell (no SEO without JS); we render
everything on the server. No national booking aggregator ranks for Raipur yet, so good local pages can rank quickly.

Next steps, queued in `docs/questions-for-user.md` (Q199-Q200):

- City landing pages `/raipur`, `/raipur/car-service`, `/raipur/bike-service`, `/raipur/battery-replacement` (and Hindi),
  each with real workshops/products, a live price table and city FAQs. Only where there is real inventory (thin
  doorway pages get demoted). Needs the city selector (spec 15) or a city route segment.
- Vehicle-fitment listings (`/shop?vehicle=…` landing pages, e.g. "batteries for Honda Activa") once fitment data is
  in the catalogue.
- A sitemap index split by type when the catalogue passes ~2,000 products (`MAX_PRODUCT_PAGES` in
  `sitemap-entries.ts`).
- AI answer-engine crawlers (GPTBot, ClaudeBot, PerplexityBot): currently allowed like every crawler.
