// Prueft die portierte Roadmap-Logik gegen die Referenz-Implementierung aus
// dem Prototyp (vale-video-dashboard.html). Beide muessen fuer jeden Tag und
// jeden Haken-Zustand dasselbe liefern — sonst ist bei der Portierung etwas
// verrutscht.
//
//   node tools/roadmap-check.mjs
import { PHASES } from "../kunden/js/roadmap-data.js";
import { aktuellePhase, phaseFortschritt, naechsterSchritt, phaseItems,
         gesamtFortschritt, tageBis, strahlPos } from "../kunden/js/roadmap-logik.js";

const TAG = 86400000;

// --- Referenz, 1:1 aus dem Prototyp -----------------------------------
const refItems = (p) => p.groups.flatMap((g) => g[1]);
function refPhase(today) {
  for (const p of PHASES) { if (today >= new Date(p.from) && today <= new Date(p.to)) return p; }
  return today < new Date(PHASES[0].from) ? PHASES[0] : PHASES[PHASES.length - 1];
}
function refProgress(p, done) {
  const it = refItems(p);
  return [it.filter((i) => done[i[0]]).length, it.length];
}
function refNext(done, today) {
  const cur = refPhase(today);
  for (const p of PHASES) {
    if (PHASES.indexOf(p) < PHASES.indexOf(cur)) {
      const open = refItems(p).find((i) => !done[i[0]]);
      if (open) return [open, p, true];
    }
  }
  const open = refItems(cur).find((i) => !done[i[0]]);
  if (open) return [open, cur, false];
  for (const p of PHASES) { const o = refItems(p).find((i) => !done[i[0]]); if (o) return [o, p, false]; }
  return null;
}
const refDaysTo = (d, today) => Math.max(0, Math.ceil((d - today) / TAG));

// --- Vergleich ---------------------------------------------------------
const alleIds = PHASES.flatMap(refItems).map((i) => i[0]);
let geprueft = 0, fehler = 0;
const meld = (m) => { console.log("  FEHLER:", m); fehler++; };

// Streuung: verschiedene Haken-Zustaende
const zustaende = [
  {},                                                        // nichts erledigt
  Object.fromEntries(alleIds.map((id) => [id, true])),       // alles erledigt
  Object.fromEntries(alleIds.slice(0, 5).map((id) => [id, true])),
  Object.fromEntries(alleIds.filter((_, i) => i % 3 === 0).map((id) => [id, true])),
  // Luecke in Phase 1, Phase 2 teilweise erledigt -> "offen aus" muss greifen
  Object.fromEntries(alleIds.filter((id) => !id.startsWith("p1-") || id !== "p1-ust").map((id) => [id, true]))
];

for (let t = new Date(2026, 5, 1); t < new Date(2029, 0, 1); t = new Date(t.getTime() + 7 * TAG)) {
  const tag = new Date(t); tag.setHours(0, 0, 0, 0);
  for (const done of zustaende) {
    geprueft++;
    const a = aktuellePhase(tag), b = refPhase(tag);
    if (a.id !== b.id) meld(`Phase ${tag.toISOString().slice(0, 10)}: ${a.id} vs ${b.id}`);

    const [pa, ga] = phaseFortschritt(a, done), [pb, gb] = refProgress(b, done);
    if (pa !== pb || ga !== gb) meld(`Fortschritt ${tag.toISOString().slice(0, 10)}: ${pa}/${ga} vs ${pb}/${gb}`);

    const na = naechsterSchritt(done, tag), nb = refNext(done, tag);
    if ((na === null) !== (nb === null)) meld(`naechster Schritt null-Abweichung ${tag.toISOString().slice(0, 10)}`);
    else if (na && (na[0][0] !== nb[0][0] || na[1].id !== nb[1].id || na[2] !== nb[2])) {
      meld(`naechster Schritt ${tag.toISOString().slice(0, 10)}: ${na[0][0]}/${na[2]} vs ${nb[0][0]}/${nb[2]}`);
    }
    if (tageBis(new Date("2027-12-31"), tag) !== refDaysTo(new Date("2027-12-31"), tag)) {
      meld(`tageBis ${tag.toISOString().slice(0, 10)}`);
    }
  }
}

// --- Eigenschaften, die unabhaengig von der Referenz gelten muessen ----
const leer = {}, voll = Object.fromEntries(alleIds.map((id) => [id, true]));
if (gesamtFortschritt(leer) !== 0) meld("gesamtFortschritt leer != 0");
if (gesamtFortschritt(voll) !== 100) meld("gesamtFortschritt voll != 100");
if (naechsterSchritt(voll, new Date(2026, 8, 15)) !== null) meld("alles erledigt -> naechster Schritt muss null sein");
if (strahlPos(new Date("2026-09-01"), new Date("2026-09-01"), new Date("2027-12-31")) !== 0) meld("strahlPos Start != 0");
if (strahlPos(new Date("2027-12-31"), new Date("2026-09-01"), new Date("2027-12-31")) !== 100) meld("strahlPos Ziel != 100");
if (strahlPos(new Date("2025-01-01"), new Date("2026-09-01"), new Date("2027-12-31")) !== 0) meld("strahlPos vor Start muss 0 sein");
if (strahlPos(new Date("2030-01-01"), new Date("2026-09-01"), new Date("2027-12-31")) !== 100) meld("strahlPos nach Ziel muss 100 sein");

// Ueberfaelliger Punkt aus einer frueheren Phase muss Vorrang haben.
const nurP1Luecke = Object.fromEntries(alleIds.map((id) => [id, id !== "p1-ust"]));
const ni = naechsterSchritt(nurP1Luecke, new Date(2027, 2, 1));  // waehrend Phase 2
if (!ni || ni[0][0] !== "p1-ust" || ni[2] !== true) meld("ueberfaelliger Punkt aus Phase 1 wird nicht bevorzugt");

// Jedes Item hat vier Felder, jede id ist eindeutig.
const alle = PHASES.flatMap(phaseItems);
if (alle.some((i) => i.length !== 4 || !i[2] || !i[3])) meld("Item ohne Wie/Warum");
if (new Set(alleIds).size !== alleIds.length) meld("doppelte Meilenstein-id");

console.log(`geprueft: ${geprueft} Kombinationen (Woche fuer Woche, 2026-2028) x ${zustaende.length} Zustaende`);
console.log(`Meilensteine: ${alle.length} in ${PHASES.length} Phasen`);
console.log(fehler === 0 ? "ERGEBNIS: identisch zur Referenz, alle Zusicherungen erfuellt"
                         : `ERGEBNIS: ${fehler} Abweichung(en)`);
process.exit(fehler === 0 ? 0 : 1);
