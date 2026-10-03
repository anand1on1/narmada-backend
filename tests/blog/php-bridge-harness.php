<?php
// Offline contract fixture: run with `php -n` (cURL extension MUST NOT load).
// The deployed bridge itself is included unchanged. No network traffic is possible.
if (extension_loaded('curl')) throw new RuntimeException('Run this fixture with php -n');
$names = ['CURLOPT_RETURNTRANSFER', 'CURLOPT_FOLLOWLOCATION', 'CURLOPT_PROTOCOLS', 'CURLOPT_REDIR_PROTOCOLS',
    'CURLOPT_SSL_VERIFYPEER', 'CURLOPT_SSL_VERIFYHOST', 'CURLOPT_CONNECTTIMEOUT', 'CURLOPT_TIMEOUT',
    'CURLOPT_ENCODING', 'CURLOPT_HTTPHEADER', 'CURLOPT_USERAGENT', 'CURLOPT_WRITEFUNCTION', 'CURLPROTO_HTTPS',
    'CURLINFO_HTTP_CODE', 'CURLINFO_CONTENT_TYPE', 'CURLOPT_HEADERFUNCTION'];
foreach ($names as $i => $name) define($name, $i + 1);
function curl_init($url) { $GLOBALS['called_url'] = $url; return 'fixture'; }
function curl_setopt_array($handle, $options) { $GLOBALS['options'] = $options; return true; }
function curl_exec($handle) {
    if (isset($GLOBALS['options'][CURLOPT_HEADERFUNCTION])) $GLOBALS['options'][CURLOPT_HEADERFUNCTION]($handle, 'Location: ' . (getenv('FIXTURE_LOCATION') ?: '') . "\r\n");
    $body = getenv('FIXTURE_BODY') ?: '<!doctype html><html><body><h1>Fixture article</h1></body></html>';
    $result = $GLOBALS['options'][CURLOPT_WRITEFUNCTION]($handle, $body);
    return $result === strlen($body);
}
function curl_getinfo($handle, $key) {
    return $key === CURLINFO_HTTP_CODE ? (int)(getenv('FIXTURE_STATUS') ?: 200) : (getenv('FIXTURE_TYPE') ?: 'text/html');
}
function curl_close($handle) {}
$_SERVER['REQUEST_METHOD'] = getenv('FIXTURE_METHOD') ?: 'GET';
$_SERVER['REQUEST_URI'] = getenv('FIXTURE_URI') ?: '/blog/offline-fixture';
parse_str((string)parse_url($_SERVER['REQUEST_URI'], PHP_URL_QUERY), $_GET);
register_shutdown_function(static function () {
    $o = $GLOBALS['options'] ?? [];
    fwrite(STDERR, json_encode(['status' => http_response_code() ?: 200, 'url' => $GLOBALS['called_url'] ?? null,
        'tls' => $o[CURLOPT_SSL_VERIFYPEER] ?? null, 'redirects' => $o[CURLOPT_FOLLOWLOCATION] ?? null]));
});
$bridge = getenv('FIXTURE_BRIDGE') === 'seo' ? 'seo-bridge.php' : (getenv('FIXTURE_BRIDGE') === 'entry' ? 'site-entry.php' : 'blog-bridge.php');
require dirname(__DIR__, 2) . (getenv('FIXTURE_DIST') === '1' ? '/dist/public/' : '/client/public/') . $bridge;
