// Prueft die portierte Kurs-Logik gegen die Referenz-Implementierung aus
// vale-video-kurs.html. Gleiches Vorgehen wie tools/roadmap-check.mjs.
//
//   node tools/kurs-check.mjs
import { MODS, NORDSTERN, LISTEN_HINWEIS } from "../kunden/js/kurs-data.js";
import { aktuellesModul, naechsteLektion, modulFortschritt, alleLektionen,
         kursProzent, kursLektionen, fertigeModule, ytSuche } from "../kunden/js/kurs-logik.js";

const TAG = 86400000;

// --- Referenz, 1:1 aus dem Prototyp -----------------------------------
const refAll = () => MODS.flatMap((m) => m.lessons);
const refModProg = (m, done) => [m.lessons.filter((l) => done[l[0]]).length, m.lessons.length];
function refCurrentMod(today) {
  for (const m of MODS) { if (today >= new Date(m.from) && today <= new Date(m.to)) return m; }
  return today < new Date(MODS[0].from) ? MODS[0] : MODS[MODS.length - 1];
}
function refNextLesson(done, today) {
  const cur = refCurrentMod(today);
  for (const m of MODS) {
    if (MODS.indexOf(m) < MODS.indexOf(cur)) {
      const o = m.lessons.find((l) => !done[l[0]]);
      if (o) return [o, m, true];
    }
  }
  const o = cur.lessons.find((l) => !done[l[0]]);
  if (o) return [o, cur, false];
  for (const m of MODS) { const x = m.lessons.find((l) => !done[l[0]]); if (x) return [x, m, false]; }
  return null;
}
const refYt = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;

// --- Vergleich ---------------------------------------------------------
const alleIds = refAll().map((l) => l[0]);
let geprueft = 0, fehler = 0;
const meld = (m) => { console.log("  FEHLER:", m); fehler++; };

const zustaende = [
  {},
  Object.fromEntries(alleIds.map((id) => [id, true])),
  Object.fromEntries(alleIds.slice(0, 7).map((id) => [id, true])),
  Object.fromEntries(alleIds.filter((_, i) => i % 4 === 0).map((id) => [id, true])),
  // Luecke im ersten Modul, spaetere erledigt -> "offen aus frueherem Modul"
  Object.fromEntries(alleIds.filter((id) => id !== "m1-2").map((id) => [id, true]))
];

for (let t = new Date(2026, 5, 1); t < new Date(2029, 0, 1); t = new Date(t.getTime() + 7 * TAG)) {
  const tag = new Date(t); tag.setHours(0, 0, 0, 0);
  const d = tag.toISOString().slice(0, 10);
  for (const done of zustaende) {
    geprueft++;
    const a = aktuellesModul(tag), b = refCurrentMod(tag);
    if (a.id !== b.id) meld(`Modul ${d}: ${a.id} vs ${b.id}`);

    const [pa, ga] = modulFortschritt(a, done), [pb, gb] = refModProg(b, done);
    if (pa !== pb || ga !== gb) meld(`Modulfortschritt ${d}: ${pa}/${ga} vs ${pb}/${gb}`);

    const na = naechsteLektion(done, tag), nb = refNextLesson(done, tag);
    if ((na === null) !== (nb === null)) meld(`naechste Lektion null-Abweichung ${d}`);
    else if (na && (na[0][0] !== nb[0][0] || na[1].id !== nb[1].id || na[2] !== nb[2])) {
      meld(`naechste Lektion ${d}: ${na[0][0]}/${na[2]} vs ${nb[0][0]}/${nb[2]}`);
    }
  }
}

// --- Eigenschaften -----------------------------------------------------
const leer = {}, voll = Object.fromEntries(alleIds.map((id) => [id, true]));
if (kursProzent(leer) !== 0) meld("kursProzent leer != 0");
if (kursProzent(voll) !== 100) meld("kursProzent voll != 100");
if (fertigeModule(leer) !== 0) meld("fertigeModule leer != 0");
if (fertigeModule(voll) !== MODS.length) meld("fertigeModule voll != " + MODS.length);
const [ld, lg] = kursLektionen(voll);
if (ld !== lg || lg !== alleIds.length) meld("kursLektionen voll falsch");
if (naechsteLektion(voll, new Date(2026, 8, 15)) !== null) meld("alles erledigt -> null erwartet");

// Modul komplett -> zaehlt als abgeschlossen, aber nur dieses eine
const nurM1 = Object.fromEntries(MODS[0].lessons.map((l) => [l[0], true]));
if (fertigeModule(nurM1) !== 1) meld("nur M1 erledigt -> fertigeModule muss 1 sein");

// Ueberfaellige Lektion aus Modul 1 hat Vorrang (geprueft waehrend Modul 3)
const luecke = Object.fromEntries(alleIds.map((id) => [id, id !== "m1-2"]));
const nl = naechsteLektion(luecke, new Date(2027, 0, 15));
if (!nl || nl[0][0] !== "m1-2" || nl[2] !== true) meld("ueberfaellige Lektion aus M1 wird nicht bevorzugt");

// Daten-Zusicherungen
const alle = alleLektionen();
if (alle.length !== 36) meld(`erwartet 36 Lektionen, gefunden ${alle.length}`);
if (MODS.length !== 8) meld(`erwartet 8 Module, gefunden ${MODS.length}`);
if (new Set(alleIds).size !== alleIds.length) meld("doppelte Lektions-id");
alle.forEach((l) => {
  if (l.length !== 5) meld(`${l[0]}: erwartet 5 Felder, hat ${l.length}`);
  if (!l[2] || !l[3]) meld(`${l[0]}: Lernen oder Check fehlt`);
  if (!Array.isArray(l[4]) || !l[4].length) meld(`${l[0]}: keine Suchbegriffe`);
});
MODS.forEach((m) => { if (!m.ziel || !m.wann || !m.from || !m.to) meld(`${m.id}: Kopfdaten unvollstaendig`); });
if (!NORDSTERN || NORDSTERN.length < 100) meld("NORDSTERN fehlt oder zu kurz");
if (!LISTEN_HINWEIS) meld("LISTEN_HINWEIS fehlt");

// YouTube-Links: identisch zur Referenz, korrekt kodiert, kein hartkodiertes Video
let links = 0;
alle.forEach((l) => l[4].forEach((q) => {
  links++;
  const u = ytSuche(q);
  if (u !== refYt(q)) meld(`Link weicht ab: ${q}`);
  if (!u.startsWith("https://www.youtube.com/results?search_query=")) meld(`kein Suchlink: ${q}`);
  if (/\/watch\?v=/.test(u)) meld(`hartkodierte Video-ID: ${q}`);
  if (decodeURIComponent(u.split("search_query=")[1]) !== q) meld(`Kodierung falsch: ${q}`);
}));

console.log(`geprueft: ${geprueft} Kombinationen (Woche fuer Woche, 2026-2028) x ${zustaende.length} Zustaende`);
console.log(`Inhalte: ${MODS.length} Module, ${alle.length} Lektionen, ${links} YouTube-Suchlinks`);
console.log(fehler === 0 ? "ERGEBNIS: identisch zur Referenz, alle Zusicherungen erfuellt"
                         : `ERGEBNIS: ${fehler} Abweichung(en)`);
process.exit(fehler === 0 ? 0 : 1);
