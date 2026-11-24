/**
 * Hindi for the Apollo tyre import (hard rule 10, user 2026-11-24): the maker's pattern descriptions (HTML entities
 * decoded) and the online shop's feature lines, translated by hand and checked line by line. Tread pattern names, the
 * brand and codes stay in Latin script; everything else is Devanagari. A text with no entry here is reported by the plan
 * (`untranslated`) and stops a real import.
 */

/** Apollo's pattern description (decoded, trimmed) -> Hindi. */
export const APOLLO_DESCRIPTIONS_HI: Readonly<Record<string, string>> = {
  'A durable car tyre engineered for longevity and reliable performance. Its robust construction provides excellent resistance to wear and tear, ensuring a safe and comfortable ride. Ideal for various driving conditions, the Amazer XL guarantees durability and peace of mind on the road.':
    'लंबे समय तक चलने और भरोसेमंद प्रदर्शन के लिए बनाया गया टिकाऊ कार टायर। इसकी मज़बूत बनावट घिसाई और टूट-फूट से बेहतरीन बचाव देती है, जिससे सफ़र सुरक्षित और आरामदायक रहता है। अलग-अलग तरह की ड्राइविंग के लिए उपयुक्त, Amazer XL सड़क पर मज़बूती और बेफ़िक्री की गारंटी देता है।',
  'A game-changer for LCVs, designed for high mileage without compromising on performance. Offering superior durability and fuel efficiency. An ideal partner for long journeys.':
    'LCV के लिए खेल बदलने वाला टायर, जो प्रदर्शन से समझौता किए बिना ज़्यादा माइलेज के लिए बनाया गया है। बेहतरीन टिकाऊपन और ईंधन की बचत देता है। लंबे सफ़र का सही साथी।',
  'A multi-application haulage tyre with superior lug quality and braking to ensure the most stable and safe deliveries. Haulug X is a reimagining of the classic truck tyre with new age rubber technology and enhanced structural design.':
    'कई तरह के माल ढुलाई कामों के लिए टायर, जिसमें बेहतरीन लग क्वालिटी और ब्रेकिंग है, ताकि डिलीवरी सबसे स्थिर और सुरक्षित रहे। Haulug X पुराने ट्रक टायर को नए ज़माने की रबर तकनीक और बेहतर बनावट के साथ नए रूप में पेश करता है।',
  'A reliable urban tyre offering confident handling, superior grip, and reduced tread wear.':
    'भरोसेमंद शहरी टायर, जो पक्का नियंत्रण, बेहतरीन ग्रिप और ट्रेड की कम घिसाई देता है।',
  'ALNAC 4G is a high-performance tyre for comfort and control, with low noise for a smoother drive.':
    'ALNAC 4G आराम और नियंत्रण के लिए उच्च प्रदर्शन वाला टायर है, जिसमें कम शोर के साथ ज़्यादा सहज ड्राइव मिलती है।',
  'AMAZER 4G LIFE+ helps you go further with long tyre life, better comfort, fuel savings, and strong puncture resistance..':
    'AMAZER 4G LIFE+ लंबी टायर लाइफ, बेहतर आराम, ईंधन की बचत और पंक्चर से मज़बूत बचाव के साथ आपको और आगे ले जाता है..',
  'AMAZER XP offers utmost ride comfort and high fuel efficiency with its latest technology.':
    'AMAZER XP अपनी नवीनतम तकनीक के साथ सबसे ज़्यादा सफ़र का आराम और ज़्यादा ईंधन बचत देता है।',
  'APTERRA CROSS - High-performance SUV tyres that deliver comfort and control, with exceptional  grip.':
    'APTERRA CROSS - उच्च प्रदर्शन वाले SUV टायर, जो आराम और नियंत्रण के साथ बेहतरीन ग्रिप देते हैं।',
  'APTERRA HT2 is a highway terrain SUV tyre made for precise steering, cornering, and ride comfort.':
    'APTERRA HT2 हाईवे के लिए SUV टायर है, जो सटीक स्टीयरिंग, मोड़ पर पकड़ और सफ़र के आराम के लिए बना है।',
  'ASPIRE 5 is an ultra high-performance tyre made for adventure, high comfort, and low noise.':
    'ASPIRE 5 अत्यंत उच्च प्रदर्शन वाला टायर है, जो रोमांच, ज़्यादा आराम और कम शोर के लिए बना है।',
  'ActiGrip F6 is built to maintain dependable front-end control across mud, dirt, and demanding off-road terrain.':
    'ActiGrip F6 कीचड़, मिट्टी और कठिन कच्चे रास्तों पर आगे के पहिये का भरोसेमंद नियंत्रण बनाए रखने के लिए बना है।',
  'ActiGrip F8 is crafted for confident front-end control, reliable wet-road traction, and comfortable touring.':
    'ActiGrip F8 आगे के पहिये के पक्के नियंत्रण, गीली सड़क पर भरोसेमंद पकड़ और आरामदायक सफ़र के लिए तैयार किया गया है।',
  'ActiGrip R1 is made for dependable rear-wheel performance, combining strong grip with lasting tread durability.':
    'ActiGrip R1 पीछे के पहिये के भरोसेमंद प्रदर्शन के लिए बना है, जिसमें मज़बूत ग्रिप के साथ ट्रेड का लंबा टिकाऊपन मिलता है।',
  'ActiGrip R2 offers comfortable performance, strong road grip, and lasting tread strength for varied journeys.':
    'ActiGrip R2 आरामदायक प्रदर्शन, सड़क पर मज़बूत ग्रिप और अलग-अलग सफ़र के लिए ट्रेड की लंबी मज़बूती देता है।',
  'ActiGrip R4 supports smoother urban rides with enhanced road contact, comfort, and resistance to wear.':
    'ActiGrip R4 बेहतर सड़क पकड़, आराम और घिसाई से बचाव के साथ शहर में ज़्यादा सहज सफ़र देता है।',
  'ActiGrip R6 delivers strong rear-wheel traction, durable performance, and sure-footed control for rugged adventures.':
    'ActiGrip R6 पीछे के पहिये की मज़बूत पकड़, टिकाऊ प्रदर्शन और ऊबड़-खाबड़ रास्तों के रोमांच के लिए पक्का नियंत्रण देता है।',
  'ActiGrip R8 delivers dependable rear-wheel stability, strong road contact, and lasting performance across long journeys.':
    'ActiGrip R8 पीछे के पहिये की भरोसेमंद स्थिरता, मज़बूत सड़क पकड़ और लंबे सफ़र में टिकाऊ प्रदर्शन देता है।',
  'ActiGrip S4: Smooth rides for daily urban commutes.':
    'ActiGrip S4: रोज़ाना शहर में आने-जाने के लिए सहज सफ़र।',
  'ActiGrip S5+/S5: Built for smooth, comfortable rides across city roads.':
    'ActiGrip S5+/S5: शहर की सड़कों पर सहज और आरामदायक सफ़र के लिए बना।',
  'ActiSteer F1 combines all-weather road confidence with reduced tread wear for everyday journeys.':
    'ActiSteer F1 रोज़ के सफ़र के लिए हर मौसम में सड़क पर भरोसे के साथ ट्रेड की कम घिसाई देता है।',
  'ActiSteer F7 is built for directional stability, lasting performance, and reliable grip on wet and dry roads.':
    'ActiSteer F7 सीधी दिशा की स्थिरता, टिकाऊ प्रदर्शन और गीली व सूखी सड़कों पर भरोसेमंद ग्रिप के लिए बना है।',
  'ActiZip F2 brings responsive steering and reliable traction to everyday city travel.':
    'ActiZip F2 रोज़ के शहरी सफ़र में तुरंत जवाब देने वाली स्टीयरिंग और भरोसेमंद पकड़ लाता है।',
  'ActiZip F3 combines cornering stability with long-lasting performance for smoother daily journeys.':
    'ActiZip F3 रोज़ के ज़्यादा सहज सफ़र के लिए मोड़ पर स्थिरता के साथ लंबे समय तक चलने वाला प्रदर्शन देता है।',
  'ActiZip F5 brings precise steering, confident traction, and reduced tread wear to sports touring rides.':
    'ActiZip F5 स्पोर्ट्स टूरिंग सफ़र में सटीक स्टीयरिंग, पक्की पकड़ और ट्रेड की कम घिसाई लाता है।',
  'ActiZip R5 supports stable highway cruising with dependable grip and smooth manoeuvrability.':
    'ActiZip R5 भरोसेमंद ग्रिप और सहज मोड़-तोड़ के साथ हाईवे पर स्थिर रफ़्तार से चलने में मदद करता है।',
  'Agile loading and haulage performance. Premium E-3 pattern tyres for on / off road usage in heavy duty applications. Engineered to last long and go the distance whenever you need it.':
    'फुर्तीला लोडिंग और माल ढुलाई प्रदर्शन। भारी कामों में सड़क और कच्चे रास्तों पर इस्तेमाल के लिए प्रीमियम E-3 पैटर्न टायर। लंबे समय तक चलने और जब भी ज़रूरत हो, पूरा सफ़र तय करने के लिए बनाए गए।',
  'Alpha H1 is engineered for high-speed stability, confident cornering, and precise control on the highway.':
    'Alpha H1 तेज़ रफ़्तार की स्थिरता, पक्की कॉर्नरिंग और हाईवे पर सटीक नियंत्रण के लिए बनाया गया है।',
  'Alpha S1 delivers sharp sport handling, strong braking performance, and a refined road presence.':
    'Alpha S1 तेज़ स्पोर्ट हैंडलिंग, मज़बूत ब्रेकिंग प्रदर्शन और सड़क पर शानदार मौजूदगी देता है।',
  'An LCV tyre for those who need better mileage, better traction, and better load carrying capabilities. When nothing else endures, ENDURACE does.':
    'LCV टायर, उनके लिए जिन्हें बेहतर माइलेज, बेहतर पकड़ और ज़्यादा बोझ उठाने की क्षमता चाहिए। जब कुछ और नहीं टिकता, तब ENDURACE टिकता है।',
  'An MHCV tyre for those who need better mileage, better traction, and better load carrying capabilities. When nothing else endures, ENDURACE does.':
    'MHCV टायर, उनके लिए जिन्हें बेहतर माइलेज, बेहतर पकड़ और ज़्यादा बोझ उठाने की क्षमता चाहिए। जब कुछ और नहीं टिकता, तब ENDURACE टिकता है।',
  'Apollo AXVT redefines your trailer experience with performance that sets it apart from the rest. Optimised for real world trailer usage conditions on Indian roads.':
    'Apollo AXVT अपने प्रदर्शन से आपके ट्रेलर के अनुभव को नए सिरे से तय करता है, जो इसे बाकियों से अलग बनाता है। भारतीय सड़कों पर ट्रेलर के असली इस्तेमाल की स्थितियों के लिए तैयार किया गया।',
  'Apollo TERRA BT, the solution for the lowest cost of operation on rocky terrain. Built for durability and efficiency, Apollo TERRA BT offers cost-effective operations without compromising reliability or performance.':
    'Apollo TERRA BT, पथरीले इलाके में सबसे कम चलाने के खर्च का समाधान। मज़बूती और कार्यक्षमता के लिए बना Apollo TERRA BT भरोसे या प्रदर्शन से समझौता किए बिना किफ़ायती संचालन देता है।',
  'Apollo TERRA MT, the solution for the lowest cost of operation on rocky terrain. Built for durability and efficiency, Apollo TERRA MT offers cost-effective operations without compromising reliability or performance.':
    'Apollo TERRA MT, पथरीले इलाके में सबसे कम चलाने के खर्च का समाधान। मज़बूती और कार्यक्षमता के लिए बना Apollo TERRA MT भरोसे या प्रदर्शन से समझौता किए बिना किफ़ायती संचालन देता है।',
  'Apterra AT2 - An all terrain SUV tyre built for lasting durability and everyday comfort.':
    'Apterra AT2 - हर तरह के रास्ते के लिए SUV टायर, जो लंबी मज़बूती और रोज़ के आराम के लिए बना है।',
  'Attractive pattern with optimal Rib/Lug distribution across the cross-section.':
    'आकर्षक पैटर्न, जिसमें पूरे हिस्से में रिब/लग का सही बँटवारा है।',
  'Best in class Drive tyre for Regional application with superior carcass durability and retreadability':
    'क्षेत्रीय उपयोग के लिए अपनी श्रेणी का सबसे अच्छा ड्राइव टायर, जिसमें बेहतरीन कैरकस की मज़बूती और दोबारा ट्रेड चढ़वाने की सुविधा है।',
  'Bigger than the best, the Apollo VIRAT HARVEST is made for machines that match your aspirations. Go the distance trusting the durability and mileage of Apollo tractor tyres.':
    'सबसे बेहतरीन से भी बड़ा, Apollo VIRAT HARVEST आपकी उम्मीदों पर खरी उतरने वाली मशीनों के लिए बना है। Apollo ट्रैक्टर टायरों की मज़बूती और माइलेज पर भरोसा करके लंबा सफ़र तय कीजिए।',
  'Bring every destination closer with APTERRA HP’s enduring design and enhanced handling.  A strengthened shoulder and stiffness optimised longitudinal ribs always keep your SUV planted at highway speeds.':
    'APTERRA HP की टिकाऊ बनावट और बेहतर हैंडलिंग के साथ हर मंज़िल को क़रीब लाइए। मज़बूत किया गया शोल्डर और कठोरता के हिसाब से बने लंबाई वाले रिब हाईवे की रफ़्तार पर भी आपकी SUV को सड़क पर जमाए रखते हैं।',
  "Built for heavy-duty load transport and all-terrain adventures, the ENDUMAXX LT HD is India's toughest pick-up tyre. Its robust tread pattern provides exceptional durability and traction, conquering challenging terrains with ease. Designed for long-lasting performance, ENDUMAXX LT HD keeps you moving, with every load, on every road.":
    'भारी माल ढुलाई और हर तरह के रास्तों के सफ़र के लिए बना ENDUMAXX LT HD भारत का सबसे मज़बूत पिकअप टायर है। इसका दमदार ट्रेड पैटर्न शानदार मज़बूती और पकड़ देता है और मुश्किल इलाकों को आसानी से पार करता है। लंबे समय तक चलने वाले प्रदर्शन के लिए बना ENDUMAXX LT HD हर माल के साथ, हर सड़क पर आपको चलता रखता है।',
  'Built for relentless performance in demanding forklift applications. The Apollo SOLIFT R300 tyres are designed for continuous heavy-duty operation, up to 12-16 hours a day on paved surfaces, they deliver exceptional durability, wear resistance, and traction.':
    'कठिन फोर्कलिफ्ट कामों में लगातार दमदार प्रदर्शन के लिए बना। Apollo SOLIFT R300 टायर लगातार भारी काम के लिए बनाए गए हैं। पक्की सतह पर रोज़ 12-16 घंटे तक चलने पर भी ये शानदार मज़बूती, घिसाई से बचाव और पकड़ देते हैं।',
  'Built for smooth daily commutes with precise handling and dependable grip.':
    'सटीक हैंडलिंग और भरोसेमंद ग्रिप के साथ रोज़ की आसान आवाजाही के लिए बना।',
  'Built for speed and reliability that comes with intermediate range commercial trucking operations, the Loadstar Super Gold is a class above the competition when it comes to fuel efficiency, durability, and puncture resistance. Its strong casing makes it one of the most reliable tyres in the market.':
    'मध्यम दूरी के व्यावसायिक ट्रक संचालन में ज़रूरी रफ़्तार और भरोसे के लिए बना Loadstar Super Gold ईंधन की बचत, मज़बूती और पंक्चर से बचाव में मुक़ाबले से एक क़दम आगे है। इसका मज़बूत कैरकस इसे बाज़ार के सबसे भरोसेमंद टायरों में से एक बनाता है।',
  'Built to deliver confident control, enhanced grip, and lasting comfort across varied road conditions.':
    'अलग-अलग सड़कों पर भरोसेमंद नियंत्रण, बेहतर ग्रिप और लंबे समय तक आराम देने के लिए बना।',
  'Choose reliability and efficiency in every lift. Trust NULIFT for superior strength and performance. Elevate your forklift operations with confidence.':
    'हर उठान में भरोसा और कार्यक्षमता चुनिए। बेहतरीन ताक़त और प्रदर्शन के लिए NULIFT पर भरोसा कीजिए। अपने फोर्कलिफ्ट के काम को पूरे विश्वास के साथ आगे बढ़ाइए।',
  'Designed for dependable performance, reduced wear, and comfortable rides on semi-urban and rural roads.':
    'अर्ध-शहरी और ग्रामीण सड़कों पर भरोसेमंद प्रदर्शन, कम घिसाई और आरामदायक सफ़र के लिए बनाया गया।',
  'Designed for effortless manoeuvrability, enhanced safety, and long-lasting city rides.':
    'आसानी से मोड़ने-घुमाने, बेहतर सुरक्षा और शहर में लंबे समय तक चलने वाले सफ़र के लिए बनाया गया।',
  'Designed for noise-free, smooth rides with improved battery efficiency and dependable traction.':
    'बिना शोर के आसान सफ़र, बेहतर बैटरी कार्यक्षमता और भरोसेमंद पकड़ के लिए बनाया गया।',
  'Designed to withstand extreme conditions, it ensures unparalleled durability and performance. With EnduMile, conquer every mile with confidence, knowing you have the ultimate protection and longevity on the road.':
    'यह कठिन से कठिन हालात झेलने के लिए बना है और बेमिसाल मज़बूती और प्रदर्शन देता है। EnduMile के साथ हर मील भरोसे से तय कीजिए, क्योंकि सड़क पर आपके पास सबसे बढ़िया सुरक्षा और लंबी उम्र है।',
  'Dig past every obstacle with superior engineering of Apollo AWE 713. Specially designed for high traction requirements of wheeled excavators and other industrial machinery that requires solid gripping power.':
    'Apollo AWE 713 की बेहतरीन इंजीनियरिंग के साथ हर रुकावट को पार कीजिए। यह पहियों वाले एक्सकेवेटर और दूसरी औद्योगिक मशीनों की ज़्यादा पकड़ की ज़रूरत के लिए ख़ास तौर पर बना है, जिन्हें मज़बूत ग्रिप चाहिए।',
  'Dominate the field with superior traction and durability. Trust FX 333 for unmatched performance during deep puddling operations.':
    'बेहतरीन पकड़ और मज़बूती के साथ खेत में दबदबा बनाइए। गहरी पडलिंग के काम में बेमिसाल प्रदर्शन के लिए FX 333 पर भरोसा कीजिए।',
  'ENDUTRAX MD HD is built to perform under heavy loads, offering extreme durability and maximum uptime for mixed segment operations targeting sand and stone construction aggregates.':
    'ENDUTRAX MD HD भारी बोझ में दमदार प्रदर्शन के लिए बना है। यह रेत और पत्थर जैसे निर्माण सामग्री के मिले-जुले कामों में बेहद मज़बूती और ज़्यादा से ज़्यादा चालू रहने का समय देता है।',
  'EnduRace ED delivers unmatched reliability and stability, making it the perfect choice for light commercial vehicles. Trust Apollo EnduRace ED for optimal handling, durability and superior load bearing.':
    'EnduRace ED बेमिसाल भरोसा और स्थिरता देता है, इसलिए यह हल्के व्यावसायिक वाहनों के लिए सबसे सही चुनाव है। बेहतरीन हैंडलिंग, मज़बूती और ज़्यादा बोझ उठाने की क्षमता के लिए Apollo EnduRace ED पर भरोसा कीजिए।',
  'Engineered for durability and safety for heavy load transport.. Experience unmatched performance and longevity, making every journey efficient and worry-free. Trust Apollo, carry heavier, travel farther.':
    'भारी माल ढुलाई के लिए मज़बूती और सुरक्षा को ध्यान में रखकर बनाया गया। बेमिसाल प्रदर्शन और लंबी उम्र का अनुभव लीजिए, जिससे हर सफ़र कार्यक्षम और बेफ़िक्र हो। Apollo पर भरोसा कीजिए, ज़्यादा बोझ उठाइए, और दूर तक जाइए।',
  'Engineered for high-performance reach stacker operations in demanding port environments. The Apollo Harbor Pro tyres feature a stiffer sidewall construction to provide enhanced stability and precision for accurate stacking, even under heavy loads.':
    'कठिन बंदरगाह माहौल में दमदार रीच स्टैकर के कामों के लिए बनाया गया। Apollo Harbor Pro टायरों में ज़्यादा कठोर साइडवॉल बनावट है, जो भारी बोझ में भी सही ढंग से माल रखने के लिए बेहतर स्थिरता और सटीकता देती है।',
  'Engineered for versatile performance across soft soil, hard soil, and haulage. Experience superior durability, traction, and fuel efficiency with 3x benefits of the Agrex AT. Ideal for farmers seeking reliability and efficiency in diverse agricultural and transportation tasks.':
    'नरम मिट्टी, सख़्त मिट्टी और माल ढुलाई, तीनों में हर तरह के प्रदर्शन के लिए बनाया गया। Agrex AT के 3x फ़ायदों के साथ बेहतरीन मज़बूती, पकड़ और ईंधन की बचत पाइए। खेती और ढुलाई के अलग-अलग कामों में भरोसा और कार्यक्षमता चाहने वाले किसानों के लिए बिल्कुल सही।',
  'Engineered to withstand the harshest conditions. With EnduTuff, conquer challenging terrains with confidence and reliability, setting new standards for mining operations worldwide. Explore now.':
    'सबसे कठोर हालात झेलने के लिए बनाया गया। EnduTuff के साथ मुश्किल इलाकों को भरोसे के साथ पार कीजिए और दुनियाभर के खनन कामों के लिए नए मानक तय कीजिए। अभी देखिए।',
  'Ensures consistent performance mile after mile. With EnduRace RD2, maximize your mileage and experience reliability that goes the distance in long-haul operations.':
    'हर मील पर एक जैसा प्रदर्शन पक्का करता है। EnduRace RD2 के साथ अपना माइलेज ज़्यादा से ज़्यादा कीजिए और लंबी दूरी के कामों में दूर तक साथ निभाने वाले भरोसे का अनुभव लीजिए।',
  'Enudrace RT tyres bring durability to light commercial vehicles like never before. Crafted for endurance, long-lasting performance and exceptional road grip, ensuring your business runs smoothly.':
    'Enudrace RT टायर हल्के व्यावसायिक वाहनों को पहले कभी न देखी गई मज़बूती देते हैं। सहनशक्ति, लंबे समय के प्रदर्शन और शानदार सड़क ग्रिप के लिए बने ये टायर आपके कारोबार को बिना रुकावट चलाते हैं।',
  'Exceptional steer performance in mud and on road. Trust Virat for reliability and traction in diverse conditions. Choose Virat for superior maneuverability and durability on every terrain.':
    'कीचड़ और सड़क, दोनों पर शानदार स्टीयर प्रदर्शन। अलग-अलग हालात में भरोसे और पकड़ के लिए Virat पर भरोसा कीजिए। हर तरह के रास्ते पर बेहतर मोड़-घुमाव और मज़बूती के लिए Virat चुनिए।',
  'Expanding the Aspire series of premium car tyres with the all new Aspire 4G+ and its sporty performance. Get exceptional braking and stability at highway speeds with this precision crafted tyre for top-end sedans and hatchbacks.':
    'प्रीमियम कार टायरों की Aspire श्रृंखला को बिल्कुल नए Aspire 4G+ और इसके स्पोर्टी प्रदर्शन के साथ बढ़ाया गया है। टॉप-एंड सेडान और हैचबैक के लिए सटीकता से बने इस टायर के साथ हाईवे की रफ़्तार पर शानदार ब्रेकिंग और स्थिरता पाइए।',
  'Experience superior performance and cost savings with EnduRace RD nRG, setting new standards in tyre technology. Engineered for maximum mileage and minimal fuel consumption.':
    'EnduRace RD nRG के साथ बेहतरीन प्रदर्शन और खर्च की बचत का अनुभव लीजिए, जो टायर तकनीक में नए मानक तय करता है। यह ज़्यादा से ज़्यादा माइलेज और कम से कम ईंधन खपत के लिए बनाया गया है।',
  'Extra productive in every way, designed to maximize profits. Experience unparalleled efficiency and performance, ensuring your operations run smoothly and profitably.':
    'हर तरह से ज़्यादा उत्पादक, मुनाफ़ा बढ़ाने के लिए बनाया गया। बेमिसाल कार्यक्षमता और प्रदर्शन का अनुभव लीजिए, जिससे आपका काम आसानी से और फ़ायदे के साथ चलता रहे।',
  'For superior handling and stability during crane operation. Elevate your Hydra crane operations with confidence. Choose Apollo TERRA CRANE for unmatched reliability and efficiency on every job.':
    'क्रेन चलाते समय बेहतरीन नियंत्रण और स्थिरता के लिए। अपने हाइड्रा क्रेन के काम को पूरे भरोसे के साथ आगे बढ़ाइए। हर काम में बेजोड़ भरोसे और कुशलता के लिए Apollo TERRA CRANE चुनिए।',
  'For superior performance in every direction. Trust TERRA BHL for enhanced stability and efficiency. Elevate your backhoe loader operations with reliable traction and maneuverability in every job.':
    'हर दिशा में बेहतरीन प्रदर्शन के लिए। बेहतर स्थिरता और कुशलता के लिए TERRA BHL पर भरोसा कीजिए। भरोसेमंद पकड़ और आसानी से मुड़ने की क्षमता के साथ अपने बैकहो लोडर का काम हर बार आगे बढ़ाइए।',
  'For the ones who need VIRAT performance. Specially designed for hard soil application with innovative lug design and tyre technology to rule every farmland.':
    'उनके लिए जिन्हें VIRAT जैसा प्रदर्शन चाहिए। सख्त मिट्टी के काम के लिए खास तौर पर बनाया गया, नए लग डिज़ाइन और टायर तकनीक के साथ, ताकि हर खेत पर आपका राज रहे।',
  'For the ones who prefer performance over everything else. Go the distance without breaking a sweat with Apollo XT-7 tyres for medium and heavy commercial vehicles.':
    'उनके लिए जो हर चीज़ से ऊपर प्रदर्शन को चुनते हैं। मध्यम और भारी व्यावसायिक वाहनों के लिए Apollo XT-7 टायरों के साथ बिना थके लंबी दूरी तय कीजिए।',
  'For the trailblazers transforming trucking and haulage. The EnduRace RT is specially developed for heavy trailer usage and enables cost efficient operations through its strong construction that can support multiple retreads.':
    'ट्रक और माल ढुलाई का रूप बदलने वाले अग्रणी लोगों के लिए। EnduRace RT भारी ट्रेलर के इस्तेमाल के लिए खास तौर पर बनाया गया है, और इसकी मज़बूत बनावट कई बार रिट्रेड का साथ देती है, जिससे संचालन किफ़ायती रहता है।',
  'For those who need productivity and performance. The Apollo FX 212 is specially designed for agile farm operations in orchards and smaller cultivation sites.':
    'उनके लिए जिन्हें उत्पादकता और प्रदर्शन चाहिए। Apollo FX 212 बाग़ों और छोटे खेतों में फुर्ती से होने वाले खेती के कामों के लिए खास तौर पर बनाया गया है।',
  'For tough roads and tough weather. EnduTuff goes the distance no matter the terrain. Robust to the core with ACTO technology to ensure durable all-round performance.':
    'कठिन सड़कों और कठिन मौसम के लिए। EnduTuff हर तरह के रास्ते पर लंबी दूरी तय करता है। ACTO तकनीक के साथ भीतर से मज़बूत, ताकि हर तरह से टिकाऊ प्रदर्शन मिले।',
  'Go the distance without giving it a second thought. Apollo XT-9 Gold offers long lasting performance that goes on and on with higher mileage and retread potential.':
    'बिना दोबारा सोचे लंबी दूरी तय कीजिए। Apollo XT-9 Gold ज़्यादा माइलेज और रिट्रेड की संभावना के साथ लंबे समय तक चलने वाला प्रदर्शन देता है।',
  'Higher land contact area, excellent resistance to wet skidding':
    'ज़मीन से ज़्यादा संपर्क क्षेत्र, गीली सड़क पर फिसलने से बेहतरीन बचाव',
  'Ideal for moderate load application, this reinforced truck and trailer tyre offers the stability and performance you need for your goods carrier. The continuous rib design is enhanced by our trademark ACTO technology for superior mileage and efficiency.':
    'मध्यम भार के काम के लिए उपयुक्त, यह मज़बूत किया गया ट्रक और ट्रेलर टायर आपके माल वाहक को वह स्थिरता और प्रदर्शन देता है जो उसे चाहिए। लगातार रिब डिज़ाइन को हमारी पहचान वाली ACTO तकनीक से और बेहतर बनाया गया है, ताकि माइलेज और कुशलता बढ़िया रहे।',
  'Known as the king of durability, the Apollo Altrust series offers the first dedicated tyres for the people mover segment. The Altrust Go is a specifically designed small van tyre offering unmatched performance and mileage in its segment.':
    'टिकाऊपन का बादशाह कहलाने वाली Apollo Altrust श्रृंखला सवारी ढोने वाले वाहनों के वर्ग के लिए पहले समर्पित टायर देती है। Altrust Go खास तौर पर बनाया गया छोटी वैन का टायर है, जो अपने वर्ग में बेजोड़ प्रदर्शन और माइलेज देता है।',
  'Long lasting SUV tyre for maximum durability and enhanced steering':
    'अधिकतम टिकाऊपन और बेहतर स्टीयरिंग के लिए लंबे समय तक चलने वाला SUV टायर',
  'Made for rugged performance, Apollo XT-100 HD offers superior durability and reliability in regional haulage. Tackle tough terrains with confidence, get optimal traction and extend tyre life for your fleet.':
    'दमदार प्रदर्शन के लिए बना Apollo XT-100 HD क्षेत्रीय माल ढुलाई में बेहतरीन टिकाऊपन और भरोसा देता है। कठिन रास्तों का सामना भरोसे के साथ कीजिए, बढ़िया पकड़ पाइए और अपने बेड़े के टायरों की उम्र बढ़ाइए।',
  'Made for the ultimate challenges of nature and man, the Mine Lug series chews through terrain with steadfast reliability. Made from high-strength rubber with extra deep tread, these tyres are the only thing you need when hauling on punishing off-road terrains under unrelenting weather conditions.':
    'प्रकृति और इंसान की सबसे बड़ी चुनौतियों के लिए बनी Mine Lug श्रृंखला अटल भरोसे के साथ हर रास्ते को पार करती है। बहुत मज़बूत रबर और ज़्यादा गहरे ट्रेड से बने ये टायर कठोर मौसम में मुश्किल कच्चे रास्तों पर माल ढोने के लिए आपको बस यही चाहिए।',
  'Making the regional cargo runs fun again, the Apollo EnduRace RA1 offers superior mileage and long lasting performance for truck and fleet owners. Rated for light and moderate loads, this all-wheel truck tyre is ready for any challenge you throw in its way.':
    'क्षेत्रीय माल ढुलाई को फिर से मज़ेदार बनाते हुए, Apollo EnduRace RA1 ट्रक और बेड़े के मालिकों को बढ़िया माइलेज और लंबे समय तक चलने वाला प्रदर्शन देता है। हल्के और मध्यम भार के लिए तय किया गया यह सभी पहियों वाला ट्रक टायर हर चुनौती के लिए तैयार है।',
  'Meant for Mixed Application, to be fitted in tipper trucks & tip trailers in Drive Position.':
    'मिले-जुले इस्तेमाल के लिए बना, टिप्पर ट्रक और टिप ट्रेलर में ड्राइव वाली जगह पर लगाने के लिए।',
  'Minimize the risk and maximize the fun with Apollo actiZIP R3, a motorbike tyre offering superior handling, no matter the surface. Rated for high speed cornering and superior braking stability, the enhanced traction of this tyre helps you chart the uncharted.':
    'जोखिम कम कीजिए और मज़ा बढ़ाइए Apollo actiZIP R3 के साथ, जो मोटरबाइक का टायर है और किसी भी सतह पर बेहतरीन नियंत्रण देता है। तेज़ रफ़्तार में मोड़ काटने और ब्रेक लगाते समय बढ़िया स्थिरता के लिए तय किया गया, इस टायर की बेहतर पकड़ आपको अनजाने रास्तों पर चलने में मदद करती है।',
  'New, innovative tyre design that goes the distance no matter the terrain. For workloads that do not compromise on durability and performance.':
    'नया, अनोखा टायर डिज़ाइन जो हर तरह के रास्ते पर लंबी दूरी तय करता है। उन कामों के लिए जो टिकाऊपन और प्रदर्शन से समझौता नहीं करते।',
  'No distance is too long and no challenge is too tough. Ride through every tide and terrain with the toughened casing design and reinvented, bold block pattern of ENDURACE RD HD.':
    'कोई दूरी इतनी लंबी नहीं और कोई चुनौती इतनी कठिन नहीं। ENDURACE RD HD के मज़बूत किए गए केसिंग डिज़ाइन और नए सिरे से बने दमदार ब्लॉक पैटर्न के साथ हर लहर और हर रास्ते से गुज़र जाइए।',
  'No load too heavy, no journey too far. Sturdy carcass with superior lug design to increase productivity and reduce downtime of your heavy duty operations.':
    'कोई बोझ इतना भारी नहीं, कोई सफ़र इतना लंबा नहीं। मज़बूत ढांचा और बेहतरीन लग डिज़ाइन, ताकि आपके भारी कामों की उत्पादकता बढ़े और बंद रहने का समय घटे।',
  'Our cutting-edge New-Gen agricultural tyre range, meticulously crafted to elevate your productivity and farm output. Engineered for peak performance, these tyres are optimized for extended use during the demanding harvest season, ensuring durability, reliability, and efficiency.':
    'हमारी अत्याधुनिक नई पीढ़ी की खेती के टायरों की श्रृंखला, जिसे आपकी उत्पादकता और खेत की पैदावार बढ़ाने के लिए बारीकी से बनाया गया है। बेहतरीन प्रदर्शन के लिए तैयार ये टायर कटाई के व्यस्त मौसम में लंबे इस्तेमाल के लिए बनाए गए हैं, जिससे टिकाऊपन, भरोसा और कुशलता मिलती है।',
  'Overtake every obstacle, overcome every challenge, go the distance with Apollo AMAR GOLD bias tyres for regional haulage and mixed operations.':
    'हर रुकावट को पीछे छोड़िए, हर चुनौती को जीतिए और क्षेत्रीय माल ढुलाई व मिले-जुले कामों के लिए Apollo AMAR GOLD बायस टायरों के साथ लंबी दूरी तय कीजिए।',
  'Packed full with modern tyre technology the nRG series offers unparalleled rolling dynamics to ensure fuel cost savings. With its special tread design, the EnduRace RA(T) nRG goes the distance quickly and efficiently.':
    'आधुनिक टायर तकनीक से भरी nRG श्रृंखला बेजोड़ लुढ़कने की क्षमता देती है, जिससे ईंधन के खर्च में बचत होती है। अपने खास ट्रेड डिज़ाइन के साथ EnduRace RA(T) nRG लंबी दूरी जल्दी और कुशलता से तय करता है।',
  'Perfect for demanding routes, the Amar DLX brings superior operability by increasing fleet up-times and reducing overheads. Engineered to deliver exceptional durability and longevity this tyre is the choice of every long-haul truck and fleet owner.':
    'कठिन रास्तों के लिए एकदम सही, Amar DLX बेड़े के चालू रहने का समय बढ़ाकर और ऊपरी खर्च घटाकर बेहतर संचालन देता है। शानदार टिकाऊपन और लंबी उम्र देने के लिए बना यह टायर लंबी दूरी के हर ट्रक और बेड़े के मालिक की पसंद है।',
  'Performance where you need it, when you need it. Apollo AIT 406 backhoe loader tyres are specially engineered for heavy load applications.':
    'प्रदर्शन वहीं और तभी, जब आपको चाहिए। Apollo AIT 406 बैकहो लोडर टायर भारी भार के कामों के लिए खास तौर पर बनाए गए हैं।',
  'Presenting the Alnac 4Gs with our class-leading tread design that favors superior performance every single time. Backed by 5-year manufacturing warranty, the Alnac 4GS is the ultimate city tyre for sedans and hatchbacks.':
    'पेश है Alnac 4Gs, हमारे अपने वर्ग में सबसे आगे ट्रेड डिज़ाइन के साथ, जो हर बार बेहतरीन प्रदर्शन देता है। 5 साल की निर्माण वारंटी के साथ, Alnac 4GS सेडान और हैचबैक कारों के लिए शहर का सबसे बढ़िया टायर है।',
  'Reduce equipment downtime and maximise your productivity. Compatibility with wide range of industrial equipment and machinery. Durable, long lasting design with excellent weather protection.':
    'मशीनों के बंद रहने का समय घटाइए और अपनी उत्पादकता बढ़ाइए। औद्योगिक उपकरणों और मशीनों की बड़ी रेंज के साथ चलने लायक। टिकाऊ, लंबे समय तक चलने वाला डिज़ाइन, जो मौसम से बढ़िया बचाव करता है।',
  'Reinforced with a stress limited carcass design to give your fleet a stress-free operability. Trust the EnduRace RD for enhanced traction and a solid footprint that keeps both goods and passengers safe.':
    'तनाव को सीमित रखने वाले मज़बूत ढांचे के साथ, ताकि आपके बेड़े का संचालन बिना चिंता के हो। बेहतर पकड़ और मज़बूत पदचिह्न के लिए EnduRace RD पर भरोसा कीजिए, जो माल और सवारियों दोनों को सुरक्षित रखता है।',
  'Setting new standards for mileage in its class. Engineered for efficiency and durability, the Apollo ABHIMANYU is the ideal choice for steer applications in the commercial segment.':
    'अपने वर्ग में माइलेज के नए मानक बनाता हुआ। कुशलता और टिकाऊपन के लिए बना Apollo ABHIMANYU व्यावसायिक वर्ग में आगे के स्टीयरिंग वाले पहियों के लिए आदर्श पसंद है।',
  'Setting new standards in performance and longevity for regional operations. Engineered for durability the Apollo SLHD can withstand the toughest road conditions with ease.':
    'क्षेत्रीय संचालन के लिए प्रदर्शन और लंबी उम्र के नए मानक बनाता हुआ। टिकाऊपन के लिए बना Apollo SLHD सबसे कठिन सड़कों की हालत को आसानी से झेल सकता है।',
  'Specialised tyre for special application. The ARC 317 with its special block tread pattern is designed for heavy load operations  that require strength, durability and the highest levels of performance.':
    'खास काम के लिए खास टायर। अपने विशेष ब्लॉक ट्रेड पैटर्न के साथ ARC 317 भारी भार वाले उन कामों के लिए बनाया गया है जिनमें मज़बूती, टिकाऊपन और सर्वोच्च स्तर का प्रदर्शन चाहिए।',
  'Specially design for heavy lifting operations. The Apollo ALT 108 syncs performance and productivity in the most optimal manner. Built for the toughest of terrains and weather conditions.':
    'भारी सामान उठाने के कामों के लिए खास तौर पर बनाया गया। Apollo ALT 108 परफॉर्मेंस और उत्पादकता का सबसे बढ़िया तालमेल देता है। सबसे मुश्किल इलाकों और मौसम के लिए तैयार किया गया।',
  "Specially designed for heavy loads, these tyres offer unparalleled durability and grip. Perfect for challenging terrains. Ensure your cargo's safety and your peace of mind. Choose BHIM, where strength meets reliability on every road.":
    'भारी लोड के लिए खास तौर पर बने ये टायर बेजोड़ टिकाऊपन और ग्रिप देते हैं। मुश्किल इलाकों के लिए एकदम सही। अपने माल की सुरक्षा और अपने मन की शांति पक्की करें। BHIM चुनें, जहाँ हर सड़क पर ताकत और भरोसा साथ मिलते हैं।',
  'Stay on track, always, with EnduTrax MD. Higher up-time with enhanced design and construction to reduce tyre maintenance and improve your bottom lines. Meant for Mixed Application, to be fitted in tipper trucks & tip trailers in Drive Position.':
    'EnduTrax MD के साथ हमेशा सही राह पर रहें। बेहतर डिज़ाइन और बनावट से गाड़ी ज़्यादा समय चलती है, टायर की देखभाल कम होती है और आपकी कमाई बढ़ती है। मिश्रित इस्तेमाल के लिए बना है, टिपर ट्रकों और टिप ट्रेलरों में ड्राइव पोज़िशन पर लगाने के लिए।',
  'Super heavy load drive tyres for tough roads and tougher drivers. The Apollo Loadstar Super XP has high tensile strength and groundbreaking cut and chip resistance to help you face every challenge, whether man made or natural.':
    'मुश्किल सड़कों और उनसे भी मज़बूत ड्राइवरों के लिए बेहद भारी लोड वाले ड्राइव टायर। Apollo Loadstar Super XP में ज़्यादा तन्यता ताकत और कटने व छिलने से बचाव की नई क्षमता है, ताकि आप हर चुनौती का सामना कर सकें, चाहे वह इंसान की बनाई हो या कुदरती।',
  'Superior grip and handling in skid-steer operations. Reduce downtime and maximise productivity with Apollo ASR 614 tyres for skid steer loaders of all shapes and sizes.':
    'स्किड-स्टीयर के कामों में बेहतरीन ग्रिप और कंट्रोल। हर आकार के स्किड स्टीयर लोडर के लिए Apollo ASR 614 टायर के साथ बंद रहने का समय घटाएँ और उत्पादकता बढ़ाएँ।',
  'Superior heavy-duty truck tyre with firm reinforcement for heavy loads':
    'भारी लोड के लिए मज़बूत बनावट वाला बेहतरीन भारी ट्रक टायर',
  'Take your fleet’s productivity up by several levels with the multitude of benefits offered by Apollo EnduRace LDR. Rated for high-performance and heavy-duty usage the tyre is best suited for regional applications.':
    'Apollo EnduRace LDR के ढेरों फायदों से अपने बेड़े की उत्पादकता कई गुना बढ़ाएँ। ज़्यादा परफॉर्मेंस और भारी इस्तेमाल के लिए तय किया गया यह टायर क्षेत्रीय इस्तेमाल के लिए सबसे उपयुक्त है।',
  'The Apollo Aspire is a premium car tyre offering exceptional braking and control at highway speeds. Specially crafted for high-end sedans and premium hatchbacks, the Apollo Aspire gives you ultimate stability during cornering and overtakes.':
    'Apollo Aspire एक प्रीमियम कार टायर है, जो हाईवे की रफ्तार पर शानदार ब्रेकिंग और कंट्रोल देता है। ऊँचे दर्जे की सेडान और प्रीमियम हैचबैक के लिए खास तौर पर बना Apollo Aspire मोड़ काटते और ओवरटेक करते समय बेहतरीन स्थिरता देता है।',
  'The Apterra HL offers high traction, good comfort, moderate life.':
    'Apterra HL में ज़्यादा पकड़, अच्छा आराम और ठीक-ठाक उम्र मिलती है।',
  'The gold standard of tractor tyres. Trust the Apollo KRISHAK GOLD when the terrain requires something extraordinary. Comes with high NSD for premium mileage and sturdy construction for better retread-ability.':
    'ट्रैक्टर टायरों का सबसे ऊँचा पैमाना। जब इलाका कुछ खास माँगे, तब Apollo KRISHAK GOLD पर भरोसा करें। इसमें बढ़िया माइलेज के लिए ज़्यादा NSD और बेहतर रीट्रेड के लिए मज़बूत बनावट है।',
  'The trusted companion of millions of van drivers and people movers, the Apollo Altrust offers uncompromising ride quality and handling attributes. Its low rolling resistance gives you the fuel economy needed to go the distance.':
    'लाखों वैन ड्राइवरों और सवारी ढोने वालों का भरोसेमंद साथी Apollo Altrust सफर के आराम और कंट्रोल में कोई समझौता नहीं करता। इसका कम रोलिंग प्रतिरोध आपको लंबी दूरी के लिए ज़रूरी ईंधन की बचत देता है।',
  'The tyre you need when things need to be handled with care. The Apollo EnduTrax MA is an all wheel vehicle and trailer tyre with excellent grip and high uptime for both short and long haul applications.':
    'जब सामान को संभालकर ले जाना हो, तब यही टायर चाहिए। Apollo EnduTrax MA सभी पहियों वाले वाहन और ट्रेलर का टायर है, जिसमें शानदार ग्रिप है और गाड़ी ज़्यादा समय चलती है, चाहे छोटी दूरी हो या लंबी।',
  'The tyre you need when things need to be handled with care. The Apollo EnduTrax MA is an all wheel vehicle and trailer tyre with excellent grip and high uptime for both short and long haul applications.\n\nMeant for Mixed Application, to be fitted on steer axles on tippers & steer & trailer axles on tip trailers':
    'जब सामान को संभालकर ले जाना हो, तब यही टायर चाहिए। Apollo EnduTrax MA सभी पहियों वाले वाहन और ट्रेलर का टायर है, जिसमें शानदार ग्रिप है और गाड़ी ज़्यादा समय चलती है, चाहे छोटी दूरी हो या लंबी।\n\nमिश्रित इस्तेमाल के लिए बना है, टिपरों के स्टीयर एक्सल पर और टिप ट्रेलरों के स्टीयर व ट्रेलर एक्सल पर लगाने के लिए।',
  'Time to power up your operations. Wide lug tread pattern with large bucket volume for higher traction on and off the roads less taken.':
    'अपने कामकाज को ताकत देने का समय आ गया है। चौड़े लग वाला ट्रेड पैटर्न और बड़ी बकेट क्षमता, ताकि कम चलने वाले रास्तों पर और सड़क से हटकर भी ज़्यादा पकड़ मिले।',
  'Tougher than the toughest terrain you will ever face. Face every obstacle, go the distance and back with the advanced rubber compound and solid casing design of Apollo XT7 GOLD HD light commercial vehicle tyre.':
    'आपके सामने आने वाले सबसे मुश्किल इलाके से भी ज़्यादा मज़बूत। Apollo XT7 GOLD HD हल्के व्यावसायिक वाहन के टायर के उन्नत रबर मिश्रण और ठोस केसिंग डिज़ाइन के साथ हर रुकावट का सामना करें और दूर तक जाकर लौटें।',
  'Tramplr ST combines all-weather traction, bold tread styling, and confident handling across wet, dry, and muddy terrains.':
    'Tramplr ST में हर मौसम की पकड़, दमदार ट्रेड स्टाइल और गीले, सूखे व कीचड़ वाले इलाकों में भरोसेमंद कंट्रोल एक साथ मिलता है।',
  'Tramplr XR is engineered for uncompromising off-road control, confident leaning, and dependable traction across challenging terrain.':
    'Tramplr XR को सड़क से हटकर बेहतरीन कंट्रोल, भरोसे के साथ झुकाव और मुश्किल इलाके में भरोसेमंद पकड़ के लिए तैयार किया गया है।',
  'Trust ASR 624 for enhanced stability and efficiency on any surface. Elevate your skidsteer operations with confidence. Choose ASR 624 for unmatched performance and reliability.':
    'किसी भी सतह पर बेहतर स्थिरता और कार्यक्षमता के लिए ASR 624 पर भरोसा करें। अपने स्किडस्टीयर के कामों को पूरे भरोसे के साथ आगे बढ़ाएँ। बेजोड़ परफॉर्मेंस और भरोसे के लिए ASR 624 चुनें।',
  'Unmatched performance in the segment. The Apollo FARMKING rules the farmland with its enhanced design and superior traction in farming, load bearing and haulage operations.':
    'अपने वर्ग में बेजोड़ परफॉर्मेंस। Apollo FARMKING अपने बेहतर डिज़ाइन और खेती, बोझ उठाने व माल ढुलाई के कामों में शानदार पकड़ के साथ खेतों पर राज करता है।',
  'Upgrade your Reach Stackers with Apollo today! Elevate port efficiency with enhanced traction and durability. Ensure safer and precise port operations with HARBOR PRO II.':
    'आज ही अपने रीच स्टैकर को Apollo से अपग्रेड करें! बेहतर पकड़ और टिकाऊपन के साथ बंदरगाह की कार्यक्षमता बढ़ाएँ। HARBOR PRO II के साथ बंदरगाह के काम को ज़्यादा सुरक्षित और सटीक बनाएँ।',
  'Upgrade your fleet with better stability, ride quality, and mileage with Apollo EnduRace. With its unique multi axle pattern and deep treads the EnduRace MA 326 is a highly durable and cost effective product for truck and bus vehicles.':
    'Apollo EnduRace के साथ अपने बेड़े को बेहतर स्थिरता, सफर के आराम और माइलेज के साथ अपग्रेड करें। अपने खास मल्टी एक्सल पैटर्न और गहरे ट्रेड के साथ EnduRace MA 326 ट्रक और बस के लिए बेहद टिकाऊ और किफायती उत्पाद है।',
  'Use in a wide range of industrial applications and equipment. Durable, long lasting design with excellent weather protection. Reduce equipment downtime and maximise your productivity.':
    'औद्योगिक कामों और उपकरणों की एक बड़ी रेंज में इस्तेमाल करें। टिकाऊ, लंबे समय तक चलने वाला डिज़ाइन, जिसमें मौसम से शानदार बचाव है। उपकरण के बंद रहने का समय घटाएँ और अपनी उत्पादकता बढ़ाएँ।',
  'When the road calls and you need a reliable partner, EnduMile LHA comes along. Made from optimized rubber compounds for heavy duty long haul load carrying, EnduMile represents the pinnacle of trucking tyre technology from Apollo Tyres Limited.':
    'जब सड़क बुलाए और आपको भरोसेमंद साथी चाहिए, तब EnduMile LHA साथ चलता है। भारी लोड लेकर लंबी दूरी तय करने के लिए बेहतरीन रबर मिश्रण से बना EnduMile, Apollo टायर्स लिमिटेड की ट्रक टायर तकनीक की सबसे ऊँची मिसाल है।',
  'When the situation demands more. Get the best out of your grading and crane operations with the stability and tractive performance of Apollo ARG 217.':
    'जब हालात और ज़्यादा माँगें। Apollo ARG 217 की स्थिरता और खींचने की क्षमता के साथ अपने ग्रेडिंग और क्रेन के कामों से सबसे बढ़िया नतीजा पाएँ।',
  'When you need superior traction at every step, you need “Puddling ka Champion”. The FX 222 offers superior traction in muddy and slurry application where precision and control are the only requirements.':
    'जब हर कदम पर बेहतरीन पकड़ चाहिए, तब आपको चाहिए “पडलिंग का चैंपियन”। FX 222 कीचड़ और गारे वाले कामों में शानदार पकड़ देता है, जहाँ सिर्फ़ सटीकता और कंट्रोल की ज़रूरत होती है।',
  'When your field and your profits need to be lined up perfectly. The Apollo FX 515 rear tractor tyre comes with optimal footprint and low ground pressure for row crop protection.':
    'जब आपके खेत और आपके मुनाफे को एकदम सही तालमेल चाहिए। Apollo FX 515 ट्रैक्टर का पिछला टायर कतार में बोई फसल की सुरक्षा के लिए सही पदचिह्न और कम ज़मीनी दबाव के साथ आता है।',
  'With EnduComfort CA2, enjoy unparalleled comfort and stability in your cargo operations. Engineered with advanced technology to ensure a smooth and pleasant ride experience.':
    'EnduComfort CA2 के साथ अपने माल ढुलाई के कामों में बेजोड़ आराम और स्थिरता का आनंद लें। उन्नत तकनीक से बना, ताकि सफर आरामदायक और सुखद रहे।',
  'With EnduRace LD+, maximize your uptime and keep your journey smooth and economical. Offering unparalleled durability, grip, and fuel efficiency for those who demand reliability and performance.':
    'EnduRace LD+ के साथ अपनी गाड़ी के चलने का समय बढ़ाएँ और सफर को आसान व किफायती रखें। भरोसा और परफॉर्मेंस चाहने वालों के लिए बेजोड़ टिकाऊपन, ग्रिप और ईंधन की बचत।',
  'With highest mileage and durability rating in its class, this is the tyre you need when you really need to go the distance. Take the roads not taken with Apollo ENDURACE RA.':
    'अपने वर्ग में सबसे ऊँची माइलेज और टिकाऊपन रेटिंग वाला यह वही टायर है, जो लंबी दूरी तय करने के लिए चाहिए। Apollo ENDURACE RA के साथ उन रास्तों पर चलें, जिन पर कोई नहीं चला।',
};

/** One feature of the shop's feature list (the list is joined with " | ") -> Hindi. */
export const APOLLO_FEATURES_HI: Readonly<Record<string, string>> = {
  '3 Straight ribs at the center with wider channel grooves Excellent Free rolling characteristic Enhanced directional stability':
    'बीच में 3 सीधी रिब और चौड़े खांचे, शानदार फ्री रोलिंग, बेहतर दिशात्मक स्थिरता',
  'All Terrain Traction Patented Multi-Directional Tread Design Saw-Tooth Shoulder technology for high levels of traction on mud/sand':
    'हर इलाके में ट्रैक्शन, पेटेंटेड बहु-दिशात्मक ट्रेड डिज़ाइन, कीचड़ और रेत पर ज़्यादा ट्रैक्शन के लिए आरी-दांत शोल्डर तकनीक',
  'Best in Class Mileage and Durability Twin Steel Belt with JCP Protection High Puncture Resistance':
    'बेहतरीन माइलेज और मज़बूती, JCP सुरक्षा के साथ ट्विन स्टील बेल्ट, पंक्चर से ज़्यादा बचाव',
  'Better Fuel Efficiency Low rolling resistance compound for better fuel efficiency':
    'बेहतर ईंधन बचत, कम रोलिंग प्रतिरोध वाला कंपाउंड ईंधन की बेहतर बचत के लिए',
  'Better Ride Comfort Improved comfort helical placement of sipes for smooth tyre-road interaction':
    'बेहतर सवारी आराम, साइप की हेलिकल बनावट से टायर और सड़क का मुलायम संपर्क',
  'Channelized independent center and side blocks Superior traction in the on-off maneuvering Improved road holding and safety on-road and off-road condition':
    'अलग-अलग बीच और साइड ब्लॉक, सड़क और कच्चे रास्ते पर बेहतरीन ट्रैक्शन, दोनों हालात में बेहतर पकड़ और सुरक्षा',
  'Confidence during emergency situation Exceptional dry braking Tread compound based on higher Tg (Glass transition temperature) rubber':
    'आपात स्थिति में भरोसा, सूखी सड़क पर शानदार ब्रेकिंग, ऊँचे ग्लास ट्रांज़िशन तापमान वाले रबर पर बना ट्रेड कंपाउंड',
  'Continuous Zig Zag groove with safety curvy grooves opening towards shoulder Efficient water evacuation Improved cornering stability and precise steering control on wet and dry road condition':
    'लगातार ज़िगज़ैग खांचा और शोल्डर की ओर खुलते सुरक्षा वक्र खांचे, पानी की अच्छी निकासी, गीली और सूखी सड़क पर मोड़ में बेहतर स्थिरता और सटीक स्टीयरिंग',
  'Continuous centre groove with safety curvy grooves opening towards shoulder Efficient water evacuation Improved cornering stability and precise steering control on wet and dry road condition':
    'लगातार बीच का खांचा और शोल्डर की ओर खुलते सुरक्षा वक्र खांचे, पानी की अच्छी निकासी, गीली और सूखी सड़क पर मोड़ में बेहतर स्थिरता और सटीक स्टीयरिंग',
  'Cut sipes at Shoulder Efficient water evacuation Improved cornering stability and precise steering control on wet and dry road condition':
    'शोल्डर पर कटे साइप, पानी की अच्छी निकासी, गीली और सूखी सड़क पर मोड़ में बेहतर स्थिरता और सटीक स्टीयरिंग',
  'Directional tread pattern with anchored grooves Superior traction Superior dry and wet grip safety':
    'जमे हुए खांचों वाला दिशात्मक ट्रेड पैटर्न, बेहतरीन ट्रैक्शन, सूखी और गीली सड़क पर बेहतर ग्रिप और सुरक्षा',
  'Durability and Puncture Resistance Triplex Casing with a Patented Polymer Blend Compound DPF Technology to ensure outstanding durability in All Terrains':
    'मज़बूती और पंक्चर से बचाव, पेटेंटेड पॉलिमर मिश्रण कंपाउंड वाला ट्रिपलेक्स केसिंग, हर इलाके में शानदार मज़बूती के लिए DPF तकनीक',
  "Dynamic Contour Technology: Enhances physical and acoustic comfort. India's leading silent tyre.":
    'डायनामिक कंटूर तकनीक, शारीरिक और आवाज़ के आराम को बढ़ाती है, भारत का अग्रणी शांत टायर',
  'ENHANCED DIRECTIONAL STABILITY & PRECISION STEERING CONTROL Continuous':
    'बेहतर दिशात्मक स्थिरता और सटीक स्टीयरिंग नियंत्रण, लगातार',
  'ENHANCED GRIP AND STABILITY ON WET ROADS HIGH SPEED BIKING Stylish Parabolic tread groove design Minimize ‘hydro planning’ effect':
    'गीली सड़क पर बेहतर ग्रिप और स्थिरता, तेज़ रफ़्तार बाइकिंग, स्टाइलिश परवलयाकार ट्रेड खांचे जो पानी पर फिसलने का असर कम करते हैं',
  'ENHANCED GRIP WHILE CORNERING AT HIGH SPEEDS Symmetric sipe orientation':
    'तेज़ रफ़्तार में मोड़ पर बेहतर ग्रिप, एक जैसी दिशा में बने साइप',
  'ENHANCED SAFETY Pentagonal wider blocks at the centre and angular blocks at the shoulder':
    'बेहतर सुरक्षा, बीच में चौड़े पंचकोणीय ब्लॉक और शोल्डर पर कोणीय ब्लॉक',
  'EVEN FOOT PRINT AND HIGHER TREAD MILEAGE Oriented assorted tread blocks':
    'एक समान फुटप्रिंट और ज़्यादा ट्रेड माइलेज, सलीके से लगे अलग-अलग ट्रेड ब्लॉक',
  'EXCELLENT HANDLING AND STABILITY Higher contact patch area and increased stiffness Uniform foot print pressure distribution':
    'शानदार हैंडलिंग और स्थिरता, ज़्यादा संपर्क क्षेत्र और बढ़ी हुई कठोरता, फुटप्रिंट पर एक समान दबाव',
  'EXCELLENT HANDLING AND STABILITY New profile with reinforced carcass featuring a higher contact patch area and increased stiffness. Uniform foot print pressure distribution and reduced block movement.':
    'शानदार हैंडलिंग और स्थिरता, मज़बूत कार्कैस के साथ नई प्रोफ़ाइल, ज़्यादा संपर्क क्षेत्र और बढ़ी हुई कठोरता, फुटप्रिंट पर एक समान दबाव और ब्लॉक की कम हलचल',
  'EXCELLENT RIDE & HANDLING Rounded tyre profile Excellent correlation with rear tyre':
    'शानदार सवारी और हैंडलिंग, गोल टायर प्रोफ़ाइल, पिछले टायर के साथ बढ़िया तालमेल',
  'Enchanced Performance Premium Tread compund High tensile Strength tread compound for enhanced resistance to punctures, cuts & chips':
    'बेहतर प्रदर्शन, प्रीमियम ट्रेड कंपाउंड, ऊँची तन्य मज़बूती वाला ट्रेड कंपाउंड जो पंक्चर, कट और चिप से ज़्यादा बचाता है',
  'Enhanced Safety Excellent dry braking High quality rubber compound with unique tread pattern design':
    'बेहतर सुरक्षा, सूखी सड़क पर शानदार ब्रेकिंग, अनोखे ट्रेड पैटर्न के साथ उच्च गुणवत्ता का रबर कंपाउंड',
  'Enjoy leaning and riding in all-weather conditions': 'हर मौसम में झुककर चलाने और सवारी का मज़ा लें',
  'Excellent vehicle control at high speeds Outstanding stability Stabilizer grooves in shoulder rib':
    'तेज़ रफ़्तार में गाड़ी पर शानदार नियंत्रण, बेहतरीन स्थिरता, शोल्डर रिब में स्थिरता देने वाले खांचे',
  'Excellent vehicle control on dry and wet road Silica based tread material Superior Dry and Wet grip':
    'सूखी और गीली सड़क पर गाड़ी पर शानदार नियंत्रण, सिलिका आधारित ट्रेड सामग्री, सूखी और गीली सड़क पर बेहतरीन ग्रिप',
  'Excellent vehicle stability during highway driving Precise steering control during lane change Tread pattern with larger outer shoulder':
    'हाईवे पर चलते समय गाड़ी की शानदार स्थिरता, लेन बदलते समय सटीक स्टीयरिंग, बड़े बाहरी शोल्डर वाला ट्रेड पैटर्न',
  'Extended triangular shoulder blocks Better grip during cornering Enhanced grip and stability':
    'बढ़े हुए त्रिकोणीय शोल्डर ब्लॉक, मोड़ पर बेहतर ग्रिप, ज़्यादा ग्रिप और स्थिरता',
  'Feature led tyre with Extended Shoulders ‘W’ grooves for hydroplaning and Life Indicator Stone Ejectors':
    "खूबियों से भरा टायर, बढ़े हुए शोल्डर, पानी पर फिसलने से बचाने वाले 'W' खांचे, लाइफ इंडिकेटर और पत्थर बाहर फेंकने वाले इजेक्टर",
  'Great Handling and Braking Block Based Design for maximum road grip Connected shoulder blocks for great cornering':
    'शानदार हैंडलिंग और ब्रेकिंग, सड़क पर अधिकतम पकड़ के लिए ब्लॉक आधारित डिज़ाइन, बढ़िया मोड़ के लिए जुड़े हुए शोल्डर ब्लॉक',
  'HIGHER MILEAGE, MAXIMUM GRIP AND ENHANCED SAFETY Pentagonal wider blocks at the centre and angular blocks at the shoulder':
    'ज़्यादा माइलेज, अधिकतम ग्रिप और बेहतर सुरक्षा, बीच में चौड़े पंचकोणीय ब्लॉक और शोल्डर पर कोणीय ब्लॉक',
  'HIGHER MILEAGE, MAXIMUM GRIP Unique turtle shell shape tread pattern design':
    'ज़्यादा माइलेज, अधिकतम ग्रिप, कछुए के खोल जैसा अनोखा ट्रेड पैटर्न डिज़ाइन',
  'HIGHER STRUCTURAL DURABILITY Stress free casing structure with extra protection at bead area':
    'ज़्यादा ढांचागत मज़बूती, बीड वाले हिस्से में अतिरिक्त सुरक्षा के साथ तनाव-मुक्त केसिंग',
  'HIGHER TREAD MASS AT WEARING CENTRE ZONE Wider Pentagonal Centre Block Design':
    'घिसने वाले बीच के हिस्से में ज़्यादा ट्रेड, चौड़ा पंचकोणीय बीच का ब्लॉक डिज़ाइन',
  'Hassle-Free long life Robust Design Wider contour Profile for high load carrying capaciy and structural capability':
    'बिना झंझट लंबी उम्र, मज़बूत डिज़ाइन, ज़्यादा वज़न उठाने की क्षमता और ढांचागत मज़बूती के लिए चौड़ी कंटूर प्रोफ़ाइल',
  'High Precision Control with Aqua Planing Herringbone Grooves with a wider tread for quick steering response Excellent Stability during both on and off road usage':
    'एक्वाप्लानिंग के साथ बेहद सटीक नियंत्रण, तेज़ स्टीयरिंग जवाब के लिए चौड़े ट्रेड वाले हेरिंगबोन खांचे, सड़क और कच्चे रास्ते दोनों पर शानदार स्थिरता',
  'Highest Performance standards with Steel Radial technology':
    'स्टील रेडियल तकनीक के साथ सर्वोच्च प्रदर्शन मानक',
  'Highly comfortable even on rough roads Best-in-class road shock absorption without loss of geometric stability Specially designed tyre contour & construction':
    'ऊबड़-खाबड़ सड़कों पर भी बेहद आरामदायक, ज्यामितीय स्थिरता खोए बिना सड़क के झटकों का बेहतरीन अवशोषण, खास तौर पर बनाया गया टायर कंटूर और बनावट',
  'IMPROVED CORNERING STABILITY AND PRECISE STEERING CONTROL ON WET AND DRY ROAD CONDITION Cut sipes at Shoulder Efficient water evacuation':
    'गीली और सूखी सड़क पर मोड़ में बेहतर स्थिरता और सटीक स्टीयरिंग, शोल्डर पर कटे साइप, पानी की अच्छी निकासी',
  'IMPROVED DIRECTIONAL STABILITY Continuous centre groove with oriented stress relieving sipes':
    'बेहतर दिशात्मक स्थिरता, लगातार बीच का खांचा और तनाव घटाने वाले दिशा में बने साइप',
  'IMPROVED RIDE AND HANDLING QUALITY Enhanced Stress free casing with elliptical cavity':
    'बेहतर सवारी और हैंडलिंग, अंडाकार गुहा वाला बेहतर तनाव-मुक्त केसिंग',
  'IMPROVED RIM SEATING EASY TIRE MOUNTING/ DEMOUNTING Reinforced casing structure with extra protection @ tread and bead area Higher structural durability':
    'रिम पर बेहतर बैठना, टायर चढ़ाना और उतारना आसान, ट्रेड और बीड वाले हिस्से में अतिरिक्त सुरक्षा के साथ मज़बूत केसिंग, ज़्यादा ढांचागत मज़बूती',
  'IMPROVES DIRECTIONAL STABILITY Continuous centre groove': 'दिशात्मक स्थिरता बेहतर, लगातार बीच का खांचा',
  'IMPROVES DIRECTIONAL STABILITY Safety curvy grooves opening towards shoulder':
    'दिशात्मक स्थिरता बेहतर, शोल्डर की ओर खुलते सुरक्षा वक्र खांचे',
  'LONG LASTING STRUCTURE AND UNIFORM TREAD WEAR Stress free casing with elliptical cavity':
    'लंबे समय तक चलने वाला ढांचा और एक समान ट्रेड घिसाव, अंडाकार गुहा वाला तनाव-मुक्त केसिंग',
  'Long life with very low cost per Km 100000+ kms. tyre life Ultra high wear resistant tread compound':
    'लंबी उम्र और प्रति किमी बहुत कम खर्च, 100000+ किमी टायर लाइफ, घिसाव से बेहद ज़्यादा बचाने वाला ट्रेड कंपाउंड',
  'Long usable life Impact resistance and structural durability on bad roads Robust cavity design':
    'लंबे समय तक इस्तेमाल, खराब सड़कों पर झटके सहने की ताकत और ढांचागत मज़बूती, मज़बूत गुहा डिज़ाइन',
  'Longer service life Enhanced wear life Wear resistant Tread compound':
    'ज़्यादा लंबी सर्विस लाइफ, बेहतर घिसाव जीवन, घिसाव से बचाने वाला ट्रेड कंपाउंड',
  'Longitudinal groove @ center and shoulder Self cleaning from mud and dirt and superior ride performance Enhanced safety':
    'बीच और शोल्डर पर लंबाई वाली ग्रूव, कीचड़ और मिट्टी से खुद साफ होती है, बेहतर सवारी प्रदर्शन और ज़्यादा सुरक्षा',
  'Low Noise Low tread pattern noise with trumpet groove design on shoulder for low noise':
    'कम शोर, शोल्डर पर ट्रम्पेट ग्रूव डिज़ाइन से ट्रेड पैटर्न का शोर कम',
  'Optimized grip on wet and off-road application Improved safety on wet road with optimum off-road Performance FEA (Finite Element Analysis) optimized tread groove and sipes':
    'गीली और ऑफ-रोड सड़कों पर बेहतर ग्रिप, गीली सड़क पर ज़्यादा सुरक्षा और अच्छा ऑफ-रोड प्रदर्शन, FEA (फाइनाइट एलिमेंट एनालिसिस) से बेहतर बनाई गई ट्रेड ग्रूव और साइप',
  'PRECISE STEERING CONTROL & HANDLING FOR HIGH SPEED PERFORMANCE Directional pattern with stress reliving at shoulder':
    'तेज़ रफ़्तार में सटीक स्टीयरिंग कंट्रोल और हैंडलिंग, शोल्डर पर तनाव कम करने वाला दिशा-निर्देशित पैटर्न',
  'PRECISE STEERING CONTROL FOR HIGH SPEED BIKING Directional pattern with aesthetically styled shoulder':
    'तेज़ बाइक चलाने के लिए सटीक स्टीयरिंग कंट्रोल, सुंदर शोल्डर के साथ दिशा-निर्देशित पैटर्न',
  'PROTECTION FROM EXTERNAL DAMAGE & REDUCED TREAD CUT AND PUNCTURE Discontinuous protective shoulder ribs':
    'बाहरी नुकसान से बचाव और ट्रेड कटने व पंक्चर का कम खतरा, अलग-अलग हिस्सों में बनी सुरक्षा देने वाली शोल्डर रिब',
  'PROVIDE PRECISE WET AND DRY STEERING CONTROL Continuous centre groove':
    'गीली और सूखी सड़क पर सटीक स्टीयरिंग कंट्रोल, लगातार चलती बीच की ग्रूव',
  'PROVIDE SUPERIOR GRIP ON DRY AND WET ROADS Directional tread pattern with anchored grooves':
    'सूखी और गीली सड़कों पर बेहतरीन ग्रिप, जुड़ी हुई ग्रूव वाला दिशा-निर्देशित ट्रेड पैटर्न',
  'PROVIDES EXCELLENT GRIP ON DRY AND WET ROADS Directional tread pattern with connected and anchored grooves':
    'सूखी और गीली सड़कों पर शानदार ग्रिप, आपस में जुड़ी ग्रूव वाला दिशा-निर्देशित ट्रेड पैटर्न',
  'PROVIDES PRECISION CONTROL ON ALL ROAD CONDITIONS Bridged curvy grooves opening towards the shoulder':
    'हर तरह की सड़क पर सटीक कंट्रोल, शोल्डर की ओर खुलती जुड़ी हुई घुमावदार ग्रूव',
  'PROVIDES UNIFORM TREAD WEAR AND EASY TIRE MOUNTING & DEMOUNTING Stress-free casing structure with extra protection at bead area':
    'ट्रेड का एक समान घिसाव और टायर चढ़ाना-उतारना आसान, बीड वाले हिस्से में अतिरिक्त सुरक्षा के साथ तनाव-मुक्त केसिंग बनावट',
  'Pentagonal Tri-Block Pattern with bigger block area Superior traction Superior on road performance and better dry and wet grip safety':
    'बड़े ब्लॉक वाला पेंटागोनल ट्राई-ब्लॉक पैटर्न, बेहतरीन ट्रैक्शन, सड़क पर बेहतर प्रदर्शन और सूखी-गीली सड़क पर ज़्यादा ग्रिप व सुरक्षा',
  'Precise steering control Enhanced steering response Stiffness optimized longitudinal rib with strong shoulder design':
    'सटीक स्टीयरिंग कंट्रोल, बेहतर स्टीयरिंग प्रतिक्रिया, मज़बूत शोल्डर डिज़ाइन के साथ कठोरता के हिसाब से बनी लंबी रिब',
  'Precise vehicle control during city driving High in steering precision Stiffer rib at centre and specially optimized contact patch':
    'शहर में गाड़ी चलाते समय सटीक कंट्रोल, स्टीयरिंग में ज़्यादा सटीकता, बीच में कठोर रिब और खास तौर पर बेहतर बनाया गया कॉन्टैक्ट पैच',
  'Premium compound with a smart blend os Silica and Carbn Black Extreme chemical grip on wet and dry surfaces. Optimum tread mileage.':
    'सिलिका और कार्बन ब्लैक के समझदारी भरे मेल वाला प्रीमियम कंपाउंड, गीली और सूखी सतह पर बेहतरीन केमिकल ग्रिप, ट्रेड की अच्छी माइलेज',
  'Quick steering response with improved vehicle control Fast and precise steering response Unique tread design with stiffer centre rib and stronger shoulder':
    'तेज़ स्टीयरिंग प्रतिक्रिया के साथ बेहतर गाड़ी कंट्रोल, तेज़ और सटीक स्टीयरिंग, कठोर बीच की रिब और मज़बूत शोल्डर वाला अनोखा ट्रेड डिज़ाइन',
  'REDUCED WEAR RATE & EXCELLENT TREAD MILEAGE New age polymer blend based tread compound':
    'कम घिसाव और ट्रेड की शानदार माइलेज, नई तकनीक के पॉलिमर मिश्रण पर बना ट्रेड कंपाउंड',
  'RESISTANT FROM EXTERNAL DAMAGE Unique Turtle shell pattern design(TSDP)':
    'बाहरी नुकसान से सुरक्षा, कछुए के खोल जैसा अनोखा पैटर्न डिज़ाइन (TSDP)',
  'Relief from tension of tyre puncture Excellent resistance to nail Penetration Micro puncture technology':
    'टायर पंक्चर की चिंता से राहत, कील चुभने से बेहतरीन बचाव, माइक्रो पंक्चर तकनीक',
  'SAFETY ON ALL TERRAIN CONDITION Variable groove shape Efficient water dispersal and improved dry traction':
    'हर तरह के रास्ते पर सुरक्षा, बदलती ग्रूव आकृति, पानी का असरदार निकास और सूखी सड़क पर बेहतर ट्रैक्शन',
  'SUNIFORM TREAD WEAR HIGHER TREAD MILEAGE Directional Tread pattern with Higher Land/Sea ratio Increased contact area for superior grip':
    'ट्रेड का एक समान घिसाव और ज़्यादा माइलेज, ज़्यादा लैंड/सी अनुपात वाला दिशा-निर्देशित ट्रेड पैटर्न, बेहतर ग्रिप के लिए ज़्यादा संपर्क क्षेत्र',
  'SUPERIOR MILEAGE AND PERFORMANCE CONSISTENCY New Tread Design with extended cross over grooves Improved wear regularity with better traction':
    'बेहतरीन माइलेज और लगातार एक जैसा प्रदर्शन, लंबी क्रॉस-ओवर ग्रूव वाला नया ट्रेड डिज़ाइन, बेहतर ट्रैक्शन के साथ घिसाव में एकरूपता',
  'SUPERIOR ON ROAD PERFORMANCE AND BETTER DRY AND WET GRIP SAFETY Pentagonal Tri-Block Pattern with bigger block area Superior traction':
    'सड़क पर बेहतरीन प्रदर्शन और सूखी-गीली सड़क पर ज़्यादा ग्रिप व सुरक्षा, बड़े ब्लॉक वाला पेंटागोनल ट्राई-ब्लॉक पैटर्न, बेहतरीन ट्रैक्शन',
  'SUPERIOR TRACTION IN THE ON-OFF MANOEUVRING Channelized independent centre and side blocks':
    'सड़क और ऑफ-रोड दोनों में मोड़ने-घुमाने पर बेहतरीन ट्रैक्शन, अलग-अलग बीच और किनारे के ब्लॉक जिनके बीच नालियां बनी हैं',
  'SUPERIOR TRACTION ON ALL TERRAIN SURFACES Grip enhanced paw shaped block pattern design':
    'हर तरह की सतह पर बेहतरीन ट्रैक्शन, पंजे के आकार के ब्लॉक पैटर्न से बढ़ी हुई ग्रिप',
  'SUPERIOR WET GRIP DURING CORNERING CContinuous centre groove':
    'मोड़ पर गीली सड़क पर बेहतरीन ग्रिप, लगातार चलती बीच की ग्रूव',
  'SUPREME STRUCTURAL DURABILITY Reinforced casing structure':
    'बेहतरीन बनावट की मज़बूती, मज़बूत की गई केसिंग बनावट',
  'SUPREME WATER CHANNELLING Unique aquatic block design tread':
    'पानी का बेहतरीन निकास, जल-आकृति ब्लॉक वाला अनोखा ट्रेड डिज़ाइन',
  'SUSTAINED GRIP DURING HIGH SPEED CORNERING Continuous Zig Zag groove with stress relieving sipes Improved water channeling':
    'तेज़ रफ़्तार में मोड़ पर टिकी रहने वाली ग्रिप, तनाव कम करने वाली साइप के साथ लगातार ज़िगज़ैग ग्रूव, पानी का बेहतर निकास',
  'Silent comfortable driving throughout the life Low on noise even after wear FEA (Finite Element Analysis) optimized multi pitch tread design':
    'पूरी उम्र शांत और आरामदायक सफ़र, घिसने के बाद भी कम शोर, FEA (फाइनाइट एलिमेंट एनालिसिस) से बेहतर बनाया गया मल्टी पिच ट्रेड डिज़ाइन',
  'Stress free casing structure with extra protection at bead area Higher structural durability Uniform tread wearEasy Tire mounting/demounting':
    'बीड वाले हिस्से में अतिरिक्त सुरक्षा के साथ तनाव-मुक्त केसिंग बनावट, ज़्यादा मज़बूती, ट्रेड का एक समान घिसाव, टायर चढ़ाना-उतारना आसान',
  'Stress free casing structure with extra protection at tread and bead area Higher structural durability Uniform tread wearEasy Tire mounting/demounting':
    'ट्रेड और बीड वाले हिस्से में अतिरिक्त सुरक्षा के साथ तनाव-मुक्त केसिंग बनावट, ज़्यादा मज़बूती, ट्रेड का एक समान घिसाव, टायर चढ़ाना-उतारना आसान',
  'Superb Ride Comfort Rounder contact patch for ride comfort Extended lateral grooves for minimum noise':
    'शानदार सवारी आराम, आराम के लिए ज़्यादा गोल कॉन्टैक्ट पैच, कम से कम शोर के लिए लंबी आड़ी ग्रूव',
  'Superb acoustic comfort Unique Tread pattern and pitch sequencing Lower tyre noise':
    'शानदार शांति और आराम, अनोखा ट्रेड पैटर्न और पिच क्रम, टायर का कम शोर',
  'Superb durability Excellent life time performance Robust tyre construction with wear, cut & chipping resistant tread':
    'शानदार मज़बूती, पूरी उम्र बेहतरीन प्रदर्शन, घिसाव, कटाव और टूट-फूट से बचाने वाले ट्रेड के साथ मज़बूत टायर बनावट',
  'Superior Street riding without losing essence of bad road behaviour':
    'शहर की सड़क पर बेहतरीन सवारी, बिना ख़राब सड़क पर चलने की खूबी खोए',
  'Superior safety during highspeed driving Tread pattern with Wider outer shoulder Outstanding steering response and vehicle control':
    'तेज़ रफ़्तार में गाड़ी चलाते समय बेहतरीन सुरक्षा, चौड़े बाहरी शोल्डर वाला ट्रेड पैटर्न, शानदार स्टीयरिंग प्रतिक्रिया और गाड़ी पर कंट्रोल',
  'Take on adventures with off-roading tread pattern': 'ऑफ-रोडिंग ट्रेड पैटर्न के साथ रोमांच का मज़ा लें',
  'Tri-Flex Compound:Unique blend that delivers superior grip, precision and high speed stability.':
    'ट्राई-फ्लेक्स कंपाउंड, अनोखा मिश्रण जो बेहतरीन ग्रिप, सटीकता और तेज़ रफ़्तार में स्थिरता देता है',
  'UNIFORM TREAD WEAR EASY TIRE MOUNTING/ DEMOUNTING Stress free casing structure with extra protection at bead area Higher structural durability':
    'ट्रेड का एक समान घिसाव, टायर चढ़ाना-उतारना आसान, बीड वाले हिस्से में अतिरिक्त सुरक्षा के साथ तनाव-मुक्त केसिंग बनावट, ज़्यादा मज़बूती',
  'UNIFORM TREAD WEAR Stress free casing structure Higher structural durability':
    'ट्रेड का एक समान घिसाव, तनाव-मुक्त केसिंग बनावट, ज़्यादा मज़बूती',
  'UNIQUE TURTLE SHELL SHAPE TREAD PATTERN DESIGN Unique turtle shell shape tread pattern design':
    'कछुए के खोल के आकार का अनोखा ट्रेड पैटर्न डिज़ाइन',
  'Unmatched Durability Re-inforced Construction Joint-less cap ply for better durability at high load and high speed':
    'बेमिसाल मज़बूती, मज़बूत की गई बनावट, ज़्यादा भार और तेज़ रफ़्तार में बेहतर टिकाऊपन के लिए बिना जोड़ वाली कैप प्लाई',
  'Versatility of riding comfort and great mileage': 'सवारी का आराम और शानदार माइलेज, दोनों एक साथ',
  'Zero Degree steel belt Arrests dynamic growth Excellent high-speed stability via minimal structural deformation.':
    'ज़ीरो डिग्री स्टील बेल्ट, चलते समय फैलाव को रोकती है, बनावट में कम से कम बदलाव से तेज़ रफ़्तार में शानदार स्थिरता',
  'dual Radii cavity profile. Quick to achieve lean angles. Outstanding sport handling':
    'दोहरी त्रिज्या वाली गहराई की बनावट, झुकाव जल्दी मिलता है, शानदार स्पोर्ट हैंडलिंग',
  'rib tread pattern with wider channel grooves': 'चौड़ी नालीदार ग्रूव वाला रिब ट्रेड पैटर्न',
  '‘V’ - Shaped tread block orientation with wider center block Maximum grip and More working edges for off-road traction in different conditions Improved mileage and Good traction Cut free smooth treads for long term durability':
    'चौड़े बीच वाले ब्लॉक के साथ V आकार में लगे ट्रेड ब्लॉक, अलग-अलग हालात में ऑफ-रोड ट्रैक्शन के लिए ज़्यादा से ज़्यादा ग्रिप और ज़्यादा काम करने वाले किनारे, बेहतर माइलेज और अच्छा ट्रैक्शन, लंबे समय की मज़बूती के लिए कटाव-रहित चिकने ट्रेड',
};
