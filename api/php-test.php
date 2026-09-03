<?php
// =====================================================================
// V0-GATE — einmaliger Selbsttest, ob dieses Strato-Paket PHP ausfuehrt
// und die drei Bausteine mitbringt, die der Social-Connector braucht.
//
// BENUTZUNG: per SFTP nach /Website_v10/api/ hochladen,
//            https://vale-video.de/api/php-test.php aufrufen,
//            danach SOFORT wieder loeschen.
//
// Zeigt der Browser stattdessen diesen Quelltext, ist PHP fuer die Domain
// nicht aktiv -> Verzweigung im Plan (Cloudflare Workers).
// =====================================================================
header('Content-Type: text/plain; charset=utf-8');

echo 'PHP '        . PHP_VERSION . "\n";
echo 'curl:      ' . (function_exists('curl_init')     ? 'ja' : 'NEIN') . "\n";
echo 'openssl:   ' . (function_exists('openssl_sign')  ? 'ja' : 'NEIN') . "\n";
echo 'json:      ' . (function_exists('json_encode')   ? 'ja' : 'NEIN') . "\n";
echo 'schreiben: ' . (is_writable(__DIR__)             ? 'ja' : 'NEIN') . "\n";
echo 'zeit:      ' . date('Y-m-d H:i:s T') . "\n";

// Ausgehende HTTPS-Verbindung — der haeufigste Stolperstein auf Shared Hosting.
if (function_exists('curl_init')) {
    $ch = curl_init('https://oauth2.googleapis.com/');
    curl_setopt_array($ch, [
        CURLOPT_NOBODY         => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT        => 12,
    ]);
    $ok     = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $fehler = curl_error($ch);
    curl_close($ch);
    echo 'ausgehend: ' . ($ok !== false ? "ja (HTTP $status)" : "NEIN ($fehler)") . "\n";
}
