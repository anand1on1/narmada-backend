<?php
// R28.19: SPA entry for known app paths; unknown URLs are real noindex 404s.
declare(strict_types=1);
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$path = is_string($path) ? $path : '';
$known = preg_match('~^/(?:about|contact|work-with-us|privacy|disclaimer|cart|checkout|price-checker|track-consignment(?:/[^/]+)?|find-parts|get-quote|parts-finder|chassis(?:/[^/]+)?|customer/(?:login|signup|verify|account|wishlist|orders(?:/[^/]+)?)|order-confirmation/[^/]+|team-upload|admin(?:/[^?]*)?|team(?:/[^?]*)?|delhi(?:/[^?]*)?)/?$~D', $path)
    || preg_match('~^/brand/(?:tata|bharatbenz|ashok-leyland|eicher|volvo)/?$~D', $path)
    || preg_match('~^/category/(?:engine-parts|dozer-urea|clutch|brake-system|suspension|transmission|differential|electrical|filters|turbocharger|cooling|hydraulic|undercarriage|cabin-body|fuel-system)/?$~D', $path)
    || $path === '/';
// Existing geo pages stay accessible, but are not promoted through the sitemap.
if (!$known && preg_match('~^/(?:tata|bharatbenz|ashok-leyland|eicher|volvo)-spare-parts-([a-z-]+)$~D', $path, $m)) {
    $locations = explode('|', 'andhra-pradesh|arunachal-pradesh|assam|bihar|chhattisgarh|goa|gujarat|haryana|himachal-pradesh|jharkhand|karnataka|kerala|madhya-pradesh|maharashtra|manipur|meghalaya|mizoram|nagaland|odisha|punjab|rajasthan|sikkim|tamil-nadu|telangana|tripura|uttar-pradesh|uttarakhand|west-bengal|delhi|jammu-and-kashmir|ladakh|puducherry|chandigarh|andaman-and-nicobar-islands|dadra-and-nagar-haveli-and-daman-and-diu|lakshadweep|kenya|nigeria|uganda|tanzania|mozambique|south-africa|ghana|ethiopia|zambia|zimbabwe|angola|senegal|ivory-coast|egypt|morocco|algeria|sudan|cameroon|rwanda|botswana|united-arab-emirates|saudi-arabia|oman|qatar|kuwait|bahrain|iraq|iran|jordan|lebanon|yemen|sri-lanka|bangladesh|nepal|bhutan|myanmar|vietnam|indonesia|malaysia|philippines|thailand|singapore|russia|kazakhstan|uzbekistan|belarus|ukraine|azerbaijan|united-states|mexico|brazil|argentina|colombia|peru|chile|canada|australia|new-zealand|germany|netherlands|turkey');
    $known = in_array($m[1], $locations, true);
}
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
if (!$known) {
    http_response_code(404); header('X-Robots-Tag: noindex');
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found — Narmada Mobility</title></head><body><h1>Page not found</h1><a href="/products">Browse products</a></body></html>';
    exit;
}
$private = preg_match('~^/(?:admin|team|delhi|customer|cart|checkout|order-confirmation)~', $path);
if ($private) header('X-Robots-Tag: noindex');
$html = (string) file_get_contents(__DIR__ . '/index.html');
$canonical = 'https://narmadamobility.com' . ($path === '/' ? '/' : rtrim($path, '/'));
$html = preg_replace('~<link rel="canonical"[^>]*>~', '<link rel="canonical" href="' . htmlspecialchars($canonical, ENT_QUOTES, 'UTF-8') . '">', $html);
if ($private) $html = str_replace('</head>', '<meta name="robots" content="noindex,follow"></head>', $html);
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') echo $html;
