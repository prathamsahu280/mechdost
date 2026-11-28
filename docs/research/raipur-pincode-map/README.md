# Raipur PIN-code map - research (2026-11-28)

Goal: our own PIN map of Raipur, because Nominatim/OSM answers 493332 for most of the city and nearest-post-office lookups mislead. **Ground truth: Sarona = 492099** (founder; also villageinfo.in and a Linc Sarona Heights listing on housing.com).

## Headline finding

A working copy of the **Department of Posts 2025 pincode boundary GeoJSON** exists at `https://geo.bharatviz.org/geojsons/pincodes/chhattisgarh.geojson` (details, licence and caveats in `boundaries.md`). Point-in-polygon puts Sarona in **492099**, matching ground truth, and AIIMS/Tatibandh in 492099. All 473 localities in `localities.csv` get their PIN from it. It is simplified (coarse edges) and has no polygons for 492006, 492007, 492011, 492017.

## Files

- `localities.csv` - 473 rows. Columns: name_en, name_hi, pin, lat, lng, coord_source, pin_sources, confidence, notes.
- `boundaries.md` - every boundary source checked, with licence.
- `raipur-pin-polygons-dop2025-simplified.geojson` - 36 Raipur features for the live PINs (GODL-India origin; confirm the mirror's terms before shipping).
- `scripts/` - `geo.py` (point-in-polygon, edge distance) and `final.py` (the build). Paths point at scratchpad copies of `chhattisgarh.geojson`, GeoNames `IN.txt`, the Overpass JSON and the India Post CSV; adjust before re-running.

## How localities.csv was built (and what it is not)

- Names and coordinates: **GeoNames India dump** (https://download.geonames.org/export/dump/IN.zip, CC BY 4.0, commercial use OK with attribution; populated places, localities and markets within 27 km of the Raipur centre; coordinates are Census-derived and can be 1 km off or point at a same-named village elsewhere) plus **OSM** place nodes/ways (Overpass 2026-11-28, ODbL) for Nava Raipur sectors, chowks and a few colonies. OSM has only ~40 usable named places in the area; GeoNames added ~430. De-duplicated by name and proximity.
- PIN: **point-in-polygon in the DoP polygons**, not copied from any aggregator. The polygon file and the India Post office directory are both Department of Posts data, so they are NOT independent of each other. "High" is therefore reserved for rows with outside evidence (listings, government pages): **only 2 rows are high** (Sarona, Tatibandh). Independent per-colony evidence still has to be collected.
- `name_hi`: filled only where GeoNames or OSM carried a Devanagari name (6 rows). Otherwise empty on purpose; no machine guesses.
- **Confidence counts: high 2, medium 336, low 135.** Low means one of: the name matches an India Post office with a different PIN (84; mostly common village names such as Deori, Nawagaon, Hathband), the point is within 250 m of another PIN's polygon edge (57), or aggregator listings conflict (4). The notes column states the reason.
- Rows per PIN: 492001 26, 492003 4, 492004 3, 492008 2, 492009 7, 492010 3, 492012 4, 492013 6, 492014 21, 492015 13, 492016 1, 492018 18, 492099 18, 492101 29, 493111 29, 493221 35. The Durg/Dhamtari/Abhanpur/Arang ring adds 490021, 490024, 490025, 490036, 490042, 491107, 491111, 491332, 493116, 493225, 493441, 493661.
- **MechDost live PINs with no locality row:** 492002 and 492005 (point-like polygons), **492006, 492007, 492011, 492017 (no polygon; absent from the 2025 India Post CSV and the polygon file)**. 492016 has 1 row, 492008 has 2, 492004 and 492010 have 3: thin.
- Not done: Nominatim name searches, Wikimapia, RMC ward-to-colony mapping, Hindi names, Chhattisgarh Housing Board colony list, per-colony property-listing evidence. Wikipedia ward names are person names, not localities, so they were not added. Overpass (public servers) was busy at first; the one successful place query used a bounding box only.

## Ten most important conflicts

1. **Sarona**: OSM/Nominatim 493332; nearest post office would be 492013 Sunder Nagar; DoP polygon + founder + villageinfo.in + housing.com = 492099. A different Sarona S.O. with 494335 (Bastar) appears on villageinfo.in and mylocationpincode.com, a wrong-village trap for text lookups.
2. **Telibandha**: polygon 492001; aggregators and company addresses say 492006 or 492007; no such polygon exists in the 2025 file.
3. **Saddu**: raipurtalks.com 492007; India Post CSV and polygon 492014.
4. **Shankar Nagar**: raipurtalks.com 492007; CSV and polygon 492004.
5. **Krishak Nagar**: raipurtalks.com and mapsofindia.com 492006; CSV and polygon 492012.
6. **Ravigram**: raipurtalks.com and mapsofindia.com 492006; CSV 492001.
7. **Labhandih**: polygon 492012; weak evidence for 492006 (company address in a search result).
8. **Mowa**: polygon 492014; a housing.com snippet lists it under 492001.
9. **Pandri**: CSV and polygon 492004; mapsofindia lists Pandri under 492001; a Raipur government page gave a Pandri bank address as 492001 (raipur.gov.in/?p=25613).
10. **Nava Raipur**: some sites say 492101 or 492002; polygons put the sectors and Capital Complex in 492018, sectors 2/3/7 in 492101, and 492002 is a tiny rectangle. The OSM Raipur city node carries `postal_code=493332` (wrong: Baloda Bazar).

Underlying pattern: older listings use 492006/492007 and 2025 data uses 492012/492014/492004 for the same offices, so a PIN reorganisation or two data generations exist. MechDost's live list (492001-492018) mixes both; decide whether 492006, 492007, 492011 and 492017 should be remapped, after a check with the local postal office.

## What is missing

Colony-level names (Chhattisgarh Housing Board colonies, Devendra Nagar, Kabir Nagar, Fafadih, Shailendra Nagar, VIP Road and similar) are mostly NOT in GeoNames or OSM. They need to come from RMC/CGHB/real-estate listings with coordinates (for example Nominatim name search plus manual check, or pins placed by the ops team). Ward polygons and Nava Raipur sector polygons do not exist freely.

## Recommended method (points to a map)

1. Use the DoP polygons as the authoritative PIN layer; do not rebuild them from points.
2. Where the polygon file is missing or obsolete (492006, 492007, 492011, 492017 and the old-versus-new conflicts), collect 20+ verified colony points per PIN, each with a source. Compute a Voronoi of those points grouped by PIN, dissolve per PIN, clip to the urban boundary (RMC limit, or the union of the DoP polygons), and review edges on a map with the founder.
3. Use `localities.csv` as a lookup index (name to PIN) and for QA: run every medium/low row against both layers and list disagreements for manual review.
4. Store the final layer in PostGIS (`pin_area` polygon per PIN, city-scoped) with `source` and `reviewed_by` columns; use point-in-polygon at address entry and fall back to the nearest verified locality when no polygon matches.
5. Attribution: Department of Posts, Government of India (GODL-India); GeoNames (CC BY 4.0); OpenStreetMap contributors (ODbL).

## Licence flags

- DoP polygons: GODL-India, commercial use OK; the BharatViz mirror has no stated data licence (MIT covers its code only), so confirm.
- GeoNames CC BY 4.0: OK with attribution. OSM ODbL: OK with attribution and share-alike on the derived database.
- datameet/PincodeBoundary is CC BY-SA 2.5 India (share-alike) and has no Raipur: do not use. 1acre.in, ESRI and GeoPostcodes layers are not open.
