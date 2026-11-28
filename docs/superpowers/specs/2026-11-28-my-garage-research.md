# My Garage: research and design demo (2026-11-28)

Founder (2026-11-28 18:10, on phone): "we will be converting my vehicle into my garage type of thing … study
smartgarrage.com … CRED garage … make a really cool addictive ui … make html for it". Answers Q218 (parked 2026-11-23).

Demo: `docs/design/my-garage-2026-11-28/index.html` (also a private artifact for the founder). Example data only.

## Research findings

- **smartgarrage.com** is a Hyderabad two-wheeler servicing website, not a garage app: free pick-up/drop, one-month
  warranty, prices up front (general service from ₹999), a six-step process (diagnosis → estimate → approval → service →
  final check → delivery), "track my vehicle" by phone number. Useful: the transparent step process (MechDost already
  has it in the service request flow) and prices shown before booking.
- **CRED Garage** (launched Sep 2023): add a vehicle by number, live tiles for insurance / PUC / challans / FASTag,
  document storage (DigiLocker reported), maintenance records, fuel and spend insights, concierge, insurance offers.
  Its visual language could not be verified from sources; not copied.
- **Peers:** Park+ (alert before something costs money: challan, low FASTag), CarInfo/VahanScan (insurance reminders
  30 and 7 days before, PUC 14 and 3 days), TVS service app (service due by km and by time).
- **What brings people back:** reminders that save money or a fine, km/time service due, real history, spend per
  vehicle. Avoid fake health scores, unrelated points and streaks.
- **Data reality:** plate → RC auto-fill needs a licensed provider (about ₹4 per lookup reported) and consent (DPDP);
  insurance/PUC dates can be user-entered first.

## Design (demo)

- Hero: the vehicle with its number plate and a live **odometer** (rolling drums). "Update km" rolls the digits.
- **Road ahead:** a km ruler with the vehicle at today's km and markers for oil, service, tyres (colour + words for
  state). Crossing a round number stamps a **milestone** in the service book.
- **Next up:** the most urgent job, why it is due (rule + last time done), one primary action (Book a service / Shop
  parts that fit).
- **Fits your vehicle** shelf (works today), **Service book** with stamped entries from real orders (MD-) and workshop
  jobs (SR-, km at vehicle received), **Papers** expiry countdowns, **Spend** per vehicle, **Garage set-up** progress
  (6 honest items), add-vehicle in 3 steps with a drive-in moment. EN/हिंदी, light/dark.
- Every section is tagged "Works today" or "New, needs building".

## What a build needs (not decided)

New data: papers expiry dates per vehicle; service rules per vehicle type (admin-editable); vehicle id on orders and
service requests (to fill the service book and spend); last-done km/date per job; reminder jobs + notification
templates (en+hi); optional document photos (storage + consent). Plate lookup: later, paid provider.

## Round 2 (founder 18:50: "this design is dogshit … modern … theme can be different … did u do a proper visual study")

The first study read page text only; no visual study was done. Round 2 took real screenshots
(`.playwright-mcp/garage-study/`, not committed):

- **SmartGarrage:** deep-blue hero over real workshop photography, Poppins, orange accent, a "Live now · 3 mechanics on
  duty" pill, a floating card on the photo ("Next available slot Today 6:46 PM · 1.2 km away · from ₹999 · Grab slot"),
  big trust numbers (2k+ bikes, 4.8★, 1 mo warranty), price-tagged service cards.
- **CRED Garage (cred.club/garage):** a cinematic scroll page on true black: vehicles lit like a studio, glowing white
  display type; app screens use a serif voice line ("you've been a fabulous driver with 0 challans"), a chunky flip
  counter ("223 days with 0 challan"), a wheel date picker for PUC with the fine spelled out ("₹1,000"), a monthly
  spend ledger with bars and a delta, and a roller-shutter bay to close.

Redesign (single dark look, MechDost orange as the work light, Bricolage Grotesque + Inter): each vehicle parks in a
numbered **bay** whose roller shutter rolls up to reveal it under a work light (swipe between bays); 2×2 glowing
**vitals** (flip-digit odometer, next service ring, insurance and PUC day counts); a lit **road** to the next jobs;
**next up** with the typical Raipur cost; **fits** shelf; **spends** with monthly bars and the year-on-year delta;
**service log**; **papers** set with a wheel date picker that names the fine; add-vehicle with paint colour and a
drive-in plus confetti; milestones every 5,000 km (10,000 km for cars) fire confetti. Not copied: CRED's black/white
glow type, serif voice and green accent.
