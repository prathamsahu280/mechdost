-- Ustaad Network identity seed (spec 23 § 9.2 levels, § 9.3 badges, § 4 flow 15 tutorial; workstream B).
-- Admin-editable rows (hard rule 8), English + Hindi (hard rule 10). Idempotent: ON CONFLICT DO NOTHING, so a
-- re-run or an admin edit is never overwritten. Bada and Master keep needs_staff_review = true (CHECK, SR-8).
INSERT INTO public.ustaad_level_rules
  (level, rule_group, min_followers, min_best_answers, min_helpful_pct, min_verified_years, min_videos,
   min_recommendations, needs_staff_review, perk_en, perk_hi, name_en, name_hi, position)
VALUES
  ('naya', 'A', 0, 0, 0, 3, 0, 0, false, 'Can answer, gets a badge', 'जवाब दे सकते हैं, बैज मिलता है', 'Naya Ustaad', 'नया उस्ताद', 2),
  ('naya', 'B', 0, 0, 0, 0, 10, 1, false, 'Can answer, gets a badge', 'जवाब दे सकते हैं, बैज मिलता है', 'Naya Ustaad', 'नया उस्ताद', 2),
  ('pakka', 'A', 100, 25, 0, 0, 0, 0, false, 'Coins multiplier (off for now)', 'कॉइन्स गुणक (अभी बंद)', 'Pakka Ustaad', 'पक्का उस्ताद', 3),
  ('bada', 'A', 500, 100, 80, 0, 0, 0, true, 'Coins multiplier (off for now)', 'कॉइन्स गुणक (अभी बंद)', 'Bada Ustaad', 'बड़ा उस्ताद', 4),
  ('master', 'A', 2000, 300, 0, 0, 0, 0, true, 'Trainer (coming later)', 'ट्रेनर (बाद में)', 'Master Ustaad', 'मास्टर उस्ताद', 5)
ON CONFLICT (level, rule_group) DO NOTHING;
--> statement-breakpoint
INSERT INTO public.ustaad_badges (code, name_en, name_hi, rule_en, rule_hi, icon, kind, rule, active)
VALUES
  ('battery_expert', 'Battery expert', 'बैटरी एक्सपर्ट', '10 best answers on battery questions', 'बैटरी सवालों पर 10 बेस्ट जवाब', 'battery', 'speciality', '{"schema_version":1,"kind":"best_answers_with_tag","tag":"battery","min":10}', true),
  ('two_wheeler_doctor', 'Two-wheeler doctor', 'टू-व्हीलर डॉक्टर', '25 helpful answers on two-wheelers', 'टू-व्हीलर पर 25 मददगार जवाब', 'bike', 'speciality', '{"schema_version":1,"kind":"helpful_answers_in_segment","segment":"two_wheeler","min":25}', true),
  ('helping_hand', 'Helping hand', 'मददगार हाथ', '5 answers to Chhotus in a week', 'एक हफ़्ते में छोटुओं को 5 जवाब', 'hand', 'fun', '{"schema_version":1,"kind":"apprentice_answers_in_week","min":5}', true),
  ('wiring_wizard', 'Wiring wizard', 'वायरिंग जादूगर', '10 best answers on electrical questions', 'बिजली के सवालों पर 10 बेस्ट जवाब', 'bolt', 'speciality', '{"schema_version":1,"kind":"best_answers_with_tag","tag":"electrical","min":10}', false),
  ('first_post', 'First post', 'पहली पोस्ट', 'Shared your first work post', 'अपनी पहली काम की पोस्ट डाली', 'camera', 'fun', '{"schema_version":1,"kind":"first_post"}', true),
  ('pehla_sawaal', 'Pehla sawaal', 'पहला सवाल', 'Asked your first question', 'अपना पहला सवाल पूछा', 'question', 'fun', '{"schema_version":1,"kind":"first_question"}', true),
  ('pehla_jawab', 'Pehla jawab', 'पहला जवाब', 'Gave your first answer', 'अपना पहला जवाब दिया', 'reply', 'fun', '{"schema_version":1,"kind":"first_answer"}', true),
  ('founding_ustaad', 'Founding Ustaad', 'संस्थापक उस्ताद', 'Joined in the first months', 'शुरुआती महीनों में जुड़े', 'star', 'level', '{"schema_version":1,"kind":"founding"}', true)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO public.ustaad_tutorial_cards (code, position, title_en, title_hi, body_en, body_hi, active)
VALUES
  ('ask', 1, 'Ask by voice', 'सवाल पूछो', 'Stuck on a job? Hold the mic, speak your problem and send it. Ustaads near you will answer.', 'काम में अटके हो? माइक दबाकर रखो, अपनी दिक्कत बोलो और भेज दो। आपके पास के उस्ताद जवाब देंगे।', true),
  ('show_work', 2, 'Show your work', 'काम दिखाओ', 'Post a photo, a voice note or a short video of a job you fixed.', 'जो काम ठीक किया, उसकी फ़ोटो, आवाज़ या छोटा वीडियो डालो।', true),
  ('answer', 3, 'Answer and earn Izzat', 'जवाब दो और इज़्ज़त कमाओ', 'Help others with answers. Helpful and best answers earn you Izzat.', 'जवाब देकर दूसरों की मदद करो। मददगार और बेस्ट जवाब से इज़्ज़त मिलती है।', true),
  ('levels', 4, 'Grow your level: Chhotu to Master', 'लेवल बढ़ाओ: छोटू से मास्टर', 'Naya, Pakka, Bada and Master Ustaad. MechDost checks and confirms each step.', 'नया, पक्का, बड़ा और मास्टर उस्ताद। हर कदम MechDost जाँचकर पक्का करता है।', true),
  ('pin', 5, 'Pin your garage', 'अपना गैराज पिन करो', 'Mark your garage on the map. Only the area shows unless you choose to show the exact spot.', 'नक्शे पर अपना गैराज लगाओ। जब तक आप न चुनें, सिर्फ़ इलाका दिखता है।', true),
  ('dukaan', 6, 'Parts from the Dukaan', 'दुकान से पार्ट्स', 'Need a part? Order genuine parts from MechDost shops near you.', 'पार्ट चाहिए? पास की MechDost दुकानों से असली पार्ट्स मँगाओ।', true)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO public.ustaad_coachmarks (target, text_en, text_hi, position, active)
VALUES
  ('mic', 'Hold to speak your question', 'सवाल बोलने के लिए दबाकर रखो', 1, true),
  ('create', 'Tap + to post your work', 'अपना काम डालने के लिए + दबाओ', 2, true),
  ('like_reply', 'Like or reply to help a friend', 'पसंद करो या जवाब दो', 3, true),
  ('discover', 'Find Ustaads by work or area', 'काम या इलाके से उस्ताद खोजो', 4, true),
  ('pin', 'Pin your garage on the map', 'नक्शे पर अपना गैराज लगाओ', 5, true),
  ('jobs', 'Find mechanic jobs near you', 'पास की मैकेनिक नौकरियाँ देखो', 6, true)
ON CONFLICT (target) DO NOTHING;
