# Raipur service-area PIN codes (research 2026-11-14)

Reference data for `packages/db/seed/raipur-pincodes.json` (loaded with `pnpm db:seed:pincodes`; spec 15
"PIN codes"). User 2026-11-14: "do all Raipur PINs but make it admin configurable".

## Sources

1. **data.gov.in, All India Pincode Directory** (resource `5c2f62fe-5afa-4119-a499-fec9d604d5bd`, updated
   2025-10-03): every record with `district = RAIPUR` (672 rows, paged), then each PIN by `filters[pincode]`.
   Gives office name, office type (HO/SO/BO), delivery status, district and coordinates.
   `https://api.data.gov.in/resource/5c2f62fe-5afa-4119-a499-fec9d604d5bd?format=json&filters[district]=RAIPUR`
2. **India Post office lists** via the public mirror `https://api.postalpincode.in/pincode/<pin>` and
   `/postoffice/<name>`. They have no coordinates, and they still use the district boundaries from before 2012.
3. **OpenStreetMap Nominatim** to cross-check every centroid. Queries:
   - `https://nominatim.openstreetmap.org/search?postalcode=<pin>&country=in&format=json`;
   - free-text searches for the locality or post-office node.

   Requests used a generic User-Agent, at about one per second.

4. Web pages were used only to support two PINs:
   - 492002 is the Nava Raipur capital-complex PIN;
   - 492017 is the IBC Raipur post office.

## Method

- **Which PINs are in Raipur district.** The Raipur district PINs are the PINs of the Raipur Postal Division.
  data.gov.in also labels some Bastar Division offices and one Bikaner office as RAIPUR; those were ignored.
- **Choosing the centroid.** The default is the mean of the data.gov.in coordinates of the PIN's offices. Many of
  those coordinates are wrong (see the caveats), so they were discarded when:
  - they are a known filler value (21.5/81.5, 21.5/81.2, 20.5/81.7, or a copy of another office);
  - they are more than about 5 km from the OSM locality or Nominatim postcode point.

  In those cases the OSM locality coordinates were used instead. Every centroid lies inside Raipur district (about
  lat 20.9–21.6, lng 81.3–82.1). The seed and the admin API check again that each is in India and within 150 km of
  the city centre.

- **Hindi names.** OSM has no `name:hi` tags for these offices. The Hindi names are transliterations of how the
  localities are written locally, which is the rule for locality names (design system § Hindi content).

## The list

**Active: the Raipur city service area (19 PINs).** This covers Raipur Municipal Corporation, Birgaon, Nava Raipur
and the urban fringe.

| PIN    | Area (English)                           | Area (Hindi)                        | Lat      | Lng      | Centroid source                                          |
| ------ | ---------------------------------------- | ----------------------------------- | -------- | -------- | -------------------------------------------------------- |
| 492001 | Raipur GPO (Jaistambh Chowk)             | रायपुर जीपीओ (जयस्तंभ चौक)          | 21.23506 | 81.63902 | data.gov.in mean of 9 offices; Nominatim 1.3 km away     |
| 492002 | Mantralaya (Nava Raipur)                 | मंत्रालय (नवा रायपुर)               | 21.15903 | 81.79554 | OSM capital complex, Sector 19 (data.gov.in point wrong) |
| 492003 | Urla                                     | उरला                                | 21.30833 | 81.61776 | data.gov.in; OSM Urla agrees                             |
| 492004 | Pandri / Shankar Nagar                   | पंडरी / शंकर नगर                    | 21.25457 | 81.65708 | data.gov.in mean; Nominatim agrees                       |
| 492005 | Vidhan Sabha                             | विधानसभा                            | 21.28935 | 81.72292 | OSM Vidhan Sabha (data.gov.in copy of the HO point)      |
| 492008 | WRS Colony / Khamtarai                   | डब्ल्यूआरएस कॉलोनी / खमतराई         | 21.27664 | 81.64028 | data.gov.in; OSM post office agrees                      |
| 492009 | Gudhiyari / Raipur Ganj                  | गुढ़ियारी / रायपुर गंज              | 21.26619 | 81.62225 | data.gov.in (Gudhiyari); Nominatim agrees                |
| 492010 | Ravishankar University / Science College | रविशंकर विश्वविद्यालय / साइंस कॉलेज | 21.24616 | 81.60007 | OSM university + data.gov.in Science College             |
| 492012 | Krishak Nagar                            | कृषक नगर                            | 21.23784 | 81.70542 | data.gov.in; OSM IGKV campus agrees                      |
| 492013 | Sunder Nagar / Raipura                   | सुंदर नगर / रायपुरा                 | 21.22746 | 81.60962 | OSM post office node + Nominatim (data.gov.in 10 km off) |
| 492014 | Saddu                                    | सड्डू                               | 21.2667  | 81.66832 | Nominatim postcode centroid (least certain, ±2 km)       |
| 492015 | Mana Camp                                | माना कैंप                           | 21.19331 | 81.71706 | data.gov.in; OSM Mana agrees                             |
| 492016 | Mana Basti                               | माना बस्ती                          | 21.19515 | 81.70342 | OSM Mana (data.gov.in copy of the HO point)              |
| 492017 | IBC Raipur (near the railway station)    | आईबीसी रायपुर (रेलवे स्टेशन के पास) | 21.2514  | 81.6296  | data.gov.in                                              |
| 492018 | Nava Raipur Atal Nagar (Sector 27)       | नवा रायपुर अटल नगर (सेक्टर 27)      | 21.14091 | 81.78495 | OSM Sector 27 (data.gov.in near Durg, wrong)             |
| 492099 | Tatibandh                                | टाटीबंध                             | 21.25956 | 81.57744 | data.gov.in; OSM post office and Nominatim agree         |
| 492101 | Mandir Hasaud                            | मंदिर हसौद                          | 21.22601 | 81.77376 | OSM locality (data.gov.in 19 km off)                     |
| 493111 | Mandhar / Siltara                        | मांढर / सिलतरा                      | 21.33763 | 81.70471 | OSM locality (data.gov.in 30 km off)                     |
| 493221 | Birgaon                                  | बिरगांव                             | 21.30867 | 81.63692 | data.gov.in; OSM Birgaon agrees                          |

**Loaded switched off, reason `outside_service_area` (6 PINs).** These are in the rest of Raipur district. The
admin can switch any of them on in Admin → Settings → Service area.

| PIN    | Area           | Hindi         | Lat      | Lng      | Centroid source                      |
| ------ | -------------- | ------------- | -------- | -------- | ------------------------------------ |
| 493114 | Tilda-Neora    | तिल्दा-नेवरा  | 21.55043 | 81.79576 | OSM locality                         |
| 493116 | Baikunth       | बैकुंठ        | 21.49357 | 81.78531 | data.gov.in; OSM agrees              |
| 493225 | Kharora        | खरोरा         | 21.40041 | 81.92638 | OSM locality (data.gov.in wrong)     |
| 493441 | Arang          | आरंग          | 21.19294 | 81.96708 | data.gov.in; OSM agrees              |
| 493661 | Abhanpur       | अभनपुर        | 21.05339 | 81.747   | data.gov.in; OSM agrees              |
| 493881 | Gobra Nawapara | गोबरा नवापारा | 20.96755 | 81.85887 | OSM locality (data.gov.in 45 km off) |

**Left out of the file.**

| PIN            | Why                                                                                                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 492006, 492007 | Not India Post PINs: no records in data.gov.in or India Post. They are used informally for Telibandha/VIP Road and Shankar Nagar, and appear on OSM objects. See the note below. |
| 492011         | Does not exist.                                                                                                                                                                  |
| 492109         | Panduka is in Gariaband district.                                                                                                                                                |
| 490042         | Kumhari is in Durg district. It is 12 km west of Tatibandh, so adding it is a business decision.                                                                                 |
| 493885         | Rajim/Champaran: the head office is in Gariaband district; only four branch offices are in Raipur district.                                                                      |
| 493195         | Hirmi: the head office is in Baloda Bazar district; only two branch offices are in Raipur district.                                                                              |

## Caveats and calls to confirm (inbox Q96)

- **data.gov.in coordinates are mostly unusable for Raipur Division.** About 70% of the branch offices carry filler
  values. Twelve centroids were replaced with OSM points (marked in the tables above).
- **492016, 492017 and 492018 are only in data.gov.in.** They are newer offices, and the India Post mirror has no
  record of them.
- **492017 IBC Raipur is a single business office.** It is kept active so that a typed PIN still resolves.
- **492002 may still be written on central-Raipur addresses.** Both of its possible locations are inside the
  service area.
- **Boundary calls on the fringe.** 493111 Mandhar/Siltara (industrial area, about 12 km out) and 492101 Mandir
  Hasaud (about 15 km out, on the Nava Raipur corridor) are active. The admin can switch either one off.
- **The launch database already has 492006 and 492007**, from the reference data kept at the 2026-11-14 reset.
  - The seed never touches PINs that are not in its file, so they stay active and unnamed.
  - Default: keep them, because customers type them.
  - The admin can name them (Edit) or switch them off (reason `other`) in the console.
