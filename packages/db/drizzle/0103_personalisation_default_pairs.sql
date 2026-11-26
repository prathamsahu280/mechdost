-- Default "Goes well with" pairs (shopping personalisation phase 3, founder approval 2026-11-26): tyre -> tube and
-- flap, battery -> terminal grease and battery care, engine oil -> oil filter, and the workshop fitting link for tyres
-- and batteries. Data only, by category slug (catalogue-v2 tree): a category that does not exist is skipped, a pair
-- that already exists is kept as staff left it (ON CONFLICT DO NOTHING), so running it again adds nothing. Staff edit
-- or pause every rule in Admin -> Catalogue -> "Goes well with" (hard rule 8).
INSERT INTO public.recommendation_rules (trigger_category_id, suggest_kind, suggest_category_id, label, label_hi, priority)
SELECT t.id, 'category', s.id, v.label, v.label_hi, v.priority
FROM (VALUES
  ('two-wheeler-tyres', 'tubes-flaps', 'Tube and flap for this tyre', 'इस टायर के लिए ट्यूब और फ़्लैप', 10),
  ('three-wheeler-tyres', 'tubes-flaps', 'Tube and flap for this tyre', 'इस टायर के लिए ट्यूब और फ़्लैप', 10),
  ('truck-bus-tyres', 'tubes-flaps', 'Tube and flap for this tyre', 'इस टायर के लिए ट्यूब और फ़्लैप', 10),
  ('light-commercial-tyres', 'tubes-flaps', 'Tube and flap for this tyre', 'इस टायर के लिए ट्यूब और फ़्लैप', 10),
  ('farm-tyres', 'tubes-flaps', 'Tube and flap for this tyre', 'इस टायर के लिए ट्यूब और फ़्लैप', 10),
  ('car-suv-batteries', 'battery-accessories', 'Terminal grease and battery care', 'टर्मिनल ग्रीस और बैटरी की देखभाल', 10),
  ('two-wheeler-batteries', 'battery-accessories', 'Terminal grease and battery care', 'टर्मिनल ग्रीस और बैटरी की देखभाल', 10),
  ('three-wheeler-batteries', 'battery-accessories', 'Terminal grease and battery care', 'टर्मिनल ग्रीस और बैटरी की देखभाल', 10),
  ('cv-batteries', 'battery-accessories', 'Terminal grease and battery care', 'टर्मिनल ग्रीस और बैटरी की देखभाल', 10),
  ('tractor-batteries', 'battery-accessories', 'Terminal grease and battery care', 'टर्मिनल ग्रीस और बैटरी की देखभाल', 10),
  ('e-rickshaw-batteries', 'battery-accessories', 'Terminal grease and battery care', 'टर्मिनल ग्रीस और बैटरी की देखभाल', 10),
  ('inverter-batteries', 'battery-accessories', 'Terminal grease and battery care', 'टर्मिनल ग्रीस और बैटरी की देखभाल', 10),
  ('genset-batteries', 'battery-accessories', 'Terminal grease and battery care', 'टर्मिनल ग्रीस और बैटरी की देखभाल', 10),
  ('car-engine-oil', 'oil-filters', 'Change the oil filter with the oil', 'ऑयल के साथ ऑयल फ़िल्टर भी बदलें', 10),
  ('diesel-engine-oil', 'oil-filters', 'Change the oil filter with the oil', 'ऑयल के साथ ऑयल फ़िल्टर भी बदलें', 10),
  ('heavy-duty-oils', 'oil-filters', 'Change the oil filter with the oil', 'ऑयल के साथ ऑयल फ़िल्टर भी बदलें', 10),
  ('tractor-agri-oils', 'oil-filters', 'Change the oil filter with the oil', 'ऑयल के साथ ऑयल फ़िल्टर भी बदलें', 10),
  ('motorcycle-oil', 'oil-filters', 'Change the oil filter with the oil', 'ऑयल के साथ ऑयल फ़िल्टर भी बदलें', 10)
) AS v(trigger_slug, suggest_slug, label, label_hi, priority)
JOIN public.categories t ON t.slug = v.trigger_slug
JOIN public.categories s ON s.slug = v.suggest_slug
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO public.recommendation_rules (trigger_category_id, suggest_kind, label, label_hi, priority)
SELECT t.id, 'workshop_fitting', v.label, v.label_hi, v.priority
FROM (VALUES
  ('tyres', 'Get it fitted at a nearby workshop', 'पास की वर्कशॉप में फ़िट करवाएँ', 50),
  ('batteries', 'Get it fitted at a nearby workshop', 'पास की वर्कशॉप में फ़िट करवाएँ', 50)
) AS v(trigger_slug, label, label_hi, priority)
JOIN public.categories t ON t.slug = v.trigger_slug
ON CONFLICT DO NOTHING;
