<?php
// R28.18 — fixed, read-only GoDaddy -> Render blog bridge. Requires PHP 7.4+ + cURL.
// No credentials, request bodies, cookies or write APIs are forwarded.
declare(strict_types=1);

header('X-Content-Type-Options: nosniff');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
header('Cache-Control: no-store');
function fail_blog(int $status, string $message): void {
    http_response_code($status);
    header('Content-Type: text/html; charset=utf-8');
    header('X-Robots-Tag: noindex');
    if ($status === 503) header('Retry-After: 60');
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') {
        echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Narmada Mobility Insights</title></head><body><h1>' .
            htmlspecialchars($message, ENT_QUOTES, 'UTF-8') . '</h1><p>Please try again shortly.</p><a href="/">Narmada Mobility home</a></body></html>';
    }
    exit;
}
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET' && $method !== 'HEAD') {
    header('Allow: GET, HEAD');
    fail_blog(405, 'Read-only resource');
}
$uri = $_SERVER['REQUEST_URI'] ?? '';
if (strlen($uri) > 800) fail_blog(414, 'Address too long');
$path = parse_url($uri, PHP_URL_PATH);
if (!is_string($path)) fail_blog(404, 'Article not found');
$isXml = $path === '/sitemap-blog.xml';
if (!$isXml && !preg_match('~^/blog(?:/[a-z0-9][a-z0-9_-]{0,149})?/?$~D', $path)) fail_blog(404, 'Article not found');
$path = rtrim($path, '/');
$query = [];
if ($path === '/blog') {
    foreach (['q' => 100, 'category' => 60] as $name => $max) {
        if (isset($_GET[$name]) && is_string($_GET[$name])) $query[$name] = substr($_GET[$name], 0, $max);
    }
    if (isset($_GET['page']) && is_string($_GET['page']) && preg_match('/^[1-9][0-9]{0,3}$/D', $_GET['page'])) $query['page'] = $_GET['page'];
}
$upstreamPath = $isXml ? '/public-blog/sitemap.xml' : '/public-blog/html' . substr($path, 5);
$url = 'https://narmada-backend.onrender.com' . $upstreamPath . ($query ? '?' . http_build_query($query) : '');
$type = $isXml ? 'application/xml; charset=utf-8' : 'text/html; charset=utf-8';
// Only unfiltered successful resources cache for 30 seconds; never serve stale on errors.
// Cache lives outside public_html, in a per-install private directory.
$cacheable = !$query;
$cacheDir = sys_get_temp_dir() . '/nm-blog-' . substr(hash('sha256', __DIR__), 0, 16);
$cacheFile = $cacheDir . '/' . hash('sha256', $url) . '.json';
if ($cacheable && is_file($cacheFile) && !is_link($cacheFile) && filesize($cacheFile) < 2200000 && filemtime($cacheFile) > time() - 30) {
    $cached = json_decode((string) file_get_contents($cacheFile), true);
    if (is_array($cached) && isset($cached['body']) && is_string($cached['body'])) {
        header('Content-Type: ' . $type);
        header('X-Narmada-Blog-Bridge: R28.18-cache');
        if ($method !== 'HEAD') echo $cached['body'];
        exit;
    }
}
if (!function_exists('curl_init')) fail_blog(503, 'Insights temporarily unavailable');
$body = '';
$curl = curl_init($url);
curl_setopt_array($curl, [
    CURLOPT_RETURNTRANSFER => false,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
    CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
    CURLOPT_CONNECTTIMEOUT => 8,
    CURLOPT_TIMEOUT => 25,
    CURLOPT_ENCODING => '',
    CURLOPT_HTTPHEADER => ['Accept: ' . ($isXml ? 'application/xml' : 'text/html')],
    CURLOPT_USERAGENT => 'NarmadaMobilityBlogBridge/28.18',
    CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use (&$body): int {
        if (strlen($body) + strlen($chunk) > 2000000) return 0;
        $body .= $chunk;
        return strlen($chunk);
    },
]);
$ok = curl_exec($curl);
$status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
$upstreamType = (string) curl_getinfo($curl, CURLINFO_CONTENT_TYPE);
curl_close($curl);
if ($ok === false || !in_array($status, [200, 404], true) ||
    stripos($upstreamType, $isXml ? 'xml' : 'text/html') === false ||
    !preg_match($isXml ? '/^\s*<\?xml/' : '/^\s*<!doctype html/i', $body)) fail_blog(503, 'Insights temporarily unavailable');
if ($status === 200 && $cacheable) {
    if (!is_dir($cacheDir)) @mkdir($cacheDir, 0700, true);
    if (is_dir($cacheDir) && !is_link($cacheDir)) {
        // Locked write; failed/partial writes are ignored by the JSON parser on subsequent reads.
        @file_put_contents($cacheFile, json_encode(['body' => $body], JSON_UNESCAPED_SLASHES), LOCK_EX);
        @chmod($cacheFile, 0600);
    }
}
http_response_code($status);
header('Content-Type: ' . $type);
header('X-Narmada-Blog-Bridge: R28.18-live');
if ($status === 404) header('X-Robots-Tag: noindex');
if ($method !== 'HEAD') echo $body;
