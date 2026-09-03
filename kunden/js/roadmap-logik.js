// Reine Rechenlogik der Roadmap — welche Phase, welcher Schritt, wie weit.
//
// BEWUSST von der View getrennt: hier wird nichts gezeichnet und nichts
// geladen, deshalb hat diese Datei ausser roadmap-data.js keine Abhaengigkeit
// und laesst sich ohne Firebase durchrechnen (siehe tools/roadmap-check.mjs).
// Die Funktionen sind 1:1 aus dem Prototyp uebernommen.
import { PHASES } from "./roadmap-data.js";

export const TAG_MS = 86400000;

// Zahl mit deutschem Tausenderpunkt: 1250 → "1.250".
export const fmt = (n) => Number(n || 0).toLocaleString("de-DE");

// Heute, auf Mitternacht normiert — sonst springen die Tageszaehler je
// nach Uhrzeit um eins.
export function heute() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Volle Tage bis zu einem Termin, nie negativ (vergangene Termine = 0).
export const tageBis = (ziel, ab) => Math.max(0, Math.ceil((ziel - ab) / TAG_MS));

// Alle Meilensteine einer Phase, Monatsgruppen aufgeloest.
export function phaseItems(p) {
  return p.groups.flatMap((g) => g[1]);
}

// In welcher Phase stecken wir gerade? Vor dem Start: die erste, nach dem
// Ende der letzten: die letzte — damit die View nie ohne Phase dasteht.
export function aktuellePhase(tag) {
  for (const p of PHASES) {
    if (tag >= new Date(p.from) && tag <= new Date(p.to)) return p;
  }
  return tag < new Date(PHASES[0].from) ? PHASES[0] : PHASES[PHASES.length - 1];
}

// [erledigt, gesamt] einer Phase.
export function phaseFortschritt(p, done) {
  const items = phaseItems(p);
  return [items.filter((i) => done[i[0]]).length, items.length];
}

// Anteil erledigter Meilensteine ueber ALLE Phasen, in Prozent.
export function gesamtFortschritt(done) {
  const alle = PHASES.flatMap(phaseItems);
  return Math.round((alle.filter((i) => done[i[0]]).length / alle.length) * 100);
}

// Der eine Schritt, der als Naechstes dran ist. Offene Punkte aus FRUEHEREN
// Phasen haben Vorrang — sie sind ueberfaellig und werden gekennzeichnet.
// Rueckgabe: [item, phase, ueberfaellig] oder null, wenn alles erledigt ist.
export function naechsterSchritt(done, tag) {
  const cur = aktuellePhase(tag);
  const curIdx = PHASES.indexOf(cur);
  for (const p of PHASES) {
    if (PHASES.indexOf(p) < curIdx) {
      const offen = phaseItems(p).find((i) => !done[i[0]]);
      if (offen) return [offen, p, true];
    }
  }
  const offen = phaseItems(cur).find((i) => !done[i[0]]);
  if (offen) return [offen, cur, false];
  for (const p of PHASES) {
    const o = phaseItems(p).find((i) => !done[i[0]]);
    if (o) return [o, p, false];
  }
  return null;
}

// Position auf dem Zeitstrahl in Prozent, geklemmt auf 0–100.
export function strahlPos(d, start, ziel) {
  return Math.min(100, Math.max(0, ((d - start) / (ziel - start)) * 100));
}
