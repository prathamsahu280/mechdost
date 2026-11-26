-- Reserved display names (spec 23 § 14a SR-4, AT-NAME-1): brand, operator and staff role words in Latin and
-- Devanagari. `skeleton` = nameSkeleton(name) from packages/shared/src/ustaad/names.ts (a db test checks every row
-- against the function). Data only; admin adds more under Admin › Network settings. Re-running inserts nothing.
INSERT INTO "ustaad_reserved_names" ("name", "skeleton") VALUES
  ('MechDost', 'mechdost'),
  ('MechDost Support', 'mechdostsupport'),
  ('MechDost Team', 'mechdostteam'),
  ('MechDost Official', 'mechdostofficial'),
  ('मेकदोस्त', 'मेकदोस्त'),
  ('मैकदोस्त', 'मैकदोस्त'),
  ('Admin', 'admin'),
  ('Administrator', 'administrator'),
  ('Moderator', 'moderator'),
  ('Support', 'support'),
  ('Staff', 'staff'),
  ('Official', 'official'),
  ('Helpdesk', 'helpdesk'),
  ('Customer Care', 'customercare'),
  ('Community Manager', 'communitymanager'),
  ('Ustaad Network', 'ustaadnetwork'),
  ('Ustaad Official', 'ustaadofficial'),
  ('Ustaad Team', 'ustaadteam'),
  ('Shourya Integrated', 'shouryaintegrated'),
  ('एडमिन', 'एडमिन'),
  ('सपोर्ट', 'सपोर्ट'),
  ('मॉडरेटर', 'मॉडरेटर'),
  ('ऑफिशियल', 'ऑफिशियल'),
  ('उस्ताद नेटवर्क', 'उस्तादनेटवर्क')
ON CONFLICT DO NOTHING;
