export type BrandKey =
  | "tata" | "bharatbenz" | "ashok-leyland" | "eicher" | "mahindra"
  | "volvo" | "scania" | "man" | "mercedes-benz" | "isuzu"
  | "iveco" | "daf" | "renault"
  | "jcb" | "caterpillar" | "komatsu" | "hitachi" | "hyundai-ce"
  | "kobelco" | "liebherr";

export interface BrandFAQ {
  q: string;
  a: string;
}

export interface BrandInfo {
  key: BrandKey;
  name: string;
  slug: string;
  tagline: string;
  description: string;
  longDescription: string;
  highlights: string[];
  models: string[];
  categories: string[];
  color: string; // hex — accent stripe color in hero
  heroAccent: string; // tailwind class group (legacy, no longer used for bg)
  founded: string;
  origin: string;
  keywordTargets: string[];
  faq: BrandFAQ[];
  topPartNumbers?: string[];
  category: "truck" | "equipment";
  logoFile: string;
  // Optional rich-content fields (added in v2)
  whyMatters?: string; // 2-4 sentence paragraph on why operators choose this brand
  industries?: string[]; // industries this brand serves
  commonIssues?: { issue: string; fix: string }[]; // common service issues & our solution
  specs?: { label: string; value: string }[]; // technical headline specs
  seoBlurbs?: string[]; // 2-3 keyword-dense paragraphs for long-tail SEO
}

const exportRegions =
  "We export to UAE, Saudi Arabia, Oman, Qatar, Kuwait, Kenya, Tanzania, Uganda, Nigeria, Mozambique, South Africa, Sri Lanka, Bangladesh, Nepal, Russia, Kazakhstan, Mexico, Peru, Brazil and 60+ countries with consolidated container shipping from Mumbai (Nhava Sheva), Mundra and Chennai ports.";

export const BRANDS: Record<BrandKey, BrandInfo> = {
  tata: {
    key: "tata",
    name: "Tata Motors",
    slug: "tata",
    tagline: "India's largest commercial vehicle maker — global spare parts supply",
    description:
      "Genuine and OEM-equivalent spare parts for Tata Motors trucks, buses, tippers and trailers — Prima, Signa, LPT, LPK, LPS, LPO, SFC 407 and BS6 series.",
    longDescription:
      "Tata Motors is India's largest manufacturer of commercial vehicles and one of the world's top truck OEMs. Narmada Mobility stocks and exports a complete range of Tata genuine and OEM-equivalent spare parts — engine assemblies, dozer units, urea injectors and tanks (BS-IV / BS-VI), clutches, gearboxes, propeller shafts, differentials, suspension, electrical, cabin and chassis parts. " + exportRegions,
    highlights: [
      "Authorized source of Tata Genuine Parts",
      "Complete BS-IV and BS-VI Dozer & Urea range",
      "Tata Prima, Signa, LPT, LPK, LPS, LPO, SFC 407, Winger",
      "20+ years of Tata spare parts export experience",
    ],
    models: [
      "Tata 2523 Prima", "Tata 2528 Prima", "Tata 3123 Prima", "Tata 3128 Prima",
      "Tata 4923 Signa", "Tata Signa 5530", "Tata Signa 4825",
      "Tata LPT 709 EX", "Tata LPT 1109", "Tata LPT 1615 TC", "Tata LPT 2515",
      "Tata LPT 3118 Cowl", "Tata LPS 3518 Trailer", "Tata LPS 4928",
      "Tata LPK 1618", "Tata LPK 2516", "Tata LPK 2518", "Tata LPK 2523",
      "Tata LPO 1510 55-Seater Bus", "Tata LPO 1512", "Tata LPO 1618",
      "Tata SFC 407 Pick-Up", "Tata SFC 407 4x4",
      "Tata 1112 BSIII EX", "Tata 3718 Trailer", "Tata 4018 Trailer",
      "Tata Ace", "Tata Winger Ambulance", "Tata Ultra 1014", "Tata Yodha",
      "Tata 1109g Magic", "Tata 1518C", "Tata 1612",
    ],
    categories: ["Engine Parts", "Dozer & Urea (BS6)", "Clutch & Gearbox", "Brake System", "Suspension", "Electrical", "Cabin & Body", "Filters", "Fuel System", "Cooling System"],
    color: "#1e3a8a",
    heroAccent: "from-blue-900 to-blue-700",
    founded: "1945",
    origin: "Mumbai, India",
    category: "truck",
    logoFile: "tata.svg",
    keywordTargets: [
      "tata spare parts", "tata genuine parts", "tata prima spare parts",
      "tata signa parts", "tata bs6 dozer", "tata urea injector",
      "tata truck parts exporter india", "tata lpt parts", "tata lpk spare parts",
      "tata 2518 spare parts", "tata 3118 parts", "tata sfc 407 spare parts",
      "tata bus parts", "tata commercial vehicle parts", "tata genuine parts wholesale",
    ],
    faq: [
      { q: "Do you supply Tata Motors genuine spare parts?", a: "Yes. We supply Tata Genuine Parts (TGP) sourced directly from authorized Tata Motors channels, plus matched-quality OEM-equivalent parts from the same Tier-1 vendors that supply the Tata Motors assembly line." },
      { q: "What is the lead time for Tata truck parts to UAE, Africa or Russia?", a: "Standard lead time is 3-5 days for stock items dispatched from our Patna warehouse to Mumbai/Nhava Sheva port, plus 14-28 days ocean transit depending on destination. Air freight available for urgent orders (3-5 days door-to-door)." },
      { q: "Do you stock BS6 Dozer Urea injectors and tanks for Tata trucks?", a: "Yes. We maintain inventory of BS-VI SCR dosing modules, urea injectors, urea pumps and DEF tanks for Tata Signa, Prima and LPT BS6 series trucks." },
      { q: "Can I order Tata spare parts in bulk for my dealership?", a: "Absolutely. We service dealerships, fleet operators and aftermarket distributors with container-load orders. Volume pricing, consolidated invoicing and CIF/FOB shipping terms available." },
      { q: "How do I identify the right Tata spare part for my model?", a: "Send us your truck chassis number (VIN) on WhatsApp +91 79090 83806 along with a photo of the old part. Our team will identify the exact OE part number and quote within 24 hours." },
    ],
  
    whyMatters: "Tata Motors built more than 60% of India's truck fleet over the last two decades, making Tata genuine spare parts among the most asked-for SKUs at our Patna warehouse. From Tata 407 last-mile pickups to Tata Prima 4923 long-haul tractors, we hold ready stock for the chassis families fleet managers ask about every day.",
    industries: ["Logistics & long-haul", "Tipper & mining", "Bus & passenger transport", "Construction haulage", "Defence & utility"],
    commonIssues: [
      { issue: "BS-VI urea injector clog & dosing fault", fix: "OE-grade Bosch / Cummins urea injector + Tata dosing module — fitment confirmed against VIN, dispatched same-day." },
      { issue: "Prima clutch slip & judder under load", fix: "OEM 380mm Tata Prima clutch kit (cover + plate + release bearing) sourced from Tata-approved Tier-1 vendor." },
      { issue: "LPK 2518 tipper rear suspension sag", fix: "Tata genuine 13-leaf parabolic spring assembly, U-bolts and shackle kit — packaged ready for container export." },
      { issue: "Signa 4923 propeller shaft vibration", fix: "Balanced Tata propeller shaft assembly with new universal joints, dispatched in protective crate." }
    ],
    specs: [
      { label: "Engine families covered", value: "Cummins ISBe, ISLe; Tata 497 TCIC; Tata 697 NA" },
      { label: "Emission norms", value: "BS-III / BS-IV / BS-VI ready" },
      { label: "Gross vehicle weight", value: "1.6T (Ace) — 49T (LPS 4923)" },
      { label: "Aftermarket coverage", value: "OE Tata Genuine + Tier-1 OEM-matched" }
    ],
    seoBlurbs: [
      "Looking for Tata Prima 4023.S spare parts, Tata Signa 2818.K bogie suspension, Tata LPT 1109 clutch kit or Tata Ultra 1014 brake pads? Narmada Mobility is one of India's largest export-oriented Tata commercial vehicle spare parts suppliers, with a 50,000+ SKU Tata catalog covering the LPT, LPK, LPS, LPO, SFC, Prima, Signa, Ultra and Yodha chassis families plus the Tata Ace small commercial range.",
      "For fleets operating Tata trucks in UAE, Saudi Arabia, Kenya, Tanzania, Mozambique, Nigeria, Sri Lanka, Bangladesh or Nepal, we ship Tata genuine engine spares, Tata urea tank & injector assemblies, Tata gearbox repair kits, Tata propeller shafts, Tata differential crown-pinion sets, Tata brake liners, Tata clutch plates and Tata radiator assemblies in consolidated containers from Mumbai (Nhava Sheva), Mundra and Chennai ports under CIF, FOB and EXW INCOTERMS.",
      "All Tata genuine spare parts are sourced through authorized Tata Motors channels and accompanied by purchase invoices acceptable for warranty claims in your country. Send the chassis VIN or the existing Tata part number on WhatsApp +91 79090 83806 and our team confirms fitment within 48 hours."
    ],
  },
  bharatbenz: {
    key: "bharatbenz",
    name: "BharatBenz",
    slug: "bharatbenz",
    tagline: "Daimler India quality — premium truck spare parts worldwide",
    description:
      "Premium spare parts for BharatBenz heavy-duty trucks — 1217C, 1923C, 2523C, 2823R, 3523R and the complete BS6 range from Daimler India Commercial Vehicles.",
    longDescription:
      "BharatBenz is the Indian commercial vehicle brand from Daimler India (Mercedes-Benz Group). Narmada Mobility supplies a comprehensive inventory of BharatBenz spare parts — Mercedes OM-906/OM-924 engine internals, Wabco air brake components, Knorr-Bremse parts, ZF gearbox spares, propeller shafts, axle assemblies and cabin parts. " + exportRegions,
    highlights: [
      "Mercedes-Benz engine spares (OM-906, OM-924)",
      "Wabco / Knorr-Bremse braking components",
      "ZF transmission spares",
      "Genuine + OEM-equivalent grades available",
    ],
    models: [
      "BharatBenz 1217C BS6", "BharatBenz 1417R", "BharatBenz 1617R",
      "BharatBenz 1923C BS6", "BharatBenz 2523C BS6", "BharatBenz 2823C BS6",
      "BharatBenz 2823R BS6", "BharatBenz 3523R BS6", "BharatBenz 3523T BS6",
      "BharatBenz 4023T", "BharatBenz 4828TT", "BharatBenz 5028T",
      "BharatBenz 1015R Bus", "BharatBenz 1215RE Bus", "BharatBenz 1624R",
      "BharatBenz 3128CM Mixer", "BharatBenz 2823T Tipper", "BharatBenz 1917R",
    ],
    categories: ["Engine Parts (OM-906/924)", "Clutch", "Wabco Air Brakes", "ZF Transmission", "Axle & Differential", "Suspension", "Electrical & Sensors", "Cabin Parts", "Filters"],
    color: "#0f172a",
    heroAccent: "from-slate-900 to-slate-700",
    founded: "2012",
    origin: "Chennai, India",
    category: "truck",
    logoFile: "bharatbenz.svg",
    keywordTargets: [
      "bharatbenz spare parts", "bharat benz 2523 parts", "bharatbenz 1923c parts",
      "bharatbenz bs6 parts", "om906 engine parts india", "bharatbenz exporter",
      "bharatbenz 3523 parts", "bharatbenz wabco brake", "bharatbenz zf gearbox",
      "daimler india truck parts", "bharatbenz tipper parts",
    ],
    faq: [
      { q: "Do you supply BharatBenz OEM parts for OM906 and OM924 engines?", a: "Yes. We stock genuine and OEM-equivalent engine parts — cylinder liners, pistons, valves, gaskets, water pumps, turbochargers — for Mercedes OM-906 and OM-924 engines used in BharatBenz 1923, 2523, 3523 and 4023 trucks." },
      { q: "Can I get Wabco and ZF spares for my BharatBenz tipper?", a: "Yes. We are a registered aftermarket supplier of Wabco air brake systems and ZF transmission components for all BharatBenz models including the 2823T tipper, 3523T trailer and 4023T heavy haul series." },
      { q: "Do you ship BharatBenz parts to Mozambique and Tanzania?", a: "Yes. BharatBenz is heavily deployed across East Africa for mining and construction. We export consolidated container loads to Dar es Salaam, Mombasa, Beira and Maputo with full export documentation." },
      { q: "What is the warranty on BharatBenz spare parts?", a: "Genuine BharatBenz parts carry 12-month / 100,000 km manufacturer warranty. OEM-equivalent parts carry our 6-month replacement warranty." },
    ],
  
    whyMatters: "BharatBenz — Daimler India Commercial Vehicles' India-built range — brought Mercedes-Benz engineering to the Indian highway. Their 1217C, 1617R, 1917R, 2823, 3128, 3528, 4023 and 4928 trucks now dominate Indian long-haul logistics, and demand for genuine BharatBenz spare parts continues to grow across the Middle East and East Africa.",
    industries: ["Long-haul logistics", "Tanker & fuel transport", "Construction tippers", "Container haulage", "Heavy industrial transport"],
    commonIssues: [
      { issue: "OM 906 LA / OM 924 LA engine cylinder head leak", fix: "Genuine BharatBenz / Mercedes-Benz cylinder head gasket kit + head bolts, sourced via DICV channels." },
      { issue: "Mercedes G-series gearbox synchroniser wear", fix: "BharatBenz genuine synchro ring set + gear assembly, fitment confirmed against gearbox serial." },
      { issue: "BharatBenz 3128 / 4023 air dryer failure", fix: "Wabco / Knorr-Bremse OEM air dryer cartridge with desiccant — in ready stock." },
      { issue: "1617R clutch release bearing noise", fix: "BharatBenz genuine 395mm pull-type clutch assembly with release bearing kit." }
    ],
    specs: [
      { label: "Engine families", value: "OM 904 LA, OM 906 LA, OM 924 LA" },
      { label: "Gearbox", value: "Mercedes G-Series / ZF Ecosplit" },
      { label: "GVW range", value: "9T (914R) — 49T (4928 tractor)" },
      { label: "Emission compliance", value: "BS-IV / BS-VI ready, EURO IV equivalent" }
    ],
    seoBlurbs: [
      "Genuine BharatBenz spare parts for the 1617R, 1917R, 2523C, 2823C, 3128CM, 3528CM, 4023, 4923 and 4928 chassis are stocked in depth at our Patna warehouse. We supply BharatBenz engine spares, OM 906 LA cylinder heads, BharatBenz turbo assemblies, BharatBenz Mercedes G-series gearbox parts, BharatBenz Wabco brake parts and BharatBenz Knorr-Bremse air system components.",
      "Exporters and fleet operators across Bangladesh, Sri Lanka, Nepal, UAE, Saudi Arabia, Oman, Kenya and Tanzania rely on Narmada Mobility for hard-to-find BharatBenz parts — BharatBenz clutch kit 395mm, BharatBenz propeller shaft, BharatBenz axle differential, BharatBenz air-suspension parts and BharatBenz cabin spares with Mercedes-Benz-grade quality and DICV invoice trail."
    ],
  },
  "ashok-leyland": {
    key: "ashok-leyland",
    name: "Ashok Leyland",
    slug: "ashok-leyland",
    tagline: "Leyparts genuine spares — trusted globally since 1948",
    description:
      "Leyparts and OEM-equivalent spare parts for Ashok Leyland — Captain, Boss, U-Truck, Stag, Viking, Comet, 1612, 2518, 2523, 3118 IL and the iH range.",
    longDescription:
      "Ashok Leyland is India's second-largest commercial vehicle manufacturer and a global force in buses and trucks. Narmada Mobility carries a deep inventory of Leyparts genuine spares plus matched-quality alternatives across the entire Ashok Leyland lineup. " + exportRegions,
    highlights: [
      "Leyparts authorised supply chain",
      "iL / iTH / iEGR engine range coverage",
      "Stag, Viking, Captain, Boss complete parts",
      "Heavy export presence in Africa and Middle East",
    ],
    models: [
      "Ashok Leyland Captain 2518 -T HD", "Captain 2523 -T", "Captain 2523iT",
      "Captain 2518iT", "Captain 3123 -T",
      "U-2518 T", "U-2518 IL T HD", "U-2523", "U-3118il", "U-3118il TSRA",
      "Ashok Leyland 1612 BSII", "Ashok Leyland 1616il", "Ashok Leyland 1616il/1TSRA",
      "Ashok Leyland 2214 (Hino BSII 6ET)", "Ashok Leyland 2516 Tipper BS2",
      "Ashok Leyland 4026 Trailer", "Ashok Leyland 4928",
      "Ashok Leyland Boss 1115", "Ashok Leyland Boss 1415", "Ashok Leyland Boss LX",
      "Ashok Leyland Ecomet 1015", "Ashok Leyland Ecomet BSII",
      "Stag LYNX Bus", "Viking Bus", "Stag CNG Bus",
      "Ashok Leyland 516 Tractor BS2", "Ashok Leyland Dost +", "Ashok Leyland Bada Dost",
    ],
    categories: ["Engine Parts", "Leyparts Genuine", "Clutch (Setco/Valeo/LUK)", "Brake System (Wabco)", "Suspension", "Differential (Meritor)", "Electrical", "Cabin"],
    color: "#b91c1c",
    heroAccent: "from-red-800 to-red-600",
    founded: "1948",
    origin: "Chennai, India",
    category: "truck",
    logoFile: "ashokleyland.svg",
    keywordTargets: [
      "ashok leyland spare parts", "leyparts", "ashok leyland captain parts",
      "ashok leyland u truck parts", "ashok leyland 2518 parts",
      "ashok leyland parts africa", "ashok leyland boss parts",
      "ashok leyland 3118 parts", "ashok leyland viking bus parts",
      "leyparts supplier india", "ashok leyland exporter",
    ],
    faq: [
      { q: "Are you an authorized Leyparts dealer?", a: "We are a registered aftermarket distributor with direct sourcing from Leyparts and the Tier-1 vendor network supplying Ashok Leyland's plants in Chennai, Hosur and Pantnagar." },
      { q: "Do you supply Ashok Leyland parts for Kenya, Tanzania and Uganda?", a: "Yes. East Africa is one of our strongest export regions for Ashok Leyland Captain, U-Truck and Stag/Viking bus parts. Container loads ship every 2 weeks from Nhava Sheva." },
      { q: "Can I get Wabco brake parts for my Ashok Leyland 3118il?", a: "Yes. Full Wabco air brake range — compressors, valves, dryers, ABS modulators — for the U-3118il, Captain 3123 and all heavy-duty Ashok Leyland trucks." },
      { q: "Do you stock parts for the older 1612 and 2214 (Hino) models?", a: "Yes. We maintain dedicated inventory for legacy Ashok Leyland models including the Hino-engined 2214 6ET BSII series still operating in CIS countries and Africa." },
    ],
  
    whyMatters: "Ashok Leyland is the second-largest CV manufacturer in India and the bus-fleet workhorse for state transport corporations across South Asia and Africa. From the iconic Captain 2518 tipper to the Boss LX, Dost LiTE and U-truck range, Ashok Leyland spare parts are among the most-requested items at our export desk.",
    industries: ["State bus transport", "Mining tippers", "Defence vehicles", "Urban logistics", "Inter-city coaches"],
    commonIssues: [
      { issue: "H-series engine cylinder liner scoring", fix: "Ashok Leyland genuine H-series wet-liner kit with piston, rings, pin and circlips — matched set." },
      { issue: "Captain 2518 / 3118 leaf spring breakage in tipper duty", fix: "Heavy-duty 14-leaf Ashok Leyland parabolic spring assembly with anti-friction pads." },
      { issue: "Boss 1212 / Ecomet brake camshaft wear", fix: "Ashok Leyland genuine S-cam brake camshaft kit with bushes and rollers." },
      { issue: "Stallion / Mitr bus fuel injection pump fault", fix: "Bosch reconditioned-to-OE fuel injection pump with calibration certificate." }
    ],
    specs: [
      { label: "Engine families", value: "H-series, Neptune, iEGR, A-series CRS" },
      { label: "Bus platforms", value: "Viking, Cheetah, Stile, Falcon, Janbus" },
      { label: "Truck platforms", value: "Captain, Boss, Ecomet, U-truck, AVTR" },
      { label: "Emission norms", value: "BS-IV / BS-VI / Euro-IV" }
    ],
    seoBlurbs: [
      "Ashok Leyland spare parts for Captain 2518, Captain 3118, Boss 1212, Boss 1415, Boss 1615, Ecomet 1012, AVTR 2820, AVTR 3520 and the Viking, Cheetah and Janbus chassis families are available ex-stock at Narmada Mobility. We stock Ashok Leyland H-series engine spares, Ashok Leyland Neptune piston-liner kits, Ashok Leyland clutch assemblies, Ashok Leyland fuel injection pumps and Ashok Leyland gearbox spares for the AL-9S, AL-6S and ZF Ecomid families.",
      "We are one of India's preferred Ashok Leyland spare parts exporters — supplying Ashok Leyland Sri Lanka, Ashok Leyland Bangladesh, Ashok Leyland Nepal, Ashok Leyland UAE, Ashok Leyland Saudi Arabia and Ashok Leyland Africa markets with original Ashok Leyland genuine parts plus OEM-equivalent components from the same Tier-1 vendor base."
    ],
  },
  eicher: {
    key: "eicher",
    name: "Eicher Trucks & Buses",
    slug: "eicher",
    tagline: "VECV Pro series spares — light, medium and heavy duty",
    description:
      "Spare parts for Eicher Pro series — Pro 2049, 2059, 2075, 2095, 3015, 6019T, 6028, 8028XC, 8028XM and Eicher Skyline buses.",
    longDescription:
      "Eicher (VE Commercial Vehicles, a Volvo-Eicher joint venture) is the leader in Indian medium duty trucks and a fast-growing heavy-duty challenger. Narmada Mobility supplies Eicher OE and OEM-equivalent spare parts for the entire Pro 2000/3000/6000/8000 series including Volvo-derived heavy duty platforms — engine spares, fuel injection, Wabco brake parts, gearbox, cabin and electrical components. " + exportRegions,
    highlights: [
      "Pro 2000/3000/6000/8000 series complete coverage",
      "Volvo-derived heavy duty engine spares",
      "Eicher Skyline bus parts",
      "BS6 SCR & DEF system components",
    ],
    models: [
      "Eicher Pro 2049", "Eicher Pro 2059", "Eicher Pro 2075", "Eicher Pro 2095",
      "Eicher Pro 2110XPT", "Eicher Pro 3012", "Eicher Pro 3014", "Eicher Pro 3015",
      "Eicher Pro 3018", "Eicher Pro 6019T", "Eicher Pro 6028", "Eicher Pro 6035T",
      "Eicher Pro 8028XC", "Eicher Pro 8028XM", "Eicher Pro 8035T",
      "Eicher Pro 6048", "Eicher Pro 5016", "Eicher Pro 5025",
      "Eicher Skyline Pro 6016", "Eicher Skyline Pro 3008",
      "Eicher Terra 25", "Eicher Terra 35",
    ],
    categories: ["Engine Parts", "Fuel Injection", "Clutch", "Brake System", "Gearbox", "Cabin", "Electrical", "Filters", "BS6 SCR/DEF"],
    color: "#16a34a",
    heroAccent: "from-green-800 to-green-600",
    founded: "1948",
    origin: "Pithampur, India",
    category: "truck",
    logoFile: "eicher.svg",
    keywordTargets: [
      "eicher spare parts", "eicher pro 3015 parts", "eicher pro 6028 parts",
      "vecv spare parts", "eicher skyline parts", "eicher truck parts exporter",
      "eicher pro 2049 parts", "eicher pro 8028 parts", "eicher bs6 def",
      "eicher terra parts", "eicher diesel injector",
    ],
    faq: [
      { q: "Do you supply Eicher VEDX engine spares for Pro 6000/8000 series?", a: "Yes. We stock the complete VEDX engine spare parts range — pistons, liners, valves, turbocharger, EGR, SCR — for Pro 6019T, 6028, 6048, 8028XC and 8028XM heavy duty trucks." },
      { q: "Are Eicher Skyline bus parts available?", a: "Yes. Full inventory for Skyline Pro 6016 and 3008 buses — engine, gearbox, axle, cabin, A/C and electrical parts." },
      { q: "Do you ship Eicher parts to Nepal and Bangladesh?", a: "Yes. We have a robust land-border export pipeline through Raxaul (Nepal) and Petrapole (Bangladesh) for Eicher dealers and fleet operators." },
    ],
  
    whyMatters: "Eicher (VE Commercial Vehicles — a Volvo Group / Eicher Motors JV) leads India's light- and medium-duty truck segment with the Pro 2049, Pro 2055, Pro 2059 and Pro 6028 series. Eicher Skyline buses and Pro tippers are equally common across South Asia and East Africa, and Eicher spare parts move fast at our warehouse.",
    industries: ["Light & medium-duty logistics", "School & staff bus operations", "Urban tipper duty", "Cold-chain & refrigerated transport", "Last-mile delivery"],
    commonIssues: [
      { issue: "Pro 1049 / 1055 fuel injector misfire", fix: "Bosch CRDI injector with new copper washer kit — calibrated to VE-Power engine specs." },
      { issue: "Eicher Pro 6019 / 6025 turbocharger wastegate stuck", fix: "Genuine Eicher Holset HX35 turbo with new gasket and oil-feed pipe." },
      { issue: "Skyline Pro bus body mounting bracket cracks", fix: "Eicher genuine cabin / body bracket kit with corrosion-protected bolts." },
      { issue: "Pro 3015 clutch slip with heavy load", fix: "Eicher genuine 330mm push-type clutch kit + dual-mass flywheel inspection." }
    ],
    specs: [
      { label: "Engine families", value: "VEDX5 (5L) / VEDX8 (8L) Volvo-tech, E483, E494" },
      { label: "GVW range", value: "4.9T (Pro 2049) — 31T (Pro 8035X)" },
      { label: "Bus platforms", value: "Skyline Pro, Starline, Skyline Pro E (electric)" },
      { label: "Emission norms", value: "BS-VI OBD-II ready, Euro-IV/V matched" }
    ],
    seoBlurbs: [
      "Eicher spare parts for Pro 1049, Pro 1055, Pro 2049, Pro 2055, Pro 3015, Pro 6019, Pro 6028 and Pro 8035X are in ready stock at Narmada Mobility's Patna warehouse. Our Eicher catalog covers Eicher engine spares (VEDX5, VEDX8, E483, E494), Eicher Skyline Pro bus body panels, Eicher gearbox parts, Eicher cabin parts and Eicher Pro fuel system components.",
      "For Eicher Skyline Pro and Starline bus operators in India, Nepal, Bangladesh, Sri Lanka, Kenya and Uganda, we supply Eicher bus genuine spare parts with VECV invoice and warranty traceability — from Eicher bus electricals to Eicher bus radiator and Eicher bus suspension assemblies."
    ],
  },
  mahindra: {
    key: "mahindra",
    name: "Mahindra Trucks & Buses",
    slug: "mahindra",
    tagline: "Mahindra Blazo, Furio, Jayo & Treo — complete OE spare supply",
    description:
      "Spare parts for Mahindra commercial vehicles — Blazo X, Furio, Jayo, Loadking, Bolero Pickup, Supro and the new Treo electric range.",
    longDescription:
      "Mahindra Truck and Bus is part of the $19B Mahindra Group and operates one of India's most diversified commercial vehicle portfolios — from sub-1-tonne electric three-wheelers to 55-tonne mining tippers. Narmada Mobility supplies Mahindra genuine and OEM-equivalent spare parts across the Blazo X heavy-duty series, the medium-duty Furio range, the Jayo intermediate and the Loadking/Bolero light commercial lineup. " + exportRegions,
    highlights: [
      "Mahindra Blazo X mPower engine spares",
      "Furio & Jayo medium duty parts",
      "Bolero Pickup and Supro LCV parts",
      "FuelSmart technology compatible",
    ],
    models: [
      "Mahindra Blazo X 28", "Blazo X 35", "Blazo X 40", "Blazo X 49",
      "Mahindra Furio 7", "Furio 12", "Furio 14", "Furio 16", "Furio 17",
      "Mahindra Jayo", "Mahindra Loadking Optimo", "Loadking Maxx",
      "Mahindra Bolero Pickup", "Bolero Maxx", "Bolero Camper Gold",
      "Mahindra Supro Profit Truck", "Supro Mini Truck",
      "Mahindra Treo Zor", "Treo Yaari",
      "Mahindra Cruzio Bus", "Mahindra Tourister",
    ],
    categories: ["mPower Engine Parts", "Clutch & Pressure Plates", "Brake System", "Suspension", "Cabin & Body", "Electrical", "Filters", "Bolero LCV Parts"],
    color: "#dc2626",
    heroAccent: "from-red-700 to-orange-500",
    founded: "1945",
    origin: "Mumbai, India",
    category: "truck",
    logoFile: "mahindra.svg",
    keywordTargets: [
      "mahindra spare parts", "mahindra blazo parts", "mahindra furio parts",
      "mahindra truck parts", "mahindra bolero pickup parts",
      "mahindra mPower engine parts", "mahindra loadking parts",
      "mahindra commercial vehicle spares", "blazo x 49 parts",
    ],
    faq: [
      { q: "Do you stock mPower engine parts for Mahindra Blazo X?", a: "Yes. We supply mPower 7.2L engine internals — pistons, liners, valves, turbocharger, common rail injectors — for Blazo X 28, 35, 40 and 49 series." },
      { q: "Can I get genuine Bolero Pickup parts?", a: "Yes. Full genuine Mahindra parts inventory for Bolero Pickup, Bolero Maxx and Bolero Camper Gold including engine, transmission, suspension and body parts." },
    ],
  
    whyMatters: "Mahindra & Mahindra's commercial vehicle range — Blazo X, Furio, Jeeto, Supro, Bolero Pik-Up and the Mahindra Truck and Bus heavy range — is built for India's roughest terrain and is increasingly exported across Africa and South Asia. Mahindra spare parts demand has tripled at our export desk over the last five years.",
    industries: ["Last-mile & SCV logistics", "Agriculture & farm logistics", "Urban delivery", "Construction haulage", "Defence utility"],
    commonIssues: [
      { issue: "Blazo X mPOWER engine EGR valve fault", fix: "Mahindra genuine EGR valve + cooler assembly, dispatched with new gaskets." },
      { issue: "Bolero Pik-Up m2DICR injector dribble", fix: "Bosch CRDI injector reconditioned to OE, calibration report included." },
      { issue: "Furio gearbox synchroniser wear", fix: "Mahindra genuine synchro kit for the M-Tech 6-speed gearbox." },
      { issue: "Jeeto / Supro CNG fuel system parts shortage", fix: "Mahindra CNG regulator, solenoid, hose kit — in ready stock." }
    ],
    specs: [
      { label: "Engine families", value: "mPOWER 7.2L FuelSmart, m2DICR, m_Hawk" },
      { label: "GVW range", value: "0.7T (Jeeto) — 49T (Blazo X 49)" },
      { label: "Emission compliance", value: "BS-VI Stage-II OBD" },
      { label: "Fuel types", value: "Diesel, CNG, Electric (e-SCV)" }
    ],
    seoBlurbs: [
      "Mahindra commercial vehicle spare parts for Blazo X 28, Blazo X 35, Blazo X 49, Furio 7, Furio 11, Furio 17, Jeeto, Supro, Bolero Pik-Up and Bolero Maxi Truck are stocked in depth at Narmada Mobility. We supply Mahindra mPOWER engine spares, Mahindra Blazo gearbox parts, Mahindra Bolero Pik-Up suspension kits and Mahindra Jeeto CNG fuel system components for SCV operators worldwide."
    ],
  },
  volvo: {
    key: "volvo",
    name: "Volvo Trucks & Construction Equipment",
    slug: "volvo",
    tagline: "Volvo EC, EX, FH, FM truck & excavator spares for global fleets",
    description:
      "Genuine and OEM-equivalent Volvo spare parts — Volvo EC210, EC250, EX 210, EX 350, FH, FM trucks, A30/A40 dump trucks and Volvo Penta marine.",
    longDescription:
      "Volvo's commercial vehicles and construction equipment are the backbone of mining, infrastructure and long-haul transport worldwide. Narmada Mobility supplies a comprehensive range of Volvo spares — D-series engine internals, hydraulic pumps and motors for excavators, undercarriage components, turbochargers (24039046, 22409174), companion flanges (22238210), final drives, swing motors and Penta marine spares. " + exportRegions,
    highlights: [
      "Volvo CE excavator hydraulic & undercarriage",
      "Volvo Trucks FH/FM driveline spares",
      "Volvo Penta marine engine parts",
      "Turbochargers, injectors, EGR & SCR components",
    ],
    models: [
      "Volvo EC 210", "Volvo EC 210B", "Volvo EC 210D", "Volvo EC 220D",
      "Volvo EC 250D", "Volvo EC 290B", "Volvo EC 350D", "Volvo EC 380D",
      "Volvo EC 480D", "Volvo EC 750D",
      "Volvo EX 210", "Volvo EX 350",
      "Volvo FH 420", "Volvo FH 460", "Volvo FH 540", "Volvo FH 16",
      "Volvo FM 420", "Volvo FM 460", "Volvo FMX 440", "Volvo FMX 520",
      "Volvo A30G Dump Truck", "Volvo A40G Dump Truck", "Volvo A45G",
      "Volvo L120H Loader", "Volvo L220H Loader",
      "Volvo Penta D5", "Volvo Penta D7", "Volvo Penta D13",
      "Volvo B9R Bus", "Volvo B11R Bus", "Volvo 9400 Coach",
    ],
    categories: ["Engine (D-series)", "Hydraulic Pumps & Motors", "Undercarriage", "Final Drive & Swing Motor", "Turbocharger", "Electrical & Sensors", "Cabin", "Penta Marine"],
    color: "#1d4ed8",
    heroAccent: "from-blue-800 to-sky-600",
    founded: "1927",
    origin: "Gothenburg, Sweden",
    category: "truck",
    logoFile: "volvo.svg",
    keywordTargets: [
      "volvo spare parts", "volvo ec210 parts", "volvo ex210 parts",
      "volvo fh parts", "volvo excavator hydraulic pump", "volvo turbocharger 24039046",
      "volvo penta marine parts", "volvo construction equipment parts",
      "volvo ec250 parts", "volvo a40g parts", "volvo fmx parts",
    ],
    topPartNumbers: ["24039046 (Turbocharger)", "22409174 (Turbocharger)", "22238210 (Companion Flange)", "VOE14881209 (Final Drive)", "VOE14605905 (Hydraulic Pump)"],
    faq: [
      { q: "Do you supply Volvo excavator hydraulic pumps?", a: "Yes. We stock genuine and aftermarket main pumps (VOE14605905, VOE14617267), swing motors and final drives for Volvo EC210, EC250, EC290, EC350 and EC480 excavators." },
      { q: "Are Volvo Penta marine engine parts available?", a: "Yes. Full Volvo Penta D5, D7, D11 and D13 marine engine spares — pistons, liners, injectors, seawater pumps, heat exchangers, raw water impellers." },
      { q: "Do you ship Volvo parts to Russia and CIS countries?", a: "Yes. Russia, Kazakhstan and Uzbekistan are major Volvo CE markets we service with regular container shipments and dedicated logistics support." },
    ],
  
    whyMatters: "Volvo Trucks and Volvo Construction Equipment set the global benchmark for premium uptime. Whether you operate Volvo FH 16, Volvo FM 13, Volvo EC 210 or EC 480 excavators, Volvo L 120 wheel loaders or Volvo articulated dump trucks, downtime is expensive — which is why operators across the Middle East, Africa and South Asia source Volvo genuine spare parts from Narmada Mobility.",
    industries: ["Open-cast mining", "Quarrying & aggregates", "Highway haulage", "Marine & port logistics", "Heavy infrastructure"],
    commonIssues: [
      { issue: "EC 210B / EC 290B hydraulic main pump pressure loss", fix: "Volvo OEM Kawasaki K3V112 / K3V140 main pump rebuild with new piston shoes, swash plate and regulator." },
      { issue: "FH / FM truck VEB engine brake actuator fault", fix: "Volvo genuine VEB engine brake actuator with solenoid — fitment confirmed via VIDA." },
      { issue: "L 120 wheel loader transmission solenoid sticking", fix: "Volvo genuine ZF transmission solenoid kit with new wiring harness clips." },
      { issue: "EC 480D / EC 380 final drive oil contamination", fix: "Volvo final drive / travel reduction assembly — complete or seal kit, your choice." }
    ],
    specs: [
      { label: "Engine families", value: "D11K, D13K, D16K (truck); D6, D8, D13 (excavator)" },
      { label: "Truck platforms", value: "FH, FM, FMX, FE, FL" },
      { label: "Excavator range", value: "EC 140 — EC 750 / EC 950E" },
      { label: "Wheel loader range", value: "L 60 — L 350H" }
    ],
    seoBlurbs: [
      "Volvo spare parts for FH 460, FH 540, FM 11, FMX 440, EC 210 B, EC 220 D, EC 290 B, EC 380 D, EC 480 D, EC 750 D, A 30 G articulated dump trucks and L 120 / L 220 wheel loaders are stocked in depth at Narmada Mobility. We supply Volvo D13 engine spares, Volvo VEB engine brake parts, Volvo I-Shift transmission parts, Volvo Kawasaki K3V hydraulic pumps, Volvo travel motors, Volvo final drives and Volvo undercarriage components for the EC excavator family.",
      "Mining contractors and quarry operators in UAE, Saudi Arabia, Oman, Mozambique, South Africa, Tanzania, Zambia, Mongolia and Russia source Volvo construction equipment parts and Volvo truck spares from us — Volvo genuine, Volvo OEM-matched and reconditioned-to-OE major assemblies with full export documentation."
    ],
  },
  scania: {
    key: "scania",
    name: "Scania",
    slug: "scania",
    tagline: "Scania P, G, R, S series — premium European truck spares",
    description:
      "Genuine and OEM-equivalent spare parts for Scania trucks — P-series, G-series, R-series, S-series, mining tippers and city buses.",
    longDescription:
      "Scania AB (Sweden) is one of the world's leading premium truck and bus manufacturers, with operations in over 100 countries. Narmada Mobility stocks Scania DC09, DC13, DC16 engine spares, GRSO/GRS gearbox parts, Scania retarder components, ADR axle spares, cabin parts and complete electrical systems for P, G, R and S-series trucks. " + exportRegions,
    highlights: [
      "Scania DC09 / DC13 / DC16 engine spares",
      "Opticruise gearbox & retarder spares",
      "ADR rear axle components",
      "P, G, R, S series complete coverage",
    ],
    models: [
      "Scania P 250", "Scania P 280", "Scania P 320", "Scania P 360",
      "Scania G 410", "Scania G 450", "Scania G 460", "Scania G 500",
      "Scania R 410", "Scania R 450", "Scania R 460", "Scania R 500", "Scania R 540", "Scania R 580", "Scania R 620", "Scania R 730",
      "Scania S 500", "Scania S 540", "Scania S 580", "Scania S 660", "Scania S 770",
      "Scania P 410 8x4 Tipper", "Scania G 460 Mining",
      "Scania K 410 Bus", "Scania K 440 Bus", "Scania Touring Coach",
    ],
    categories: ["DC Engine Parts", "Opticruise Gearbox", "ADR Axle", "Retarder", "Cabin (CP, CG, CR, CS)", "Air Brake System", "Electrical", "Cooling"],
    color: "#0b3f7a",
    heroAccent: "from-blue-900 to-indigo-700",
    founded: "1891",
    origin: "Södertälje, Sweden",
    category: "truck",
    logoFile: "scania.svg",
    keywordTargets: [
      "scania spare parts", "scania r series parts", "scania p series parts",
      "scania g series parts", "scania s series parts", "scania dc13 engine parts",
      "scania opticruise gearbox", "scania mining truck parts", "scania exporter india",
      "scania retarder spares",
    ],
    faq: [
      { q: "Do you supply Scania DC13 engine parts?", a: "Yes. We stock pistons, liners, valves, turbochargers, injectors and complete cylinder head assemblies for Scania DC13 engines used in R 450, R 500, R 540 and G 460 series trucks." },
      { q: "Are Scania Opticruise gearbox spares available?", a: "Yes. Full Opticruise GRSO 905/925/935 gearbox spare parts including shift forks, synchronizers, bearings and electronic control units." },
      { q: "Do you export Scania parts to mining operations in Africa?", a: "Yes. We supply Scania mining tipper spares to operations in Zambia, DRC, South Africa, Mozambique and Tanzania including the G 460 and P 410 8x4 mining configurations." },
    ],
  
    whyMatters: "Scania's R-series, S-series and P-series tractor trucks plus the Scania K-series and F-series buses are the gold standard for premium European long-haul. Scania's modular product system means parts overlap across families — we hold ready stock for the most-asked Scania genuine spare parts across the GCC and Africa.",
    industries: ["Premium long-haul", "Inter-city luxury coach", "Mining & off-highway", "Tanker transport", "Marine & port"],
    commonIssues: [
      { issue: "DC13 / DC16 engine XPI injector failure", fix: "Scania genuine XPI injector with sealing washer kit — calibration data on request." },
      { issue: "Scania Opticruise gearbox actuator slow shift", fix: "Scania genuine GRS / GRSO gearbox actuator block, sourced via Scania channels." },
      { issue: "R 500 / S 500 retarder oil contamination", fix: "Scania retarder rebuild kit with new clutch packs and oil-filter element." },
      { issue: "K 410 / F 230 bus air-suspension levelling valve fault", fix: "Wabco / Knorr-Bremse OE air-suspension levelling valve." }
    ],
    specs: [
      { label: "Engine families", value: "DC09, DC13, DC16 — SCR + EGR options" },
      { label: "Gearbox", value: "Opticruise GRS / GRSO 8-12 speed" },
      { label: "Truck platforms", value: "P-series, G-series, R-series, S-series, XT" },
      { label: "Bus platforms", value: "K-series chassis, F-series, OmniLink, Touring" }
    ],
    seoBlurbs: [
      "Scania spare parts for R 410, R 460, R 500, R 540, S 500, S 540, S 580, G 410, P 250, P 320, K 410 bus chassis and F 230 buses are sourced through Narmada Mobility's authorized Scania spare parts network. We supply Scania DC13 engine spares, Scania XPI fuel injectors, Scania Opticruise gearbox parts, Scania retarder rebuild kits, Scania cabin parts and Scania SCR / AdBlue system components."
    ],
  },
  man: {
    key: "man",
    name: "MAN Truck & Bus",
    slug: "man",
    tagline: "MAN TGS, TGX, TGM — German engineering, global spare supply",
    description:
      "MAN truck spare parts — TGS, TGX, TGM, TGL series, MAN D2066 / D2676 engines, MAN bus chassis and city bus components.",
    longDescription:
      "MAN Truck & Bus (Germany), part of the TRATON Group, is a leading European heavy commercial vehicle manufacturer. Narmada Mobility supplies MAN D-series engine spares (D0834, D0836, D2066, D2676), MAN ZF gearbox parts, propeller shafts, axle components and cabin parts for TGS, TGX, TGM and TGL series tractors and tippers operating in mining, long-haul and city distribution. " + exportRegions,
    highlights: [
      "MAN D2066 / D2676 common-rail engine spares",
      "ZF TipMatic & AS Tronic gearbox parts",
      "TGS, TGX, TGM, TGL complete coverage",
      "MAN bus chassis spares (Lion's Coach, Lion's City)",
    ],
    models: [
      "MAN TGS 18.360", "MAN TGS 26.420", "MAN TGS 33.420", "MAN TGS 40.420",
      "MAN TGX 18.440", "MAN TGX 26.440", "MAN TGX 26.480", "MAN TGX 33.510",
      "MAN TGM 18.290", "MAN TGM 26.340",
      "MAN TGL 7.180", "MAN TGL 12.220",
      "MAN CLA 25.220", "MAN CLA 16.220",
      "MAN Lion's Coach", "MAN Lion's City",
    ],
    categories: ["D-Engine Parts", "ZF Gearbox", "MAN Axle", "Brake System", "Cabin", "Electrical", "Filters", "Cooling"],
    color: "#1f2937",
    heroAccent: "from-gray-800 to-blue-900",
    founded: "1758",
    origin: "Munich, Germany",
    category: "truck",
    logoFile: "man.svg",
    keywordTargets: [
      "man truck spare parts", "man tgs parts", "man tgx parts",
      "man d2066 engine parts", "man d2676 parts", "man cla parts india",
      "man bus parts", "man truck exporter",
    ],
    faq: [
      { q: "Do you supply MAN D2066 and D2676 engine parts?", a: "Yes. Complete inventory for MAN D2066 and D2676 common-rail diesel engines — pistons, liners, valves, injectors, EGR coolers, water pumps and turbochargers." },
      { q: "Are MAN CLA (India-built) parts available?", a: "Yes. MAN CLA 16.220 and 25.220 were manufactured in India for emerging markets — we have dedicated stock for these models still operating across Africa and the Middle East." },
    ],
  
    whyMatters: "MAN Truck & Bus (part of the TRATON Group) is one of Europe's most respected heavy commercial vehicle OEMs. The MAN TGX, TGS, TGM and TGL platforms together with MAN Lion's Coach and Lion's City buses are operated across the GCC, CIS and Africa — and MAN genuine spare parts move briskly through our export desk.",
    industries: ["Heavy haulage & long-haul", "Inter-city coaches", "Tanker & ADR transport", "Construction & tippers", "Defence logistics"],
    commonIssues: [
      { issue: "D2066 / D2676 common-rail injector failure", fix: "MAN genuine common-rail injector with new copper washer — calibration data on request." },
      { issue: "TGX TipMatic gearbox shifting jolt", fix: "MAN genuine ZF TipMatic clutch actuator + ECU update via authorized network." },
      { issue: "TGS / TGM EGR valve clogging", fix: "MAN genuine EGR valve with new gaskets and clamps — ready stock." },
      { issue: "Lion's Coach air-conditioning compressor seize", fix: "MAN OE bus AC compressor with new clutch + receiver-drier kit." }
    ],
    specs: [
      { label: "Engine families", value: "D0834, D0836, D2066, D2676 — Euro-V / Euro-VI" },
      { label: "Gearbox", value: "ZF TipMatic / MAN TipMatic 12-speed" },
      { label: "Truck platforms", value: "TGL, TGM, TGS, TGX" },
      { label: "Bus platforms", value: "Lion's Coach, Lion's City, Lion's Intercity" }
    ],
    seoBlurbs: [
      "Genuine MAN truck spare parts for TGX 18.460, TGX 18.510, TGX 26.480, TGS 33.420, TGS 41.400, TGM 18.290 and TGL 12.220 are stocked at Narmada Mobility. We supply MAN D2066 / D2676 engine spares, MAN ZF TipMatic gearbox parts, MAN axle differential assemblies, MAN cabin parts and MAN AdBlue / SCR system components with full European OEM traceability.",
      "MAN spare parts buyers in UAE, Saudi Arabia, Oman, Kazakhstan, Uzbekistan, Russia, Kenya, Tanzania and Nigeria source MAN parts from Narmada Mobility — MAN turbo assemblies, MAN clutch kit 430mm, MAN propeller shaft, MAN brake pad set, MAN EBS module and MAN Wabco air system components with consolidated container export from Mumbai and Mundra."
    ],
  },
  "mercedes-benz": {
    key: "mercedes-benz",
    name: "Mercedes-Benz Trucks",
    slug: "mercedes-benz",
    tagline: "Mercedes Actros, Arocs, Atego — premium European truck spares",
    description:
      "Mercedes-Benz commercial vehicle spare parts — Actros, Arocs, Atego, Axor and Unimog. OM-471, OM-470, OM-936 engines, PowerShift gearbox.",
    longDescription:
      "Mercedes-Benz Trucks (Daimler Truck AG) is the flagship European commercial vehicle brand. Narmada Mobility supplies Mercedes Actros and Arocs spare parts — OM-470/OM-471 BlueTec 6 engine internals, PowerShift 3 gearbox components, Mercedes ZF axles, EBS modulators, Hi-Tech cab parts and complete electrical systems for long-haul, construction and mining operations. " + exportRegions,
    highlights: [
      "OM-470, OM-471, OM-936 engine spares",
      "PowerShift 3 & PowerShift Advanced gearbox",
      "Actros MP4 / MP5 cab parts",
      "Mercedes Unimog spare parts",
    ],
    models: [
      "Mercedes Actros 1840", "Actros 1845", "Actros 1848", "Actros 1851",
      "Actros 2545", "Actros 2548", "Actros 2551", "Actros 2553",
      "Actros 3340 6x4", "Actros 3343 6x4", "Actros 4143 8x4",
      "Mercedes Arocs 3340", "Arocs 3343", "Arocs 4143", "Arocs 4148",
      "Mercedes Atego 1218", "Atego 1224", "Atego 1530",
      "Mercedes Axor 1840", "Axor 2640",
      "Mercedes Unimog U400", "Unimog U500", "Unimog U5023",
    ],
    categories: ["OM-Engine Parts", "PowerShift Gearbox", "ZF / Mercedes Axle", "EBS Brake System", "Actros Cab Parts", "Electrical", "Telligent", "Cooling"],
    color: "#0f172a",
    heroAccent: "from-slate-900 to-zinc-700",
    founded: "1926",
    origin: "Stuttgart, Germany",
    category: "truck",
    logoFile: "mercedes.svg",
    keywordTargets: [
      "mercedes benz truck parts", "mercedes actros parts", "mercedes arocs parts",
      "om471 engine parts", "om470 spare parts", "mercedes atego parts",
      "mercedes unimog parts", "mercedes truck parts exporter",
      "actros mp4 parts", "powershift gearbox spares",
    ],
    faq: [
      { q: "Do you supply Mercedes OM-471 engine parts?", a: "Yes. We stock the complete OM-471 BlueTec 6 engine spare parts range used in Actros MP4 and MP5 — pistons, liners, cylinder heads, injectors, common rail components and turbochargers." },
      { q: "Are Mercedes Unimog parts available?", a: "Yes. Genuine and OEM-equivalent parts for Unimog U400, U500 and U5023 — engine, transmission, portal axles, suspension and hydraulic components." },
    ],
  
    whyMatters: "Mercedes-Benz Actros, Arocs, Atego and Axor trucks plus the Mercedes-Benz Tourismo and Sprinter range are operated across long-haul, construction and luxury coach segments worldwide. Genuine Mercedes-Benz spare parts demand a Daimler-traceable supply chain — which is exactly what Narmada Mobility provides.",
    industries: ["Premium long-haul", "Construction & off-road", "Luxury coach", "Light commercial / van", "Defence vehicles"],
    commonIssues: [
      { issue: "Actros OM 471 / OM 473 engine cylinder head warp", fix: "Mercedes-Benz genuine cylinder head with valve seat machining + new head bolts and gasket." },
      { issue: "PowerShift 3 transmission actuator slow", fix: "Mercedes-Benz genuine PowerShift actuator with ECU configuration data." },
      { issue: "Atego AdBlue dosing pump fault", fix: "Bosch / Daimler genuine AdBlue dosing module + tank heater element." },
      { issue: "Tourismo coach air-suspension bellow burst", fix: "Continental / Contitech OE air-suspension bellow with mounting hardware." }
    ],
    specs: [
      { label: "Engine families", value: "OM 470, OM 471, OM 473, OM 936, OM 651" },
      { label: "Truck platforms", value: "Actros, Arocs, Atego, Axor" },
      { label: "Coach platforms", value: "Tourismo, Travego, Citaro, Intouro" },
      { label: "Emission norms", value: "Euro-V / Euro-VI Step E" }
    ],
    seoBlurbs: [
      "Mercedes-Benz genuine spare parts for Actros 1845, Actros 2545, Actros 2858, Arocs 4145, Arocs 3340, Atego 1318, Atego 1623, Axor 2533 and the Tourismo / Travego coach range are sourced through Narmada Mobility's Mercedes-Benz commercial vehicle export network. We supply Mercedes OM 471 engine spares, Mercedes PowerShift 3 gearbox parts, Mercedes Telligent EBS modules, Mercedes axle differential and Mercedes coach interior components."
    ],
  },
  isuzu: {
    key: "isuzu",
    name: "Isuzu Motors",
    slug: "isuzu",
    tagline: "Isuzu N-series, F-series & Giga — Japanese reliability worldwide",
    description:
      "Isuzu commercial vehicle spare parts — N-series, F-series, Giga, D-Max pickups and Isuzu industrial diesel engines.",
    longDescription:
      "Isuzu Motors (Japan) is the world's largest manufacturer of medium and heavy duty trucks and the leading independent diesel engine producer. Narmada Mobility supplies Isuzu 4HK1, 6HK1, 6WG1 engine spares, MZW/MJX/MLD gearbox parts, complete N-series (NPR, NQR, NPS) and F-series (FRR, FSR, FVR) parts inventory, plus Isuzu Giga heavy-duty truck components. " + exportRegions,
    highlights: [
      "Isuzu 4HK1 / 6HK1 / 6WG1 engine spares",
      "N-series & F-series complete inventory",
      "Isuzu Giga heavy-duty parts",
      "D-Max pickup spare parts",
    ],
    models: [
      "Isuzu NPR 75", "Isuzu NPR 81", "Isuzu NPS 75", "Isuzu NQR 75",
      "Isuzu FRR 90", "Isuzu FSR 90", "Isuzu FVR 90", "Isuzu FVZ 34",
      "Isuzu Giga CYZ", "Isuzu Giga CYH", "Isuzu Giga CXZ",
      "Isuzu D-Max V-Cross", "Isuzu D-Max Hi-Lander",
      "Isuzu MU-X",
    ],
    categories: ["4HK1 Engine", "6HK1 Engine", "6WG1 Engine", "Gearbox (MZW/MJX)", "Clutch", "Brake System", "Suspension", "Cabin"],
    color: "#b91c1c",
    heroAccent: "from-red-800 to-rose-600",
    founded: "1916",
    origin: "Tokyo, Japan",
    category: "truck",
    logoFile: "isuzu.svg",
    keywordTargets: [
      "isuzu spare parts", "isuzu npr parts", "isuzu giga parts",
      "isuzu 4hk1 engine parts", "isuzu 6hk1 parts", "isuzu d-max parts",
      "isuzu f series parts", "isuzu n series parts",
    ],
    faq: [
      { q: "Do you supply Isuzu 4HK1 and 6HK1 engine parts?", a: "Yes. Complete engine spare parts inventory for Isuzu 4HK1 (used in NPR, NQR, FRR, FSR) and 6HK1 (used in FVR, FVZ, Giga CYZ/CYH) engines — pistons, liners, head gaskets, valves, injectors, turbochargers." },
      { q: "Are parts for Isuzu Giga CYZ/CYH heavy trucks available?", a: "Yes. Full Isuzu Giga inventory including 6WG1 engine spares, MJX/MLD gearbox parts and complete chassis components." },
    ],
  
    whyMatters: "Isuzu Motors is Japan's largest diesel commercial vehicle maker and a global benchmark for fuel-efficient light- and medium-duty trucks. The Isuzu N-series (NPR, NQR, NLR, NMR) and F-series (FRR, FSR, FTR, FVR, FVZ) plus the D-Max pickup are operated in every export market we serve.",
    industries: ["Last-mile & urban delivery", "Cold-chain transport", "Construction tippers", "Light fire & rescue", "Agriculture & utility pickup"],
    commonIssues: [
      { issue: "NPR 4HK1 / FVR 6HK1 fuel injector dribble", fix: "Bosch / Denso CRDI injector recon to Isuzu OE specs, calibration report included." },
      { issue: "NQR Isuzu MUS clutch slip", fix: "Isuzu genuine 325mm clutch kit (cover + plate + bearing + pilot bearing)." },
      { issue: "FTR / FVR turbo charger oil seal leak", fix: "Isuzu OE Garrett / IHI turbo assembly with feed/return pipe kit." },
      { issue: "D-Max RZ4E injector dribble", fix: "Isuzu Denso RZ4E injector recon, calibration data on request." }
    ],
    specs: [
      { label: "Engine families", value: "4HK1, 6HK1, 4JJ1, 4JK1, RZ4E" },
      { label: "Truck platforms", value: "N-Series, F-Series, GIGA, CYZ" },
      { label: "GVW range", value: "3.5T (NLR) — 32T (GIGA CYZ)" },
      { label: "Pickup", value: "D-Max, D-Max V-Cross" }
    ],
    seoBlurbs: [
      "Isuzu spare parts for NPR 75H, NQR 90L, NMR 85H, FRR 90N, FSR 110L, FTR 116L, FVR 119L, FVZ 150L and FVZ 1400 6x4 plus the D-Max range are stocked at Narmada Mobility. We supply Isuzu 4HK1 engine spares, Isuzu 6HK1 turbo assemblies, Isuzu MUS gearbox parts, Isuzu axle parts and Isuzu cabin assemblies with full Japanese-OEM traceability."
    ],
  },
  iveco: {
    key: "iveco",
    name: "Iveco",
    slug: "iveco",
    tagline: "Iveco Daily, Eurocargo, Stralis & S-Way — Italian commercial vehicle spares",
    description:
      "Iveco spare parts — Daily van, Eurocargo medium-duty, Stralis & S-Way heavy-duty, Trakker construction trucks and Iveco Cursor engines.",
    longDescription:
      "Iveco (Italy), part of the Iveco Group, is a major European commercial vehicle manufacturer. Narmada Mobility supplies Iveco Cursor 9, Cursor 11, Cursor 13 engine spares, ZF gearbox parts, Iveco Eurotronic transmission components and complete spare parts inventory for Daily LCV, Eurocargo, Stralis HI-WAY, S-Way and Trakker construction trucks. " + exportRegions,
    highlights: [
      "Iveco Cursor 9/11/13 engine spares",
      "Daily, Eurocargo, Stralis, S-Way coverage",
      "Trakker construction truck parts",
      "Iveco Bus & Astra HD parts",
    ],
    models: [
      "Iveco Daily 35", "Daily 50C", "Daily 70C",
      "Iveco Eurocargo 75E", "Eurocargo 120E", "Eurocargo 160E", "Eurocargo 180E",
      "Iveco Stralis AS440", "Stralis HI-WAY", "Stralis AS260S46",
      "Iveco S-Way AS440S46", "S-Way AS300S46",
      "Iveco Trakker AD380T44", "Trakker AT720T48",
      "Iveco Astra HD9 64.50", "Astra HD9 84.50",
    ],
    categories: ["Cursor Engine", "Tector Engine", "ZF Gearbox", "Iveco Axle", "Brake System", "Cabin", "Electrical", "Filters"],
    color: "#1e40af",
    heroAccent: "from-blue-800 to-blue-600",
    founded: "1975",
    origin: "Turin, Italy",
    category: "truck",
    logoFile: "iveco.svg",
    keywordTargets: [
      "iveco spare parts", "iveco daily parts", "iveco stralis parts",
      "iveco eurocargo parts", "iveco s-way parts", "iveco cursor 13 engine",
      "iveco trakker parts", "iveco bus parts",
    ],
    faq: [
      { q: "Do you supply Iveco Cursor engine parts?", a: "Yes. Full Cursor 9, Cursor 11 and Cursor 13 engine spare parts — pistons, liners, valves, common rail injectors, turbochargers, EGR coolers and water pumps." },
      { q: "Are Iveco Trakker construction truck parts available?", a: "Yes. Trakker AD380T44 and AT720T48 are widely used in African mining — we stock all major spares including drive axles, suspension and cab parts." },
    ],
  
    whyMatters: "Iveco's S-Way, T-Way, X-Way and Stralis truck range plus the Iveco Daily light commercial vehicle are operated across European and African logistics fleets. We are one of the few Indian exporters carrying genuine Iveco spare parts in ready stock for buyers across MENA, CIS and West Africa.",
    industries: ["Long-haul logistics", "Construction tippers", "Last-mile / Daily van", "Defence & utility", "Tanker transport"],
    commonIssues: [
      { issue: "Cursor 9 / Cursor 13 engine injector failure", fix: "FPT / Bosch CRDI Cursor injector recon to OE specs." },
      { issue: "EuroTronic / Hi-Tronix gearbox slow shift", fix: "ZF Hi-Tronix gearbox actuator + clutch actuator kit." },
      { issue: "Daily 35S clutch slave cylinder leak", fix: "Iveco genuine concentric slave cylinder + clutch kit." },
      { issue: "Stralis Hi-Way AdBlue dosing fault", fix: "Iveco genuine AdBlue pump module + heated tank fitting." }
    ],
    specs: [
      { label: "Engine families", value: "Cursor 9, Cursor 11, Cursor 13, F1A / F1C (Daily)" },
      { label: "Truck platforms", value: "S-Way, T-Way, X-Way, Stralis, Trakker" },
      { label: "LCV platform", value: "Daily (3.0L — 7.0T GVW)" },
      { label: "Emission norms", value: "Euro-V / Euro-VI Step E" }
    ],
    seoBlurbs: [
      "Iveco spare parts for S-Way 460, S-Way 510, T-Way 460, X-Way 460, Stralis Hi-Way 460, Trakker 410T and the Iveco Daily 35S, 50C and 70C vans are sourced through Narmada Mobility's Iveco commercial vehicle export network. We supply Iveco Cursor 13 engine spares, Iveco ZF Hi-Tronix gearbox parts, Iveco axle differential and Iveco AdBlue system components."
    ],
  },
  daf: {
    key: "daf",
    name: "DAF Trucks",
    slug: "daf",
    tagline: "DAF XF, CF, LF & XG — Dutch heavy-duty truck spares worldwide",
    description:
      "DAF truck spare parts — XF, CF, LF, XG, XG+ series, DAF PACCAR MX-11 / MX-13 engines, ZF gearbox and complete cabin systems.",
    longDescription:
      "DAF Trucks (Netherlands), part of PACCAR, is one of Europe's premier heavy-duty truck manufacturers and 'International Truck of the Year' winner. Narmada Mobility supplies DAF PACCAR MX-11 and MX-13 engine spare parts, DAF TraXon and ZF AS Tronic gearbox parts, plus complete chassis and cabin spares for XF, CF, LF and the new XG / XG+ series. " + exportRegions,
    highlights: [
      "PACCAR MX-11 / MX-13 engine spares",
      "DAF TraXon & ZF AS Tronic gearbox",
      "XF, CF, LF, XG, XG+ complete coverage",
      "Multi-Torque & ADR axle spares",
    ],
    models: [
      "DAF XF 105", "DAF XF 106", "DAF XF 480", "DAF XF 530",
      "DAF CF 75", "DAF CF 85", "DAF CF 410", "DAF CF 450",
      "DAF LF 180", "DAF LF 230", "DAF LF 260",
      "DAF XG 480", "DAF XG 530", "DAF XG+ 480", "DAF XG+ 530",
    ],
    categories: ["PACCAR MX Engine", "TraXon Gearbox", "DAF Axle", "EBS Brake", "Cabin (XF/CF)", "Electrical", "Cooling"],
    color: "#2563eb",
    heroAccent: "from-blue-700 to-cyan-600",
    founded: "1928",
    origin: "Eindhoven, Netherlands",
    category: "truck",
    logoFile: "daf.svg",
    keywordTargets: [
      "daf spare parts", "daf xf parts", "daf cf parts", "daf paccar mx engine",
      "daf xg parts", "daf truck parts exporter", "daf lf parts",
    ],
    faq: [
      { q: "Do you supply PACCAR MX-13 engine parts for DAF XF?", a: "Yes. Complete PACCAR MX-13 engine spare parts inventory — pistons, liners, valves, injectors, common rail pumps, turbochargers and water pumps for DAF XF 480/530 and XG+ models." },
    ],
  
    whyMatters: "DAF Trucks NV (a PACCAR company) builds the XF, XG, XG+, XD and CF tractor and rigid range that dominates European long-haul. DAF buyers in MENA and Africa rely on Narmada Mobility for hard-to-source DAF genuine spare parts with PACCAR-traceable invoices.",
    industries: ["European long-haul", "Tipper & construction", "Refrigerated transport", "Tanker logistics"],
    commonIssues: [
      { issue: "MX-11 / MX-13 engine injector failure", fix: "PACCAR genuine MX engine injector with new copper washer kit." },
      { issue: "ZF TraXon gearbox electronic shift fault", fix: "DAF / ZF TraXon gearbox actuator + ECU programming via authorized network." },
      { issue: "XF 480 / XG 530 SCR catalyst block", fix: "DAF genuine SCR catalyst + AdBlue dosing module." },
      { issue: "CF 450 air-dryer cartridge", fix: "Wabco / Knorr-Bremse OE air dryer cartridge with new mounting o-ring." }
    ],
    specs: [
      { label: "Engine families", value: "PACCAR MX-11, MX-13" },
      { label: "Truck platforms", value: "XF, XG, XG+, XD, CF, LF" },
      { label: "GVW range", value: "7.5T (LF) — 50T+ (XG+)" },
      { label: "Emission norms", value: "Euro-VI Step E" }
    ],
    seoBlurbs: [
      "DAF spare parts for XF 480, XF 530, XG 530, XG+ 530, XD 450, CF 410, CF 480 and LF 230 are sourced through Narmada Mobility's DAF commercial vehicle export network. We supply DAF PACCAR MX engine spares, DAF ZF TraXon gearbox parts, DAF SCR / AdBlue assemblies and DAF cabin parts with full PACCAR traceability."
    ],
  },
  renault: {
    key: "renault",
    name: "Renault Trucks",
    slug: "renault",
    tagline: "Renault T, C, K, D series — French heavy commercial vehicle spares",
    description:
      "Renault Trucks spare parts — T-series long-haul, C-series construction, K-series heavy mining, D-series distribution and Master LCV.",
    longDescription:
      "Renault Trucks (France), part of the Volvo Group, manufactures premium European commercial vehicles. Narmada Mobility supplies Renault DTI 11, DTI 13 engine spares (shared with Volvo D11/D13), Renault Optidriver gearbox parts, plus complete chassis, cabin and electrical components for T, C, K, D series trucks operating in mining, long-haul and construction. " + exportRegions,
    highlights: [
      "DTI 11 / DTI 13 engine spares (Volvo platform)",
      "Optidriver AT2412F gearbox parts",
      "T, C, K, D series complete coverage",
      "Renault Master LCV parts",
    ],
    models: [
      "Renault T 380", "Renault T 440", "Renault T 460", "Renault T 480", "Renault T 520",
      "Renault C 380", "Renault C 440", "Renault C 480",
      "Renault K 440", "Renault K 480", "Renault K 520",
      "Renault D 240", "Renault D Wide 280",
      "Renault Master L1H1", "Renault Master L3H2",
    ],
    categories: ["DTI Engine", "Optidriver Gearbox", "Renault Axle", "Cabin", "Brake System", "Electrical", "Filters"],
    color: "#b45309",
    heroAccent: "from-amber-700 to-yellow-600",
    founded: "1894",
    origin: "Lyon, France",
    category: "truck",
    logoFile: "renault.svg",
    keywordTargets: [
      "renault truck parts", "renault t series parts", "renault k series parts",
      "renault c series parts", "renault dti 13 engine", "renault truck exporter",
    ],
    faq: [
      { q: "Are Renault DTI engine parts cross-compatible with Volvo D-series?", a: "Yes. Renault DTI 11 and DTI 13 engines share architecture with Volvo D11 and D13 — many spare parts are interchangeable, which we can confirm by part number cross-reference." },
    ],
  
    whyMatters: "Renault Trucks (Volvo Group) builds the T-range, T-High, C-range, K-range and D-range commercial vehicles plus the Master and Trafic LCVs. Renault truck spare parts are common in francophone Africa and CIS, and we keep ready stock for the most-asked references.",
    industries: ["Long-haul logistics", "Construction & quarry", "Light commercial / Master van", "Defence vehicles"],
    commonIssues: [
      { issue: "DTI 11 / DTI 13 engine injector failure", fix: "Renault Trucks genuine DTI injector with new copper washer kit." },
      { issue: "Optidriver gearbox shift jolt", fix: "Volvo Group / Renault Optidriver clutch actuator + ECU calibration." },
      { issue: "C 460 air dryer failure", fix: "Wabco / Knorr-Bremse OE air dryer cartridge." },
      { issue: "Master 2.3 dCi injector dribble", fix: "Bosch / Delphi injector recon to OE specs." }
    ],
    specs: [
      { label: "Engine families", value: "DTI 5, DTI 8, DTI 11, DTI 13" },
      { label: "Truck platforms", value: "T-High, T, C, K, D" },
      { label: "LCV platforms", value: "Master, Trafic" }
    ],
    seoBlurbs: [
      "Renault Trucks spare parts for T 460, T-High 520, C 380, C 460, K 460, K 520 and D-Wide 320 are sourced through Narmada Mobility's Renault Trucks export network. We supply Renault DTI engine spares, Renault Optidriver gearbox parts, Renault axle parts and Renault cabin assemblies."
    ],
  },
  jcb: {
    key: "jcb",
    name: "JCB",
    slug: "jcb",
    tagline: "JCB backhoe, excavator & telehandler — British construction equipment spares",
    description:
      "JCB spare parts — 3DX, 4DX backhoe loaders, JS 81/120/130/205/220 excavators, 530-70 telehandler, JCB engines, ECOMAX hydraulics.",
    longDescription:
      "JCB (UK) is the world's third-largest construction equipment manufacturer. Narmada Mobility supplies JCB genuine and OEM-equivalent spare parts for the entire range — 3DX/4DX backhoe loaders, JS series tracked excavators, Loadall telehandlers, JCB ECOMAX engines, Bosch Rexroth & Kawasaki hydraulic pumps, undercarriage components (track chains, rollers, idlers) and complete electrical systems. " + exportRegions,
    highlights: [
      "JCB 3DX & 4DX backhoe loader complete coverage",
      "JS-series excavator hydraulic & undercarriage",
      "JCB ECOMAX engine spares",
      "Kawasaki / Rexroth pump & motor parts",
    ],
    models: [
      "JCB 3DX", "JCB 3DX Super", "JCB 3DX Plus", "JCB 4DX", "JCB 4CX",
      "JCB JS 81", "JCB JS 120", "JCB JS 130", "JCB JS 140",
      "JCB JS 205", "JCB JS 220", "JCB JS 220LC", "JCB JS 240",
      "JCB JS 305", "JCB JS 370",
      "JCB 530-70 Loadall", "JCB 540-170", "JCB 540-180",
      "JCB 432ZX Wheel Loader", "JCB 437HT",
      "JCB Vibromax VMT 260", "JCB VM 115 Roller",
    ],
    categories: ["ECOMAX Engine", "Hydraulic Pump (Rexroth/Kawasaki)", "Undercarriage", "Final Drive", "Swing Motor", "Bucket & Pin", "Electrical", "Cabin"],
    color: "#facc15",
    heroAccent: "from-yellow-600 to-amber-500",
    founded: "1945",
    origin: "Rocester, UK (Pune, India)",
    category: "equipment",
    logoFile: "jcb.svg",
    keywordTargets: [
      "jcb spare parts", "jcb 3dx parts", "jcb 4dx parts", "jcb js 220 parts",
      "jcb backhoe parts", "jcb excavator parts", "jcb js 130 parts",
      "jcb ecomax engine parts", "jcb exporter india", "jcb loadall parts",
      "jcb 432 wheel loader parts", "jcb genuine parts wholesale",
    ],
    topPartNumbers: ["320/06927 (Hydraulic Pump)", "332/F4763 (Filter Kit)", "320/A7170 (Alternator)", "JRB0050 (Bucket Pin)"],
    faq: [
      { q: "Do you supply JCB 3DX backhoe loader parts?", a: "Yes. JCB 3DX is the most popular backhoe in India and we maintain the deepest inventory — ECOMAX/444 engine spares, hydraulic pumps, transmission, axles, bucket pins and electrical." },
      { q: "Are JCB JS-series excavator hydraulic pumps available?", a: "Yes. We stock Kawasaki K3V112DT, K3V140DT and Rexroth A8VO pumps for JCB JS 120, 130, 205, 220, 305 and 370 excavators." },
      { q: "Do you ship JCB parts to Africa and Middle East?", a: "Yes. JCB is heavily deployed across UAE, Saudi Arabia, Kenya, Nigeria and Tanzania for construction and mining — we ship consolidated containers every week." },
    ],
  
    whyMatters: "JCB is the world's largest backhoe loader manufacturer and a leading global construction equipment OEM. JCB 3DX, 3DX Plus, 4DX backhoes, JS-130 / JS-205 / JS-220 excavators and JCB skid-steer, telehandler and wheel-loader ranges are operated in every market we export to.",
    industries: ["Construction & infrastructure", "Quarrying & aggregates", "Municipal & utility", "Agriculture & forestry", "Mining support"],
    commonIssues: [
      { issue: "3DX backhoe hydraulic main pump pressure drop", fix: "JCB OE Bosch Rexroth main hydraulic pump with new pressure-relief cartridge." },
      { issue: "JS-205 / JS-220 swing motor oil leak", fix: "JCB Kayaba swing motor rebuild kit + new bearing housing seal." },
      { issue: "3DX gearbox synchroniser wear", fix: "JCB genuine Carraro transmission synchro kit + bearing set." },
      { issue: "JS-130 final-drive travel motor wear", fix: "JCB Kawasaki / Kayaba travel motor rebuild kit or complete final-drive unit." }
    ],
    specs: [
      { label: "Engine families", value: "JCB DieselMAX 444, 448, 672; Cummins-JCB; Kohler" },
      { label: "Backhoe range", value: "3CX, 3DX, 3DX Plus, 4DX, 4CX" },
      { label: "Excavator range", value: "JS-81 — JS-470" },
      { label: "Other platforms", value: "Skid-steer, telehandler, wheel-loader, Vibromax compactor" }
    ],
    seoBlurbs: [
      "JCB spare parts for 3DX, 3DX Plus, 3DX Super, 3DX Xtra, 4DX, JS-81, JS-130, JS-140, JS-205, JS-220, JS-220LC and JS-300 are stocked in depth at Narmada Mobility. We supply JCB DieselMAX engine spares, JCB Bosch Rexroth hydraulic pumps, JCB Kayaba swing motors, JCB Kawasaki travel motors, JCB final drives and JCB undercarriage components for backhoe, excavator and wheel-loader fleets.",
      "JCB construction equipment operators in Saudi Arabia, UAE, Oman, Kuwait, Egypt, Morocco, Algeria, Nigeria, Ghana, Tanzania, Mozambique and Bangladesh source JCB genuine and OEM-matched spares from Narmada Mobility with consolidated container export from Mumbai and Mundra ports."
    ],
  },
  caterpillar: {
    key: "caterpillar",
    name: "Caterpillar (CAT)",
    slug: "caterpillar",
    tagline: "CAT 320, 330, 336, D series — heavy equipment spares worldwide",
    description:
      "Caterpillar spare parts — CAT 320, 330, 336, 349, 374 excavators, D6/D8/D9 dozers, 950/966/980 wheel loaders, C-series engines.",
    longDescription:
      "Caterpillar Inc. (USA) is the world's largest construction equipment manufacturer. Narmada Mobility supplies CAT genuine and OEM-equivalent spare parts for 320/330/336/349/374 hydraulic excavators, D6/D8/D9 dozers, 950/966/980/988 wheel loaders, CAT C7/C9/C13/C15/C18 industrial engines, undercarriage (track chains, rollers, idlers), GET (ground engaging tools — teeth, adapters, cutting edges), hydraulic pumps and complete electrical systems. " + exportRegions,
    highlights: [
      "CAT 320/330/336/349 excavator complete coverage",
      "C7, C9, C13, C15, C18 engine spares",
      "GET (teeth, adapters, edges) — genuine + Esco/H&L",
      "Undercarriage (Berco, ITM, ITR) options",
    ],
    models: [
      "CAT 320D", "CAT 320D2", "CAT 320GC", "CAT 323D", "CAT 326D2",
      "CAT 330D", "CAT 330D2", "CAT 336D", "CAT 336D2L",
      "CAT 349D", "CAT 374F", "CAT 390F",
      "CAT D6R", "CAT D6T", "CAT D8R", "CAT D8T", "CAT D9R", "CAT D9T",
      "CAT 950H", "CAT 950GC", "CAT 966H", "CAT 980H", "CAT 988K",
      "CAT 745C Articulated Dump Truck", "CAT 770G", "CAT 773G",
      "CAT C7 Engine", "CAT C9 Engine", "CAT C13 Engine", "CAT C15 Engine", "CAT C18 Engine",
    ],
    categories: ["Engine (C7-C18)", "Hydraulic Pump", "Undercarriage", "GET (Teeth/Edges)", "Final Drive", "Swing Motor", "Electrical", "Filters"],
    color: "#facc15",
    heroAccent: "from-yellow-500 to-amber-400",
    founded: "1925",
    origin: "Deerfield, Illinois, USA",
    category: "equipment",
    logoFile: "caterpillar.svg",
    keywordTargets: [
      "caterpillar spare parts", "cat 320 parts", "cat 330 parts", "cat 336 parts",
      "cat excavator parts", "cat dozer parts", "cat d8 parts",
      "cat c9 engine parts", "cat c15 engine parts", "cat undercarriage",
      "cat get teeth adapters", "caterpillar parts exporter india",
    ],
    topPartNumbers: ["1R-0750 (Fuel Filter)", "1R-0739 (Oil Filter)", "7Y-1390 (Cutting Edge)", "9W-1878 (Tooth)", "2479262 (Hydraulic Pump)"],
    faq: [
      { q: "Do you supply CAT 320 hydraulic excavator parts?", a: "Yes. Complete CAT 320D, 320D2, 320GC and 323D parts inventory — main pumps, swing motors, final drives, undercarriage, hydraulic cylinders, cabin and electrical." },
      { q: "Are GET (ground engaging tools) available?", a: "Yes. We supply genuine CAT GET plus high-quality alternatives from Esco and H&L — bucket teeth, adapters, side cutters, cutting edges for all CAT excavators, loaders and dozers." },
      { q: "Do you stock CAT C-series engine parts?", a: "Yes. Full inventory for CAT C7, C9, C13, C15 and C18 engines — pistons, liners, valves, cylinder heads, injectors, turbochargers, water pumps and gaskets." },
    ],
  
    whyMatters: "Caterpillar is the world's largest manufacturer of construction equipment, mining trucks and diesel engines. Cat 320, Cat 330, Cat 336, Cat 374 hydraulic excavators, Cat 950 / 966 / 980 wheel loaders, Cat D6 / D8 / D9 dozers and Cat 793 / 797 mining trucks rely on a complex global parts supply chain — which is where Narmada Mobility plugs in.",
    industries: ["Open-cast & underground mining", "Heavy infrastructure", "Quarrying & aggregates", "Forestry & marine", "Oil & gas"],
    commonIssues: [
      { issue: "C9 / C13 / C15 engine MEUI injector failure", fix: "Cat-OE remanufactured MEUI injector with calibration data." },
      { issue: "320 / 336 excavator hydraulic main pump failure", fix: "Cat OE Kawasaki K3V112 / K3V180 hydraulic main pump rebuild or new." },
      { issue: "D6 / D8 dozer track-frame roller wear", fix: "Cat genuine track roller, carrier roller and idler with sprocket segments." },
      { issue: "966H / 980H wheel loader transmission solenoid fault", fix: "Cat genuine powershift solenoid kit + transmission filter set." }
    ],
    specs: [
      { label: "Engine families", value: "C7, C9, C13, C15, C18, 3406, 3408, 3412" },
      { label: "Excavator range", value: "Cat 320, 323, 325, 330, 336, 349, 374, 390, 395" },
      { label: "Wheel loader range", value: "950, 966, 972, 980, 988" },
      { label: "Dozer range", value: "D5, D6, D7, D8, D9, D10, D11" }
    ],
    seoBlurbs: [
      "Caterpillar spare parts for Cat 320 D / 320 GC, Cat 323 D, Cat 330 D / 330 GC, Cat 336 D, Cat 349 D, Cat 374 F, Cat 950 GC, Cat 966 H / 966 M, Cat 980 H, Cat D6R / D8R / D9R dozers and Cat 740 / 745 articulated dump trucks are sourced through Narmada Mobility's authorized Caterpillar spare parts network. We supply Cat MEUI / HEUI injectors, Cat Kawasaki K3V hydraulic pumps, Cat final drives, Cat travel motors, Cat undercarriage components and Cat engine spares.",
      "Mining contractors in Saudi Arabia, UAE, Oman, Mozambique, Zambia, DRC, Tanzania, Ghana, Mongolia and Russia source genuine Caterpillar parts and Cat OEM-matched aftermarket parts from Narmada Mobility with full export documentation including Certificate of Origin, packing list and commercial invoice."
    ],
  },
  komatsu: {
    key: "komatsu",
    name: "Komatsu",
    slug: "komatsu",
    tagline: "Komatsu PC, WA, D, HD — Japanese heavy equipment spare parts",
    description:
      "Komatsu spare parts — PC130/200/300/450 excavators, WA320/380/470 wheel loaders, D65/D85/D155 dozers, HD605/785 dump trucks, SAA6D engines.",
    longDescription:
      "Komatsu (Japan) is the world's second-largest construction and mining equipment manufacturer. Narmada Mobility supplies Komatsu genuine and OEM-equivalent spare parts for PC-series hydraulic excavators, WA-series wheel loaders, D-series bulldozers, HD-series rigid dump trucks and Komatsu SAA4D/SAA6D engines. Inventory includes hydraulic pumps (HPV), swing motors, final drives, complete undercarriage and HENSLEY/ESCO GET. " + exportRegions,
    highlights: [
      "PC-series excavator HPV pumps & final drives",
      "WA-series wheel loader transmission spares",
      "D-series dozer undercarriage components",
      "SAA6D107/125/140/170 engine spares",
    ],
    models: [
      "Komatsu PC 130-8", "Komatsu PC 200-8", "Komatsu PC 200LC-8", "Komatsu PC 210LC-10",
      "Komatsu PC 220LC-8", "Komatsu PC 300LC-8", "Komatsu PC 350LC-8",
      "Komatsu PC 450LC-8", "Komatsu PC 500LC-10", "Komatsu PC 800LC-8",
      "Komatsu WA 320-7", "Komatsu WA 380-6", "Komatsu WA 470-6", "Komatsu WA 500-7",
      "Komatsu D 65EX-18", "Komatsu D 85EX-18", "Komatsu D 155A-6", "Komatsu D 275A-5",
      "Komatsu HD 405-7", "Komatsu HD 605-7", "Komatsu HD 785-7",
      "Komatsu GD 535-5 Motor Grader",
    ],
    categories: ["SAA Engine", "HPV Hydraulic Pump", "Swing Motor", "Final Drive", "Undercarriage", "GET", "Cabin", "Electrical"],
    color: "#fbbf24",
    heroAccent: "from-yellow-500 to-orange-400",
    founded: "1921",
    origin: "Tokyo, Japan",
    category: "equipment",
    logoFile: "komatsu.svg",
    keywordTargets: [
      "komatsu spare parts", "komatsu pc 200 parts", "komatsu pc 300 parts",
      "komatsu pc 450 parts", "komatsu wa 380 parts", "komatsu d65 parts",
      "komatsu hd 785 parts", "komatsu hpv pump", "komatsu final drive",
      "komatsu undercarriage", "komatsu exporter india",
    ],
    topPartNumbers: ["708-2L-00500 (HPV Pump)", "20Y-27-00432 (Final Drive)", "207-70-14151 (Tooth)", "600-211-1340 (Fuel Filter)"],
    faq: [
      { q: "Do you supply Komatsu PC 200 hydraulic pumps?", a: "Yes. We stock HPV95+95 main pumps for PC 200-7/8, HPV132 for PC 300-7/8 and HPV165 for PC 450-7/8 — both genuine Komatsu and high-quality aftermarket from Kayaba and Doosan." },
      { q: "Are Komatsu undercarriage components available?", a: "Yes. Complete undercarriage — track chains, rollers, idlers, sprockets — for all PC and D-series Komatsu machines from genuine, ITM, ITR and Berco." },
    ],
  
    whyMatters: "Komatsu Ltd is the world's second-largest construction and mining equipment OEM. Komatsu PC 200, PC 210, PC 220, PC 300, PC 400 hydraulic excavators, Komatsu WA 380 / WA 470 wheel loaders, Komatsu D 65 / D 85 dozers and Komatsu HD 465 / HD 785 mining trucks are core to global infrastructure.",
    industries: ["Open-cast mining", "Tunnelling & underground", "Quarrying", "Forestry & marine", "Heavy construction"],
    commonIssues: [
      { issue: "PC 200 / PC 220 main hydraulic pump pressure loss", fix: "Komatsu HPV90 / HPV95 main pump rebuild or new — pressure-tested before dispatch." },
      { issue: "SAA6D107 / SAA6D125 engine injector failure", fix: "Komatsu OE common-rail injector with new sealing washer." },
      { issue: "PC 300 / PC 400 swing motor seal leak", fix: "Komatsu Kayaba swing motor seal kit + bearing replacement." },
      { issue: "WA 470 transmission torque-converter wear", fix: "Komatsu genuine torque-converter rebuild kit + transmission filter." }
    ],
    specs: [
      { label: "Engine families", value: "SAA4D107E, SAA6D107E, SAA6D125E, SAA6D170, SAA12V140" },
      { label: "Excavator range", value: "PC 78 — PC 8000-6 (mining)" },
      { label: "Wheel loader range", value: "WA 200 — WA 1200" },
      { label: "Dozer range", value: "D 39 — D 575A" }
    ],
    seoBlurbs: [
      "Komatsu spare parts for PC 200-8, PC 210-10, PC 220-8, PC 300-8, PC 400-8, PC 450-8, PC 850-8 and PC 1250-8 hydraulic excavators plus WA 380, WA 470, WA 500, WA 600, D 65, D 85, D 155 dozers and HD 465, HD 785 mining trucks are stocked in depth at Narmada Mobility. We supply Komatsu SAA6D107 / SAA6D125 engine spares, Komatsu HPV90 / HPV95 hydraulic pumps, Komatsu Kayaba swing motors, Komatsu final drives and Komatsu undercarriage components."
    ],
  },
  hitachi: {
    key: "hitachi",
    name: "Hitachi Construction Machinery",
    slug: "hitachi",
    tagline: "Hitachi ZX, EX series — Japanese excavator spares globally",
    description:
      "Hitachi excavator spare parts — ZX130/200/350/470/870, EX200/300/400/600, Hitachi hydraulic pumps, swing motors and Isuzu-derived engines.",
    longDescription:
      "Hitachi Construction Machinery (Japan) is one of the world's leading hydraulic excavator manufacturers. Narmada Mobility supplies Hitachi ZX (Zaxis) and EX series excavator parts — Kawasaki K3V/K5V hydraulic pumps, swing motors, final drives, complete undercarriage, Isuzu-derived engine parts (4HK1, 6HK1, 6WG1) and complete electrical systems. " + exportRegions,
    highlights: [
      "Zaxis ZX 130/200/350/470 complete coverage",
      "EX-series legacy excavator parts",
      "Kawasaki K3V/K5V pump spares",
      "Isuzu 4HK1/6HK1/6WG1 engine parts",
    ],
    models: [
      "Hitachi ZX 70", "Hitachi ZX 130", "Hitachi ZX 200-5G", "Hitachi ZX 220LC",
      "Hitachi ZX 350H-5G", "Hitachi ZX 370", "Hitachi ZX 470H-5G",
      "Hitachi ZX 670LCH-5", "Hitachi ZX 870H-5",
      "Hitachi EX 200", "Hitachi EX 200-5", "Hitachi EX 300", "Hitachi EX 400",
      "Hitachi EX 600", "Hitachi EX 1200", "Hitachi EX 2500",
      "Hitachi ZW 220 Wheel Loader", "Hitachi ZW 310",
    ],
    categories: ["Engine (Isuzu)", "Kawasaki Hydraulic Pump", "Swing Motor", "Final Drive", "Undercarriage", "GET", "Cabin", "Electrical"],
    color: "#ea580c",
    heroAccent: "from-orange-700 to-amber-500",
    founded: "1970",
    origin: "Tokyo, Japan",
    category: "equipment",
    logoFile: "hitachi.svg",
    keywordTargets: [
      "hitachi spare parts", "hitachi zx 200 parts", "hitachi zx 350 parts",
      "hitachi ex 200 parts", "hitachi excavator parts", "hitachi pump k3v",
      "hitachi mining excavator parts", "hitachi zaxis parts exporter",
    ],
    faq: [
      { q: "Do you supply Hitachi ZX 350 final drives?", a: "Yes. Genuine Hitachi and high-quality aftermarket final drive assemblies for ZX 200, ZX 350, ZX 470 and ZX 670 — complete with travel motor." },
      { q: "Are Hitachi EX legacy excavator parts still available?", a: "Yes. EX 200, EX 300, EX 400 and EX 600 are still operating widely in Africa and CIS — we maintain dedicated inventory for these legacy models." },
    ],
  
    whyMatters: "Hitachi Construction Machinery is a top global excavator and mining equipment OEM. Hitachi ZX 200, ZX 220, ZX 350, ZX 470, ZX 670, ZX 870 and the EX-series mining excavators are operated across the GCC, CIS and Africa, with strong demand for Hitachi genuine spare parts at our export desk.",
    industries: ["Open-cast mining", "Quarrying", "Heavy infrastructure", "Marine & port", "Forestry"],
    commonIssues: [
      { issue: "ZX 200 / ZX 220 main hydraulic pump pressure loss", fix: "Hitachi HPV118 / HPV145 main pump rebuild or replacement — pressure-tested." },
      { issue: "ZX 350 / ZX 470 swing motor seal leak", fix: "Hitachi Kayaba swing motor seal kit + bearing assembly." },
      { issue: "ZX 670 / ZX 870 travel motor reduction gear wear", fix: "Hitachi travel motor reduction gear assembly + planetary gear kit." },
      { issue: "Isuzu 6HK1 / 6WG1 engine common-rail injector fault", fix: "Hitachi OE common-rail injector — calibration data on request." }
    ],
    specs: [
      { label: "Engine families", value: "Isuzu 4HK1, 6HK1, 6WG1, 6UZ1" },
      { label: "Excavator range", value: "ZX 70 — ZX 870; EX 1200 / EX 2600 (mining)" },
      { label: "Wheel loader range", value: "ZW 140 — ZW 550" }
    ],
    seoBlurbs: [
      "Hitachi spare parts for ZX 200-3, ZX 210, ZX 220-3, ZX 240, ZX 270, ZX 330-3, ZX 350, ZX 470, ZX 670, ZX 870 and EX 1200-6 mining excavators are sourced through Narmada Mobility. We supply Hitachi HPV main pumps, Hitachi Kayaba swing motors, Hitachi final drives, Hitachi travel motors, Hitachi undercarriage components and Hitachi Isuzu engine spares."
    ],
  },
  "hyundai-ce": {
    key: "hyundai-ce",
    name: "Hyundai Construction Equipment",
    slug: "hyundai-ce",
    tagline: "Hyundai R-series & HX-series excavator and wheel loader spares",
    description:
      "Hyundai Construction Equipment spare parts — R140/200/220/300/500 LC excavators, HX series, HL wheel loaders and Cummins/Scania engines.",
    longDescription:
      "Hyundai Construction Equipment (South Korea) manufactures hydraulic excavators and wheel loaders widely used in construction and mining. Narmada Mobility supplies Hyundai R-series (Robex) and HX-series excavator parts, HL series wheel loader components, Kawasaki K3V/K5V hydraulic pumps, Cummins QSB/QSL/QSX engine spares and complete undercarriage for Hyundai equipment. " + exportRegions,
    highlights: [
      "Robex R140-R500LC complete coverage",
      "HX130L / HX220L / HX300L parts",
      "HL Wheel Loader 730/740/760/780",
      "Cummins engine spares (QSB, QSL, QSX)",
    ],
    models: [
      "Hyundai R 140LC-9", "Hyundai R 210LC-9", "Hyundai R 220LC-9S",
      "Hyundai R 300LC-9", "Hyundai R 380LC-9", "Hyundai R 500LC-9",
      "Hyundai HX 130L", "Hyundai HX 220L", "Hyundai HX 300L", "Hyundai HX 380L",
      "Hyundai HL 730", "Hyundai HL 740", "Hyundai HL 760", "Hyundai HL 780",
    ],
    categories: ["Engine (Cummins)", "Hydraulic Pump", "Swing Motor", "Final Drive", "Undercarriage", "Cabin", "Electrical", "Filters"],
    color: "#1d4ed8",
    heroAccent: "from-blue-700 to-sky-500",
    founded: "1985",
    origin: "Ulsan, South Korea",
    category: "equipment",
    logoFile: "hyundaice.svg",
    keywordTargets: [
      "hyundai construction equipment parts", "hyundai r 220 parts",
      "hyundai r 380 parts", "hyundai hx 300 parts", "hyundai hl 740 parts",
      "hyundai excavator parts india", "robex spare parts",
    ],
    faq: [
      { q: "Do you supply Hyundai R 220LC parts?", a: "Yes. Complete inventory for Hyundai R 220LC-9 and R 220LC-9S — Kawasaki K3V112DT pump, swing motor, final drive, undercarriage and Cummins QSB6.7 engine spares." },
    ],
  
    whyMatters: "Hyundai Construction Equipment is one of Korea's most respected heavy-equipment OEMs. Hyundai R 220, R 250, R 300, R 380, R 480, R 520 hydraulic excavators and Hyundai HL 740 / HL 760 / HL 960 wheel loaders are operated across the Middle East, Africa and CIS construction markets.",
    industries: ["Construction & infrastructure", "Quarrying", "Mining support", "Marine & port logistics"],
    commonIssues: [
      { issue: "R 220 / R 300 main hydraulic pump pressure loss", fix: "Hyundai OE Kawasaki K3V112 / K3V180 hydraulic main pump rebuild." },
      { issue: "R 250 / R 380 swing motor seal leak", fix: "Hyundai Kawasaki swing motor seal kit + planetary gear bearing." },
      { issue: "Cummins / Mitsubishi engine injector failure", fix: "Cummins OE / Bosch CRDI injector with calibration data." },
      { issue: "HL 740 / HL 960 wheel loader ZF transmission solenoid", fix: "Hyundai-OE ZF transmission solenoid kit + filter set." }
    ],
    specs: [
      { label: "Engine families", value: "Cummins QSB, QSL; Mitsubishi 6D24; Hyundai-Doosan G8AKK" },
      { label: "Excavator range", value: "R 60 — R 1200" },
      { label: "Wheel loader range", value: "HL 740 — HL 980" }
    ],
    seoBlurbs: [
      "Hyundai construction equipment spare parts for R 220LC-9S, R 250LC-9, R 300LC-9SH, R 380LC-9SH, R 480LC-9, R 520LC-9 and HL 740-7A, HL 760-7A, HL 960 wheel loaders are sourced through Narmada Mobility. We supply Hyundai Kawasaki K3V main pumps, Hyundai swing motors, Hyundai final drives, Hyundai undercarriage components and Hyundai Cummins engine spares."
    ],
  },
  kobelco: {
    key: "kobelco",
    name: "Kobelco",
    slug: "kobelco",
    tagline: "Kobelco SK excavator series — Japanese hydraulic precision",
    description:
      "Kobelco spare parts — SK 130/200/210/220/350/380/480 hydraulic excavators, Hino-derived engines, Kawasaki/KYB hydraulics.",
    longDescription:
      "Kobelco Construction Machinery (Japan) manufactures the SK series of hydraulic excavators known for fuel efficiency and reliability. Narmada Mobility supplies Kobelco SK 130/200/210/220/350/380/480 excavator parts including Hino-derived engine spares, Kawasaki K3V hydraulic pumps, KYB swing motors, complete undercarriage and electrical components. " + exportRegions,
    highlights: [
      "SK 130/210/220/350/380 complete coverage",
      "Hino J05/J08 engine spares",
      "KYB swing motor parts",
      "Kawasaki hydraulic pump spares",
    ],
    models: [
      "Kobelco SK 130-8", "Kobelco SK 140SR-3", "Kobelco SK 200-8",
      "Kobelco SK 210LC-9", "Kobelco SK 220LC-10",
      "Kobelco SK 350LC-10", "Kobelco SK 380LC-10",
      "Kobelco SK 480LC-8", "Kobelco SK 850LC",
    ],
    categories: ["Hino Engine", "Hydraulic Pump", "Swing Motor", "Final Drive", "Undercarriage", "Cabin", "Electrical"],
    color: "#0e7490",
    heroAccent: "from-cyan-800 to-teal-600",
    founded: "1930",
    origin: "Kobe, Japan",
    category: "equipment",
    logoFile: "kobelco.svg",
    keywordTargets: [
      "kobelco spare parts", "kobelco sk 200 parts", "kobelco sk 350 parts",
      "kobelco excavator parts", "kobelco sk 220 parts", "kobelco final drive",
    ],
    faq: [
      { q: "Do you supply Kobelco SK 220 parts?", a: "Yes. Complete inventory for Kobelco SK 220LC-10 — Hino J05E engine spares, Kawasaki K3V112DT pump, swing motor, final drive and full undercarriage." },
    ],
  
    whyMatters: "Kobelco Construction Machinery (Kobe Steel Group) builds hydraulic excavators renowned for low noise, low fuel consumption and crawler-crane heritage. Kobelco SK 200, SK 210, SK 220, SK 260, SK 350, SK 480 and the CKE-series crawler cranes are operated across our export markets.",
    industries: ["Construction & infrastructure", "Crawler-crane lifting operations", "Quarrying", "Marine & port"],
    commonIssues: [
      { issue: "SK 200 / SK 210 main hydraulic pump pressure drop", fix: "Kobelco OE Kawasaki K3V112 / K3V140 main pump rebuild." },
      { issue: "SK 350 / SK 480 swing motor oil seal leak", fix: "Kobelco Kawasaki swing motor seal kit + bearing replacement." },
      { issue: "Hino J05 / J08 engine common-rail injector failure", fix: "Denso CRDI injector reconditioned to OE specs." },
      { issue: "CKE-series crawler crane winch motor leak", fix: "Kobelco-OE winch motor + brake assembly." }
    ],
    specs: [
      { label: "Engine families", value: "Hino J05E, J08E, Isuzu 6HK1" },
      { label: "Excavator range", value: "SK 75 — SK 850 LC" },
      { label: "Crane range", value: "CKE 600 — CKE 2500" }
    ],
    seoBlurbs: [
      "Kobelco spare parts for SK 200-8, SK 210LC-8, SK 220-8, SK 260LC-8, SK 350LC-8, SK 480LC-8 and CKE 600 / CKE 1100 / CKE 2500 crawler cranes are sourced through Narmada Mobility's Kobelco network. We supply Kobelco Kawasaki main pumps, Kobelco swing motors, Kobelco final drives, Kobelco undercarriage components and Kobelco Hino engine spares."
    ],
  },
  liebherr: {
    key: "liebherr",
    name: "Liebherr",
    slug: "liebherr",
    tagline: "Liebherr R, L, T series — Swiss/German heavy equipment spares",
    description:
      "Liebherr spare parts — R 936/944/954/966/9100 mining excavators, L 538/550/566/580 wheel loaders, T 282 dump trucks and Liebherr engines.",
    longDescription:
      "Liebherr Group (Switzerland/Germany) is a leading manufacturer of mining and construction equipment, cranes and aerospace systems. Narmada Mobility supplies Liebherr R-series mining excavator spare parts, L-series wheel loader components, T-series dump truck parts, plus Liebherr D9508/D9512 engine spares, hydraulic pumps and complete undercarriage for mining operations. " + exportRegions,
    highlights: [
      "R 936/944/954/966 mining excavator coverage",
      "L 538/550/566/580 wheel loader parts",
      "T 282 mining truck spares",
      "Liebherr D-series engine spares",
    ],
    models: [
      "Liebherr R 936", "Liebherr R 944C", "Liebherr R 954C",
      "Liebherr R 966", "Liebherr R 980 SME", "Liebherr R 9100",
      "Liebherr R 9200", "Liebherr R 9400",
      "Liebherr L 538", "Liebherr L 550", "Liebherr L 566", "Liebherr L 580",
      "Liebherr T 264", "Liebherr T 282 C", "Liebherr T 284",
      "Liebherr LTM 1090", "Liebherr LTM 1200 Crane",
    ],
    categories: ["Liebherr Engine", "Hydraulic Pump", "Swing Drive", "Final Drive", "Undercarriage", "Cabin", "Mining GET", "Electrical"],
    color: "#fbbf24",
    heroAccent: "from-amber-500 to-yellow-400",
    founded: "1949",
    origin: "Bulle, Switzerland",
    category: "equipment",
    logoFile: "liebherr.svg",
    keywordTargets: [
      "liebherr spare parts", "liebherr r 9100 parts", "liebherr mining excavator",
      "liebherr l 550 parts", "liebherr crane parts", "liebherr t 282 parts",
    ],
    faq: [
      { q: "Do you supply Liebherr R 9100 mining excavator parts?", a: "Yes. We support Liebherr R 9100, R 9200 and R 9400 mining excavator operators in Africa and South America with hydraulic pumps, swing drives, GET and complete undercarriage components." },
    ],
  
    whyMatters: "Liebherr Group's mining excavators, wheel loaders, crawler cranes and mobile harbour cranes set the global benchmark for heavy-duty industrial equipment. Liebherr R 9100, R 9200, R 9400, R 9800 mining shovels and L 566 / L 580 wheel loaders are core to global mining operations.",
    industries: ["Open-cast & strip mining", "Marine & port (mobile harbour cranes)", "Heavy lift construction", "Tunnelling"],
    commonIssues: [
      { issue: "R 9100 / R 9200 main hydraulic pump pressure issue", fix: "Liebherr OE main hydraulic pump rebuild with new piston block and swash plate." },
      { issue: "L 566 / L 580 wheel loader transmission issue", fix: "Liebherr ZF transmission control valve + solenoid kit." },
      { issue: "Liebherr D-Series engine injector failure", fix: "Liebherr OE common-rail injector with calibration data." },
      { issue: "LHM mobile harbour crane slewing bearing wear", fix: "Liebherr genuine slewing bearing with grease kit and torque-bolt set." }
    ],
    specs: [
      { label: "Engine families", value: "Liebherr D 936, D 946, D 956, D 966; Cummins QSK" },
      { label: "Mining excavator range", value: "R 9100 — R 9800" },
      { label: "Wheel loader range", value: "L 506 — L 586" },
      { label: "Crane range", value: "LTM, LTR, LR, LHM mobile harbour cranes" }
    ],
    seoBlurbs: [
      "Liebherr spare parts for R 9100, R 9150, R 9200, R 9250, R 9350, R 9400, R 9800 mining excavators plus L 506, L 538, L 566, L 580, L 586 wheel loaders and LHM 420 / LHM 550 / LHM 600 mobile harbour cranes are sourced through Narmada Mobility. We supply Liebherr D-Series engine spares, Liebherr main hydraulic pumps, Liebherr ZF transmission parts, Liebherr final drives and Liebherr crane slewing bearings."
    ],
  },
};

export const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
  "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram",
  "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
  "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Delhi", "Jammu and Kashmir", "Ladakh", "Puducherry", "Chandigarh",
  "Andaman and Nicobar Islands", "Dadra and Nagar Haveli and Daman and Diu", "Lakshadweep",
];

export const TARGET_COUNTRIES = [
  // Africa
  "Kenya", "Nigeria", "Uganda", "Tanzania", "Mozambique", "South Africa",
  "Ghana", "Ethiopia", "Zambia", "Zimbabwe", "Angola", "Senegal", "Ivory Coast",
  "Egypt", "Morocco", "Algeria", "Sudan", "Cameroon", "Rwanda", "Botswana",
  // Middle East
  "United Arab Emirates", "Saudi Arabia", "Oman", "Qatar", "Kuwait", "Bahrain",
  "Iraq", "Iran", "Jordan", "Lebanon", "Yemen",
  // Asia
  "Sri Lanka", "Bangladesh", "Nepal", "Bhutan", "Myanmar", "Vietnam",
  "Indonesia", "Malaysia", "Philippines", "Thailand", "Singapore",
  // CIS & Russia
  "Russia", "Kazakhstan", "Uzbekistan", "Belarus", "Ukraine", "Azerbaijan",
  // Americas
  "United States", "Mexico", "Brazil", "Argentina", "Colombia", "Peru", "Chile", "Canada",
  // Oceania & Europe
  "Australia", "New Zealand", "Germany", "Netherlands", "Turkey",
];

// Flat list of all brands shown on the logo wall.
export interface BrandWallItem {
  name: string;
  logoFile: string;
  category: "truck" | "equipment";
  slug: BrandKey;
}

export const BRAND_WALL: BrandWallItem[] = (Object.values(BRANDS) as BrandInfo[]).map((b) => ({
  name: b.name,
  logoFile: b.logoFile,
  category: b.category,
  slug: b.key,
}));

export const PRODUCT_CATEGORIES = [
  { slug: "engine-parts", name: "Engine Parts", icon: "Wrench" },
  { slug: "dozer-urea", name: "Dozer & Urea (BS6)", icon: "Droplets" },
  { slug: "clutch", name: "Clutch & Pressure Plates", icon: "Disc" },
  { slug: "brake-system", name: "Brake System", icon: "Octagon" },
  { slug: "suspension", name: "Suspension & Steering", icon: "Move" },
  { slug: "transmission", name: "Transmission & Gearbox", icon: "Cog" },
  { slug: "differential", name: "Differential & Axle", icon: "Disc2" },
  { slug: "electrical", name: "Electrical & Sensors", icon: "Zap" },
  { slug: "filters", name: "Filters (Air, Oil, Fuel)", icon: "Filter" },
  { slug: "turbocharger", name: "Turbochargers", icon: "Wind" },
  { slug: "cooling", name: "Cooling System", icon: "Snowflake" },
  { slug: "hydraulic", name: "Hydraulic Pumps & Motors", icon: "Gauge" },
  { slug: "undercarriage", name: "Undercarriage (Excavator)", icon: "Layers" },
  { slug: "cabin-body", name: "Cabin & Body Parts", icon: "Truck" },
  { slug: "fuel-system", name: "Fuel System & Injectors", icon: "Fuel" },
];
