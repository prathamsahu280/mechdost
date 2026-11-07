/**
 * Photo library for the demo storefront (decision 2026-11-01 "Real photos"). Openly licensed photos from Wikimedia
 * Commons (CC0 / public domain / CC BY / CC BY-SA), stored in public/images and served through next/image. They are
 * representative of the product type, not the exact listed item; seller photos from Storage replace them (spec 02).
 * Paths are plain strings (not static imports) so client bundles do not carry blur placeholders. Every file must
 * have an entry in PHOTO_CREDITS (attribution is a licence condition) — test/media.test.ts asserts it.
 */
import type { CategoryKey } from '@/demo/catalogue';

const product = (slug: string) => `/images/products/${slug}.jpg`;
const workshop = (slug: string) => `/images/workshops/${slug}.jpg`;

export const PRODUCT_PHOTO_SLUGS = [
  'castrol-activ-4t-20w40-900ml',
  'exide-xltz4a-2w-battery',
  'scooter-tubeless-tyre-90-90-12',
  'car-tyre-185-65-r15',
  'car-starter-battery-45ah',
  'heavy-duty-battery-90ah',
  'synthetic-engine-oil-5w30-3-5l',
  'engine-oil-filter-petrol-car',
  'diesel-fuel-filter',
  'front-wheel-bearing-kit',
  'motorcycle-wheel-bearing-6301',
  'brake-pad-set-front',
  'chain-sprocket-kit-150cc',
  'spark-plug-iridium',
  'all-weather-car-floor-mats',
  'two-wheeler-body-cover',
  'socket-tool-set-46pc',
  'digital-tyre-pressure-gauge',
  'ev-12v-auxiliary-battery',
  'ev-portable-charger-15a',
] as const;
export const WORKSHOP_PHOTO_SLUGS = [
  'pachpedi-naka-two-wheeler-care',
  'telibandha-car-clinic',
  'shankar-nagar-auto-hub',
  'devendra-nagar-motors',
  'tatibandh-multi-brand-garage',
  'mowa-ev-and-bike-point',
  'amapara-express-service',
  'sarona-car-care',
] as const;

const productSet = new Set<string>(PRODUCT_PHOTO_SLUGS);
const workshopSet = new Set<string>(WORKSHOP_PHOTO_SLUGS);

/** Category cover = a representative product of that category. */
export const CATEGORY_PHOTOS: Record<CategoryKey, string> = {
  tyres: product('car-tyre-185-65-r15'),
  lubricants: product('synthetic-engine-oil-5w30-3-5l'),
  batteries: product('car-starter-battery-45ah'),
  bearings: product('front-wheel-bearing-kit'),
  filters: product('engine-oil-filter-petrol-car'),
  spareParts: product('brake-pad-set-front'),
  accessories: product('all-weather-car-floor-mats'),
  workshopTools: product('socket-tool-set-46pc'),
  evEssentials: product('ev-portable-charger-15a'),
};

export function productPhoto(slug: string, category: CategoryKey): string {
  return productSet.has(slug) ? product(slug) : CATEGORY_PHOTOS[category];
}

export function workshopPhoto(slug: string): string {
  return workshopSet.has(slug) ? workshop(slug) : '/images/site/hero-workshop.jpg';
}

export const SITE_PHOTOS = {
  partsStore: '/images/site/parts-store.jpg',
  engineBay: '/images/site/engine-bay.jpg',
} as const;

export interface PhotoCredit {
  path: string;
  title: string;
  author: string;
  license: string;
  source: string;
}

export const PHOTO_CREDITS: readonly PhotoCredit[] = [
  {
    path: '/images/products/castrol-activ-4t-20w40-900ml.jpg',
    title: 'Petro-canada oil bottle products 7355',
    author: 'Myke2020',
    license: 'Public domain',
    source: 'https://commons.wikimedia.org/wiki/File:Petro-canada_oil_bottle_products_7355.jpg',
  },
  {
    path: '/images/products/exide-xltz4a-2w-battery.jpg',
    title: '996R FIAMM battery',
    author: '92GTA',
    license: 'CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:996R_FIAMM_battery.jpg',
  },
  {
    path: '/images/products/scooter-tubeless-tyre-90-90-12.jpg',
    title: 'Honda PCX150 2013 Front Wheel',
    author: 'Khaosaming',
    license: 'CC BY-SA 3.0',
    source: 'https://commons.wikimedia.org/wiki/File:Honda_PCX150_2013_Front_Wheel.JPG',
  },
  {
    path: '/images/products/car-tyre-185-65-r15.jpg',
    title: 'Tyres 2',
    author: 'ProjectManhattan',
    license: 'CC BY-SA 3.0',
    source: 'https://commons.wikimedia.org/wiki/File:Tyres_2.jpg',
  },
  {
    path: '/images/products/car-starter-battery-45ah.jpg',
    title: 'Auxiliary Battery & CTEK charger',
    author: 'Stephan Ridgway from Brisbane, Australia',
    license: 'CC BY 2.0',
    source: 'https://commons.wikimedia.org/wiki/File:Auxiliary_Battery_%26_CTEK_charger.jpg',
  },
  {
    path: '/images/products/heavy-duty-battery-90ah.jpg',
    title: 'Super Start Platinum Car Battery',
    author: 'TaurusEmerald',
    license: 'CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:Super_Start_Platinum_Car_Battery.jpg',
  },
  {
    path: '/images/products/synthetic-engine-oil-5w30-3-5l.jpg',
    title: 'Pennzoil oil bottles',
    author: 'Mike Mozart',
    license: 'CC BY 2.0',
    source: 'https://commons.wikimedia.org/wiki/File:Pennzoil_oil_bottles.jpg',
  },
  {
    path: '/images/products/engine-oil-filter-petrol-car.jpg',
    title: 'Bosch Oil Filter',
    author: 'Schumi4ever',
    license: 'CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:Bosch_Oil_Filter.JPG',
  },
  {
    path: '/images/products/diesel-fuel-filter.jpg',
    title: 'Oil filter and Fuel filter of UD Trucks,',
    author: 'Mj-bird',
    license: 'CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:Oil_filter_and_Fuel_filter_of_UD_Trucks,.jpg',
  },
  {
    path: '/images/products/front-wheel-bearing-kit.jpg',
    title: '1950s ball bearing 129 HA by Swedish company SKF made in Sweden',
    author: 'R. Henrik Nilsson',
    license: 'CC BY 4.0',
    source:
      'https://commons.wikimedia.org/wiki/File:1950s_ball_bearing_129_HA_by_Swedish_company_SKF_made_in_Sweden.jpg',
  },
  {
    path: '/images/products/motorcycle-wheel-bearing-6301.jpg',
    title: '1984 precision angular contact ball bearing B7207CA manufactured in Czechoslovakia by ZKL',
    author: 'R. Henrik Nilsson',
    license: 'CC BY 4.0',
    source:
      'https://commons.wikimedia.org/wiki/File:1984_precision_angular_contact_ball_bearing_B7207CA_manufactured_in_Czechoslovakia_by_ZKL.jpg',
  },
  {
    path: '/images/products/brake-pad-set-front.jpg',
    title: 'Alarm bells! (25681917701)',
    author: 'Riley from Christchurch, New Zealand',
    license: 'CC BY 2.0',
    source: 'https://commons.wikimedia.org/wiki/File:Alarm_bells!_(25681917701).jpg',
  },
  {
    path: '/images/products/chain-sprocket-kit-150cc.jpg',
    title: 'Royal Enfield Crusader Cassington rear hub left',
    author: 'Motacilla',
    license: 'CC BY 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:Royal_Enfield_Crusader_Cassington_rear_hub_left.jpg',
  },
  {
    path: '/images/products/spark-plug-iridium.jpg',
    title: 'Spark Plug 20180205 110413',
    author: 'Slcreza',
    license: 'CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:Spark_Plug_20180205_110413.jpg',
  },
  {
    path: '/images/products/all-weather-car-floor-mats.jpg',
    title: 'Fitted-rubber-car-mats-image',
    author: 'Keystones',
    license: 'CC BY-SA 3.0',
    source: 'https://commons.wikimedia.org/wiki/File:Fitted-rubber-car-mats-image.jpg',
  },
  {
    path: '/images/products/two-wheeler-body-cover.jpg',
    title: 'Black Vulture - Coragyps atratus, Everglades National Park, Homestead, Florida - 15365464494',
    author: 'Judy Gallagher',
    license: 'CC BY 2.0',
    source:
      'https://commons.wikimedia.org/wiki/File:Black_Vulture_-_Coragyps_atratus,_Everglades_National_Park,_Homestead,_Florida_-_15365464494.jpg',
  },
  {
    path: '/images/products/socket-tool-set-46pc.jpg',
    title: 'TOOLKIT',
    author: 'Abduldedysubhansyah',
    license: 'CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:TOOLKIT.jpg',
  },
  {
    path: '/images/products/digital-tyre-pressure-gauge.jpg',
    title: 'Porsche Tire Pressure Gauge (9207945919)',
    author: 'Antti',
    license: 'CC BY 2.0',
    source: 'https://commons.wikimedia.org/wiki/File:Porsche_Tire_Pressure_Gauge_(9207945919).jpg',
  },
  {
    path: '/images/products/ev-12v-auxiliary-battery.jpg',
    title: 'Lead Acid 6 cell Battery',
    author: 'Tntflash',
    license: 'CC BY-SA 3.0',
    source: 'https://commons.wikimedia.org/wiki/File:Lead_Acid_6_cell_Battery.jpg',
  },
  {
    path: '/images/products/ev-portable-charger-15a.jpg',
    title:
      'Electric car charging at a station during the day with the charging cable connected to the vehicle',
    author: 'Shixart1985',
    license: 'CC BY 2.0',
    source:
      'https://commons.wikimedia.org/wiki/File:Electric_car_charging_at_a_station_during_the_day_with_the_charging_cable_connected_to_the_vehicle.jpg',
  },
  {
    path: '/images/workshops/pachpedi-naka-two-wheeler-care.jpg',
    title: 'Cycle and motorcycle repairer at Saligao- Goa 2019',
    author: 'Frederick Noronha',
    license: 'CC BY-SA 2.0',
    source: 'https://commons.wikimedia.org/wiki/File:Cycle_and_motorcycle_repairer_at_Saligao-_Goa_2019.jpg',
  },
  {
    path: '/images/workshops/telibandha-car-clinic.jpg',
    title: 'LADA Vesta Sport, Wheel alignment 2',
    author: 'Dmitry Racer',
    license: 'CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:LADA_Vesta_Sport,_Wheel_alignment_2.jpg',
  },
  {
    path: '/images/workshops/shankar-nagar-auto-hub.jpg',
    title: 'Chery A1 - service shop in Ukraine (7)',
    author: 'ANT Berezhnyi',
    license: 'CC BY 3.0',
    source: 'https://commons.wikimedia.org/wiki/File:Chery_A1_-_service_shop_in_Ukraine_(7).jpg',
  },
  {
    path: '/images/workshops/devendra-nagar-motors.jpg',
    title: 'Two on ramps (41411586832)',
    author: 'Iain Cameron from Ellon, Scotland',
    license: 'CC BY 2.0',
    source: 'https://commons.wikimedia.org/wiki/File:Two_on_ramps_(41411586832).jpg',
  },
  {
    path: '/images/workshops/tatibandh-multi-brand-garage.jpg',
    title:
      'A man who sanding with a grinder and prepares the paint for the car in a home service. - Flickr - shixart1985',
    author: 'Nenad Stojkovic',
    license: 'CC BY 2.0',
    source:
      'https://commons.wikimedia.org/wiki/File:A_man_who_sanding_with_a_grinder_and_prepares_the_paint_for_the_car_in_a_home_service._-_Flickr_-_shixart1985.jpg',
  },
  {
    path: '/images/workshops/mowa-ev-and-bike-point.jpg',
    title: '2012-06-08 Scooter Repair Shop in Taipei',
    author: 'Teo Romera',
    license: 'CC BY-SA 2.0',
    source: 'https://commons.wikimedia.org/wiki/File:2012-06-08_Scooter_Repair_Shop_in_Taipei.jpg',
  },
  {
    path: '/images/workshops/amapara-express-service.jpg',
    title: 'Wheel alignment on a Ford Focus 3',
    author: 'Photograph by Mike Peel (www.mikepeel.net).',
    license: 'CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:Wheel_alignment_on_a_Ford_Focus_3.jpg',
  },
  {
    path: '/images/workshops/sarona-car-care.jpg',
    title: '2015 Kłodzko, ul. Dusznicka, myjnia samochodowa 02',
    author: 'Jacek Halicki',
    license: 'CC BY-SA 4.0',
    source:
      'https://commons.wikimedia.org/wiki/File:2015_K%C5%82odzko,_ul._Dusznicka,_myjnia_samochodowa_02.jpg',
  },
  {
    path: '/images/site/hero-workshop.jpg',
    title: 'Car repair shop',
    author: 'Martin Vorel',
    license: 'CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:Car_repair_shop.jpg',
  },
  {
    path: '/images/site/parts-store.jpg',
    title: 'Auto Parts Store',
    author: 'Visitor7',
    license: 'CC BY-SA 3.0',
    source: 'https://commons.wikimedia.org/wiki/File:Auto_Parts_Store.jpg',
  },
  {
    path: '/images/site/engine-bay.jpg',
    title: 'Engine components displayed in a red car during a mechanical inspection process at a garage',
    author: 'Shixart1985',
    license: 'CC BY 2.0',
    source:
      'https://commons.wikimedia.org/wiki/File:Engine_components_displayed_in_a_red_car_during_a_mechanical_inspection_process_at_a_garage.jpg',
  },
];
