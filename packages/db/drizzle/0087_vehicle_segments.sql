CREATE TABLE "category_default_segments" (
	"category_slug" text NOT NULL,
	"segment_code" text NOT NULL,
	CONSTRAINT "category_default_segments_category_slug_segment_code_pk" PRIMARY KEY("category_slug","segment_code")
);
--> statement-breakpoint
CREATE TABLE "product_vehicle_segments" (
	"product_id" uuid NOT NULL,
	"segment_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_vehicle_segments_product_id_segment_code_pk" PRIMARY KEY("product_id","segment_code")
);
--> statement-breakpoint
CREATE TABLE "vehicle_segments" (
	"code" text PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"name_hi" text NOT NULL,
	"description_en" text,
	"description_hi" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_segments_code_valid" CHECK ("vehicle_segments"."code" in ('two_wheeler','three_wheeler','car_suv','light_commercial','truck_bus','tractor_farm','construction_otr','not_vehicle')),
	CONSTRAINT "vehicle_segments_names" CHECK (char_length("vehicle_segments"."name_en") between 1 and 60 and char_length("vehicle_segments"."name_hi") between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "search_synonyms" DROP CONSTRAINT "search_synonyms_kind_valid";--> statement-breakpoint
ALTER TABLE "category_default_segments" ADD CONSTRAINT "category_default_segments_segment_code_vehicle_segments_code_fk" FOREIGN KEY ("segment_code") REFERENCES "public"."vehicle_segments"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_vehicle_segments" ADD CONSTRAINT "product_vehicle_segments_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_vehicle_segments" ADD CONSTRAINT "product_vehicle_segments_segment_code_vehicle_segments_code_fk" FOREIGN KEY ("segment_code") REFERENCES "public"."vehicle_segments"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_vehicle_segments_segment_idx" ON "product_vehicle_segments" USING btree ("segment_code","product_id");--> statement-breakpoint
ALTER TABLE "search_synonyms" ADD CONSTRAINT "search_synonyms_kind_valid" CHECK ("search_synonyms"."kind" in ('synonym','category','vehicle','segment'));
--> statement-breakpoint
-- Vehicle segments (design 2026-11-25, spec 02 "Vehicle segments"). Staff-edited names and order; the codes are the closed enum.
INSERT INTO public.vehicle_segments (code, name_en, name_hi, description_en, description_hi, sort) VALUES
  ('two_wheeler', 'Two-wheeler', 'दोपहिया', 'Bikes and scooters', 'बाइक और स्कूटर', 10),
  ('three_wheeler', 'Three-wheeler', 'तिपहिया', 'Autos, e-rickshaws and loaders', 'ऑटो, ई-रिक्शा और लोडर', 20),
  ('car_suv', 'Car & SUV', 'कार और एसयूवी', 'Hatchbacks, sedans and SUVs', 'हैचबैक, सेडान और एसयूवी', 30),
  ('light_commercial', 'Light commercial', 'हल्के व्यावसायिक वाहन', 'Pickups, tempos and mini trucks', 'पिकअप, टेम्पो और मिनी ट्रक', 40),
  ('truck_bus', 'Truck & bus', 'ट्रक और बस', 'Heavy trucks, tippers and buses', 'भारी ट्रक, टिप्पर और बसें', 50),
  ('tractor_farm', 'Tractor & farm', 'ट्रैक्टर और खेती', 'Tractors and farm machines', 'ट्रैक्टर और खेती की मशीनें', 60),
  ('construction_otr', 'Construction & OTR', 'निर्माण और ओटीआर', 'Earth movers, loaders and off-the-road machines', 'अर्थमूवर, लोडर और ऑफ-रोड मशीनें', 70),
  ('not_vehicle', 'Not a vehicle', 'वाहन के लिए नहीं', 'Inverters, home power, gensets and tools', 'इन्वर्टर, घरेलू बिजली, जेनसेट और औज़ार', 80);--> statement-breakpoint
-- The reviewed category -> segment mapping (docs/specs/02-catalogue-search.md "Segment backfill"; same table as
-- DEFAULT_SEGMENTS_OF_CATEGORY). General categories (greases, gear oils, coolants, filters, bearings, accessories, ...)
-- are deliberately not here: their products take a segment from their vehicle types, else none.
INSERT INTO public.category_default_segments (category_slug, segment_code) VALUES
  ('two-wheeler-tyres', 'two_wheeler'),
  ('two-wheeler-batteries', 'two_wheeler'),
  ('motorcycle-oil', 'two_wheeler'),
  ('three-wheeler-tyres', 'three_wheeler'),
  ('three-wheeler-batteries', 'three_wheeler'),
  ('e-rickshaw-batteries', 'three_wheeler'),
  ('car-suv-tyres', 'car_suv'),
  ('car-suv-batteries', 'car_suv'),
  ('car-engine-oil', 'car_suv'),
  ('car-care-products', 'car_suv'),
  ('light-commercial-tyres', 'light_commercial'),
  ('truck-bus-tyres', 'truck_bus'),
  ('cv-batteries', 'truck_bus'),
  ('cv-batteries', 'light_commercial'),
  ('diesel-engine-oil', 'truck_bus'),
  ('diesel-engine-oil', 'light_commercial'),
  ('heavy-duty-oils', 'truck_bus'),
  ('heavy-duty-oils', 'light_commercial'),
  ('farm-tyres', 'tractor_farm'),
  ('tractor-batteries', 'tractor_farm'),
  ('tractor-agri-oils', 'tractor_farm'),
  ('otr-tyres', 'construction_otr'),
  ('industrial-tyres', 'construction_otr'),
  ('earth-moving-batteries', 'construction_otr'),
  ('home-power', 'not_vehicle'),
  ('genset-batteries', 'not_vehicle'),
  ('industrial-batteries', 'not_vehicle'),
  ('workshop-tools', 'not_vehicle');--> statement-breakpoint
ALTER TABLE public.vehicle_segments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.product_vehicle_segments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.category_default_segments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.vehicle_segments, public.product_vehicle_segments, public.category_default_segments FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER vehicle_segments_bump_version BEFORE UPDATE ON public.vehicle_segments
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER vehicle_segments_touch_updated_at BEFORE UPDATE ON public.vehicle_segments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
-- The segments a product gets by default: its category's mapping (plus Tractor & farm for a heavy-duty or diesel oil
-- whose text says tractor), else the segment of each of its 2W/3W/4W vehicle types (2W -> two_wheeler, 3W ->
-- three_wheeler, 4W -> car_suv), else none. Used by the insert trigger and by the backfill below.
CREATE FUNCTION public.product_default_segments(p_category_id uuid, p_vehicle_types text[], p_text text) RETURNS SETOF text
LANGUAGE sql STABLE AS $$
  WITH own AS (
    SELECT cds.segment_code FROM public.categories c
    JOIN public.category_default_segments cds ON cds.category_slug = c.slug
    WHERE c.id = p_category_id
  )
  SELECT segment_code FROM own
  UNION
  SELECT 'tractor_farm'::text WHERE p_text ~* '(tractor|ट्रैक्टर)'
    AND EXISTS (SELECT 1 FROM public.categories c WHERE c.id = p_category_id AND c.slug IN ('diesel-engine-oil', 'heavy-duty-oils'))
  UNION
  SELECT CASE t WHEN '2W' THEN 'two_wheeler' WHEN '3W' THEN 'three_wheeler' WHEN '4W' THEN 'car_suv' END
  FROM unnest(p_vehicle_types) AS t WHERE NOT EXISTS (SELECT 1 FROM own)
$$;--> statement-breakpoint
CREATE FUNCTION public.products_default_segments() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.product_vehicle_segments (product_id, segment_code)
  SELECT NEW.id, s FROM public.product_default_segments(NEW.category_id, NEW.vehicle_types,
    concat_ws(' ', NEW.name, NEW.spec_summary, NEW.compatibility)) AS s
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER products_default_segments AFTER INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_default_segments();--> statement-breakpoint
-- Back-fill: products that have no segment yet get their defaults. Idempotent, never touches a product staff already
-- set; kept as a function so staff can re-run it after adding a category and the tests can prove the mapping.
CREATE FUNCTION public.backfill_product_segments() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  INSERT INTO public.product_vehicle_segments (product_id, segment_code)
  SELECT p.id, s
  FROM public.products p
  CROSS JOIN LATERAL public.product_default_segments(p.category_id, p.vehicle_types,
    concat_ws(' ', p.name, p.spec_summary, p.compatibility)) AS s
  WHERE NOT EXISTS (SELECT 1 FROM public.product_vehicle_segments x WHERE x.product_id = p.id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;--> statement-breakpoint
SELECT public.backfill_product_segments();--> statement-breakpoint
-- Search words (spec 02 "Smart search"): the plain-word truck / bus / tractor vehicle entries become segment entries,
-- then the rest of the segment words are added. Existing staff edits (same kind and term) are kept.
UPDATE public.search_synonyms SET kind = 'segment',
  expands_to = ARRAY[CASE expands_to[1] WHEN 'tractor' THEN 'tractor_farm' ELSE 'truck_bus' END]
WHERE kind = 'vehicle' AND expands_to[1] IN ('truck', 'bus', 'tractor');--> statement-breakpoint
INSERT INTO public.search_synonyms (term, locale, kind, expands_to) VALUES
('truck', 'en', 'segment', ARRAY['truck_bus']),
  ('trucks', 'en', 'segment', ARRAY['truck_bus']),
  ('lorry', 'en', 'segment', ARRAY['truck_bus']),
  ('lorries', 'en', 'segment', ARRAY['truck_bus']),
  ('bus', 'en', 'segment', ARRAY['truck_bus']),
  ('buses', 'en', 'segment', ARRAY['truck_bus']),
  ('tipper', 'en', 'segment', ARRAY['truck_bus']),
  ('trailer', 'en', 'segment', ARRAY['truck_bus']),
  ('ट्रक', 'hi', 'segment', ARRAY['truck_bus']),
  ('लॉरी', 'hi', 'segment', ARRAY['truck_bus']),
  ('बस', 'hi', 'segment', ARRAY['truck_bus']),
  ('टिपर', 'hi', 'segment', ARRAY['truck_bus']),
  ('trak', 'hinglish', 'segment', ARRAY['truck_bus']),
  ('tractor', 'en', 'segment', ARRAY['tractor_farm']),
  ('tractors', 'en', 'segment', ARRAY['tractor_farm']),
  ('kisan', 'en', 'segment', ARRAY['tractor_farm']),
  ('farm', 'en', 'segment', ARRAY['tractor_farm']),
  ('agri', 'en', 'segment', ARRAY['tractor_farm']),
  ('harvester', 'en', 'segment', ARRAY['tractor_farm']),
  ('ट्रैक्टर', 'hi', 'segment', ARRAY['tractor_farm']),
  ('किसान', 'hi', 'segment', ARRAY['tractor_farm']),
  ('खेती', 'hi', 'segment', ARRAY['tractor_farm']),
  ('trektar', 'hinglish', 'segment', ARRAY['tractor_farm']),
  ('tractar', 'hinglish', 'segment', ARRAY['tractor_farm']),
  ('tempo', 'en', 'segment', ARRAY['light_commercial']),
  ('pickup', 'en', 'segment', ARRAY['light_commercial']),
  ('pick up', 'en', 'segment', ARRAY['light_commercial']),
  ('mini truck', 'en', 'segment', ARRAY['light_commercial']),
  ('lcv', 'en', 'segment', ARRAY['light_commercial']),
  ('dost', 'en', 'segment', ARRAY['light_commercial']),
  ('टेम्पो', 'hi', 'segment', ARRAY['light_commercial']),
  ('पिकअप', 'hi', 'segment', ARRAY['light_commercial']),
  ('jcb', 'en', 'segment', ARRAY['construction_otr']),
  ('earthmover', 'en', 'segment', ARRAY['construction_otr']),
  ('earth mover', 'en', 'segment', ARRAY['construction_otr']),
  ('excavator', 'en', 'segment', ARRAY['construction_otr']),
  ('loader', 'en', 'segment', ARRAY['construction_otr']),
  ('otr', 'en', 'segment', ARRAY['construction_otr']),
  ('जेसीबी', 'hi', 'segment', ARRAY['construction_otr']),
  ('अर्थमूवर', 'hi', 'segment', ARRAY['construction_otr']),
  ('inverter', 'en', 'segment', ARRAY['not_vehicle']),
  ('invertor', 'en', 'segment', ARRAY['not_vehicle']),
  ('genset', 'en', 'segment', ARRAY['not_vehicle']),
  ('ups', 'en', 'segment', ARRAY['not_vehicle']),
  ('इन्वर्टर', 'hi', 'segment', ARRAY['not_vehicle']),
  ('जेनसेट', 'hi', 'segment', ARRAY['not_vehicle'])
ON CONFLICT (kind, term) DO NOTHING;
