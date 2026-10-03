<?php
// R28.19: fixed read-only catalog/XML bridge. No auth, body, cookies or write API forwarding.
declare(strict_types=1);
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
header('X-Narmada-SEO-Bridge: R28.19');
function seo_fail(int $status, string $message): void {
    http_response_code($status);
    header('Content-Type: text/html; charset=utf-8');
    header('X-Robots-Tag: noindex');
    if ($status === 503) header('Retry-After: 60');
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Narmada Mobility</title></head><body><h1>' . htmlspecialchars($message, ENT_QUOTES, 'UTF-8') . '</h1><a href="/products">Browse products</a> · <a href="/">Home</a></body></html>';
    exit;
}
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if (!in_array($method, ['GET', 'HEAD'], true)) { header('Allow: GET, HEAD'); seo_fail(405, 'Read-only resource'); }
$uri = $_SERVER['REQUEST_URI'] ?? '';
if (strlen($uri) > 1500) seo_fail(414, 'Address too long');
if (substr($uri, 0, 2) === '//') seo_fail(404, 'Page not found');
$path = parse_url($uri, PHP_URL_PATH);
if (!is_string($path) || preg_match('/[\x00-\x1f\\\\]/', rawurldecode($path)) || strpos(rawurldecode($path), '..') !== false) seo_fail(404, 'Page not found');
$xml = in_array($path, ['/sitemap.xml', '/sitemap-seo.xml', '/sitemap-seo-index.xml'], true);
$robots = $path === '/robots.txt';
$catalog = preg_match('~^/(?:products/?|product/[^/?#]+(?:/[^/?#]+)?/?|p/[^/?#]+/?)$~D', $path);
if (!$xml && !$robots && !$catalog) seo_fail(404, 'Page not found');
$query = [];
if (rtrim($path, '/') === '/products') {
    if (isset($_GET['page'])) {
        if (!is_string($_GET['page']) || !preg_match('/^[1-9][0-9]{0,5}$/D', $_GET['page'])) seo_fail(404, 'Page not found');
        $query['page'] = $_GET['page'];
    }
    // Existing SPA filters remain functional after boot. Server marks filtered variants noindex.
    foreach (['q', 'brand', 'category', 'search', 'model', 'sort'] as $name) {
        if (isset($_GET[$name]) && is_string($_GET[$name])) $query[$name] = substr($_GET[$name], 0, 100);
    }
}
$url = 'https://narmada-backend.onrender.com' . $path . ($query ? '?' . http_build_query($query) : '');
if (!function_exists('curl_init')) seo_fail(503, 'Catalog temporarily unavailable');
$body = ''; $location = '';
$curl = curl_init($url);
curl_setopt_array($curl, [
    CURLOPT_RETURNTRANSFER => false, CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
    CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
    CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_TIMEOUT => 25, CURLOPT_ENCODING => '',
    CURLOPT_HTTPHEADER => ['Accept: ' . ($xml ? 'application/xml' : ($robots ? 'text/plain' : 'text/html'))],
    CURLOPT_USERAGENT => 'NarmadaMobilitySEOBridge/28.19',
    CURLOPT_HEADERFUNCTION => static function ($handle, string $line) use (&$location): int {
        if (stripos($line, 'Location:') === 0) $location = trim(substr($line, 9));
        return strlen($line);
    },
    CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use (&$body): int {
        if (strlen($body) + strlen($chunk) > 8000000) return 0;
        $body .= $chunk; return strlen($chunk);
    },
]);
$ok = curl_exec($curl);
$status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
$type = (string) curl_getinfo($curl, CURLINFO_CONTENT_TYPE);
curl_close($curl);
if ($ok === false) seo_fail(503, 'Catalog temporarily unavailable');
// Relay only backend-generated redirects to our own public canonical routes; never follow them.
if ($status === 301 && preg_match('~^https://narmadamobility\.com/(?:product/[^?#\s]+|sitemap\.xml)$~D', $location)
    && strpos($location, '\\') === false && !preg_match('/%0[ad]/i', $location)) {
    header('Location: ' . $location, true, 301); exit;
}
if (!in_array($status, [200, 404], true) ||
    stripos($type, $xml ? 'xml' : ($robots ? 'text/plain' : 'text/html')) === false ||
    (!$robots && !preg_match($xml ? '/^\s*<\?xml/' : '/^\s*<!doctype html/i', $body)) ||
    ($robots && strpos($body, 'User-agent:') === false)) seo_fail(503, 'Catalog temporarily unavailable');
// A 200 SPA shell is not successful SSR. Catch mismatched/old backend deployment.
if (!$xml && !$robots && $status === 200 && (!preg_match('/<h1[\s>]/i', $body) || strpos($body, 'rel="canonical"') === false)) seo_fail(503, 'Catalog delivery needs a backend update');
http_response_code($status);
header('Content-Type: ' . ($xml ? 'application/xml' : ($robots ? 'text/plain' : 'text/html')) . '; charset=utf-8');
if ($status === 404) header('X-Robots-Tag: noindex');
if ($method !== 'HEAD') echo $body;
