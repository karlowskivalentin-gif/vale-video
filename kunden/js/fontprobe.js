// Schrift-Technik für die Fonts-Abteilung — bewusst getrennt von der View,
// weil hier DOM-Seiteneffekte im <head> passieren und im Browser gemessen wird.
// Die View (js/views/admin-fonts.js) kümmert sich nur ums Darstellen.
//
// Zwei Quellen für eine Vorschau:
//   quelle="google" → Stylesheet von fonts.googleapis.com nachladen
//   quelle="lokal"  → nichts laden, direkt mit font-family rendern; klappt nur,
//                     wo die Schrift wirklich installiert ist (PC ≠ MacBook)

// „Bebas Neue“ → „bebas-neue“ (für data-Attribute und Dedup)
export function slugify(name) {
  return String(name || "")
    .trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// „Bebas Neue“ → „Bebas+Neue“ (Parameter der Google-Fonts-CSS-API)
export function googleFamilyParam(name) {
  return String(name || "").trim().replace(/\s+/g, "+");
}

// CSS-Wert für font-family, inkl. Fallback — der Fallback ist wichtig: er macht
// sichtbar (und messbar), wenn die Wunschschrift gar nicht da ist.
// Einfache Anführungszeichen mit Absicht: so überlebt der Wert auch ein
// style="…"-Attribut, ohne auf korrektes Escaping angewiesen zu sein.
export function familienStack(familie) {
  const f = saubererName(familie);
  if (!f) return "var(--font)";
  return `'${f}', sans-serif`;
}

// Anführungszeichen aus dem Namen werfen — sie hätten in CSS nichts zu suchen
// und würden den font-Wert zerlegen.
function saubererName(familie) {
  return String(familie || "").replace(/['"]/g, "").trim();
}

// Ein Google-Stylesheet in den <head> hängen, pro Familie nur einmal.
// gewichte: "400;700" (leer → 400;700 als brauchbarer Standard)
// Liefert ein Promise, das erst erfüllt ist, wenn das Stylesheet wirklich im
// Dokument steht. Das ist wichtig: vorher kennt document.fonts die Familie
// nicht, und jede Messung würde fälschlich „nicht da“ melden.
const _bereit = new Map();   // slug → Promise

export function ladeGoogleFont(familie, gewichte) {
  const slug = slugify(familie);
  if (!slug) return Promise.resolve();
  if (_bereit.has(slug)) return _bereit.get(slug);

  const w = String(gewichte || "").replace(/[^0-9;]/g, "") || "400;700";
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.setAttribute("data-vvfont", slug);
  link.href = `https://fonts.googleapis.com/css2?family=${googleFamilyParam(familie)}:wght@${w}&display=swap`;

  // Auch der Fehlerfall erfüllt das Promise — eine Familie, die Google nicht
  // kennt, soll die Anzeige nicht blockieren, sondern als fehlend erscheinen.
  const p = new Promise((fertig) => {
    link.addEventListener("load", fertig, { once: true });
    link.addEventListener("error", fertig, { once: true });
  });
  _bereit.set(slug, p);
  document.head.appendChild(link);
  return p;
}

// Nachgeladene Google-Stylesheets wieder entfernen. Ohne Argument fliegt alles
// raus — so ruft der Router es über beiViewWechsel() auf, sonst wüchse der
// <head> bei jedem Besuch. Mit einer Slug-Liste bleiben die genannten stehen
// (nach dem Neuzeichnen: behalten, was noch in der Sammlung ist).
export function raeumeGoogleFonts(behalten) {
  const bleibt = behalten ? new Set(behalten) : null;
  document.head.querySelectorAll("link[data-vvfont]").forEach((l) => {
    const slug = l.getAttribute("data-vvfont");
    if (bleibt && bleibt.has(slug)) return;
    l.remove();
    _bereit.delete(slug);
  });
}

// Wartet, bis eine Google-Schrift wirklich gezeichnet werden kann.
// Scheitert bewusst leise: eine nicht existierende Familie soll nur „nicht da“
// bedeuten, nicht die ganze View aufhalten.
export function warteAufFont(familie) {
  const f = saubererName(familie);
  if (!document.fonts || !f) return Promise.resolve();
  return document.fonts.load(`400 24px '${f}'`)
    .then(() => document.fonts.ready)
    .catch(() => {});
}

// Ist die Schrift auf DIESEM Rechner verfügbar (installiert oder geladen)?
// Canvas-Breitenvergleich: derselbe Probetext einmal in einer generischen
// Basis-Schrift, einmal mit der Wunschschrift davor. Weicht die Breite ab,
// wurde die Wunschschrift benutzt — sonst ist der Fallback eingesprungen.
// Robuster als document.fonts.check() allein, das bei Systemschriften je nach
// Browser unterschiedlich streng antwortet.
const PROBE = "mmmwwwiiiWWM0OQ@ÄÖÜß";
let _mess = null;

export function istInstalliert(familie) {
  const f = saubererName(familie);
  if (!f) return false;

  if (!_mess) _mess = document.createElement("canvas").getContext("2d");
  const c = _mess;
  if (!c) return false;

  return ["monospace", "serif", "sans-serif"].some((basis) => {
    c.font = `72px ${basis}`;
    const ohne = c.measureText(PROBE).width;
    c.font = `72px '${f}', ${basis}`;
    const mit = c.measureText(PROBE).width;
    return Math.abs(mit - ohne) > 0.5;
  });
}
