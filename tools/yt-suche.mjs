// YouTube-Suche mit echten Kennzahlen — für den Skill „videografie-lernen“
// (Schritt 5: passendes Video recherchieren). Die normale Websuche liefert
// kaum YouTube-Treffer; die Ergebnisseite selbst enthält sie als JSON
// (ytInitialData). Gelesen wird nur die öffentliche Suchseite, ohne Login.
//
//   node tools/yt-suche.mjs one light setup light direction
//   → je Treffer: Video-ID | Titel | Kanal | Länge | Aufrufe | Alter
//
// Liefert YouTube nichts (Format geändert, gesperrt), ehrlich „unbekannt“
// angeben und auf die Websuche ausweichen — nie Kennzahlen erfinden.
const q = process.argv.slice(2).join(" ").trim();
if (!q) { console.error('Suchbegriff fehlt: node tools/yt-suche.mjs "one light setup"'); process.exit(1); }

const r = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=en&gl=US`, {
  headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
             "Accept-Language": "en-US,en;q=0.9" },
});
const html = await r.text();
const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
if (!m) { console.error(`Keine Treffer lesbar (HTTP ${r.status}).`); process.exit(1); }

const treffer = [];
(function durch(x) {
  if (!x || typeof x !== "object") return;
  if (x.videoRenderer) {
    const v = x.videoRenderer;
    treffer.push([
      v.videoId,
      (v.title?.runs || []).map((t) => t.text).join(""),
      v.ownerText?.runs?.[0]?.text,
      v.lengthText?.simpleText,
      v.viewCountText?.simpleText,
      v.publishedTimeText?.simpleText,
    ].map((s) => s || "unbekannt").join(" | "));
    return;
  }
  for (const k in x) durch(x[k]);
})(JSON.parse(m[1]));

console.log(treffer.slice(0, 15).join("\n") || "Keine Videos gefunden.");
console.log("\nLink: https://www.youtube.com/watch?v=<Video-ID>");
