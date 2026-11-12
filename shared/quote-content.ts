export const QUOTE_BRANDS = [
  { name: "Tata", slug: "tata", kind: "Trucks, tippers, tractors and buses", models: "Prima, Signa, Ultra, LPT, LPK, Azura; LPT 1216/1916/3023/3725/4425/4932; Signa 2821.T/3023.T/3725.T/4830.T, 4021.S/4625.S/5521.S; Prima 2830.K/3532.K; Ultra T.6/T.19; 407 Gold SFC; LP 410/712/916 and LPO 1316.",
    source: "https://trucks.tatamotors.com/all-trucks", secondary: "https://fleetverse.tatamotors.com/product-list" },
  { name: "Mahindra", slug: "mahindra", kind: "Haulage trucks, light trucks and buses", models: "Blazo i-TRK 28/40/48/55, including 4x2 and 6x4 variants; Furio 7/8/8 NEO; Jayo, Jayo Plus, Loadking Optimo; Cruzio and Cruzio Grande.",
    source: "https://www.mahindratruckandbus.com/english/download/e-brochure.aspx" },
  { name: "BharatBenz", slug: "bharatbenz", kind: "Haulage, construction trucks, tractors and bus chassis", models: "914R, 1015R, 1217C, 1617R, 1917R, 1926C, 2523C/R, 2823C/R, 2826C, 3123R/RT, 3528C, 4228R, 4828R, 4928T and 5528T; bus chassis 914, 1624 and 1824. Examples include legacy fleets.",
    source: "https://www.bharatbenz.com/dealer/drive-trucking" },
  { name: "Ashok Leyland", slug: "ashok-leyland", kind: "Heavy trucks, construction applications and buses", models: "AVTR 4525H/4925H DTLA, 4625H LA and 4825T; 2825/2820 Boom Pump, 3525/2820 RMC and Cargo 2820 RMC; BOSS; Sunshine, Sunshine Li, Oyster and Viking buses.",
    source: "https://www.ashokleyland.com/in/" },
  { name: "Volvo", slug: "volvo", kind: "Global-market trucks and coaches", models: "FH16 Aero, FH Aero, FH16, FH, FMX, FM, FE, FL, VM, VNL, VHD, VAH, VNR and VNX; 9400, B8R and 9600 coaches. Vehicle families vary by market.",
    source: "https://www.volvotrucks.com/en-en/trucks/models.html", secondary: "https://www.volvobuses.com/en/news-stories/press-releases/2026/oct/volvo-9600-premium-intercity-india.html" },
  { name: "AMW", slug: "amw", kind: "Legacy fleet enquiries", models: "2518 tipper and 3118 haulage; legacy tipper, haulage and tractor applications. Share the exact model, build year, engine and axle details for identification.",
    source: "https://www.motorindiaonline.in/amws-ab-trucks/" },
  { name: "Caterpillar", slug: "caterpillar", kind: "Construction and earthmoving equipment", models: "Cat 725, 730, 730 EJ and 740 EJ articulated trucks. Include equipment serial number and component identifiers; road-truck fitment is not interchangeable.",
    source: "https://www.cat.com/ja_JP/by-industry/construction/articulated-trucks.html" },
  { name: "JCB", slug: "jcb", kind: "Construction equipment", models: "3DX, 3DX Plus, 3DX Xtra, 3DX Super, 3DXL Plus and 4DX backhoe loaders. Give the machine serial number and assembly reference for hydraulic, driveline and service-part enquiries.",
    source: "https://www.jcb.com/en-IN/products/machines/backhoe-loaders/?amp" },
];
export const QUOTE_PARTS = [
  ["Engine and fuel", "Pistons, liners, bearings, gaskets, cylinder-head parts, injectors, fuel pumps, sensors and filtration. Include the engine code and emission standard."],
  ["Cooling and intake", "Radiators, coolant pumps, hoses, thermostats, intercoolers, turbochargers and air-intake parts. Specify the assembly number and hose or port layout."],
  ["Clutch and transmission", "Clutch discs, pressure plates, release bearings, actuators, gearbox components and propeller-shaft joints. Gearbox variant and clutch dimensions help avoid mismatches."],
  ["Axle, brakes and suspension", "Differential and axle parts, wheel bearings, brake pads and linings, drums, discs, valves, air-system parts, springs, bushes and shock absorbers. Include axle and brake-system references."],
  ["Steering, electrical and body", "Steering joints, pumps, alternators, starters, wiring components, lamps, mirrors, cab panels, door hardware and wipers. Photos of connectors and mounting points can help."],
  ["Hydraulics, equipment and trailers", "Hydraulic pumps, seals, cylinders and hoses; undercarriage and ground-contact wear parts; trailer axle, suspension, coupling and landing-leg parts. Quote the component manufacturer and rated application."],
];
export const QUOTE_FAQS = [
  ["Can I enquire without a part number?", "Yes. Enter the part name, quantity and any model or assembly details you know. Leave an unknown identifier blank rather than guessing. Identification and compatibility still need review."],
  ["Which files can I upload?", "CSV, XLSX, PDF, JPG and PNG, up to 4 MiB and 500 items. PDF files may contain up to five pages; images up to 20 megapixels. XLSX uses its first worksheet. Use a clean UTF-8 CSV with part_number, description and quantity headers."],
  ["Will scanned indents be exact?", "Document reading can miss or misread text. Check every extracted field, especially leading zeroes and quantities, before submitting. Missing values remain blank. Manual entry is always available."],
  ["Is an enquiry a confirmed order?", "No. The sales team must confirm pricing, availability, fitment, commercial terms and delivery. A saved enquiry reference and an email-service acceptance are not a stock reservation or a promise of inbox delivery."],
  ["Can I request other makes or destinations?", "Yes. Add the make, exact model, part details and destination in the notes. The model and location directories are examples for organising an enquiry, not exhaustive coverage or a verified delivery network."],
  ["What should an export enquiry include?", "Give the destination country, city or port, quantity, intended application and any packing or documentation requirements. Export eligibility, customs, freight and lead times require separate checks."],
];
export const QUOTE_PHOTOS = [
  { file: "/images/quotation/prima.webp", alt: "Blue Tata Daewoo Prima truck photographed outdoors", caption: "Tata Daewoo Prima, illustrative vehicle photograph, not Narmada-owned fleet.", creator: "Benespit", source: "https://commons.wikimedia.org/wiki/File:0_Tata_Prima_Truck_1.jpg" },
  { file: "/images/quotation/components.webp", alt: "Heavy-equipment components photographed on a white background", caption: "Illustrative heavy-equipment components, not an inventory or compatibility claim.", creator: "Kapsamoon", source: "https://commons.wikimedia.org/wiki/File:Heavy-machinery-parts.jpg" },
];
