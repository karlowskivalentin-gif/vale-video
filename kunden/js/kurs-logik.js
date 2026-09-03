// Reine Rechenlogik des Kurses — welches Modul, welche Lektion, wie weit.
//
// Wie roadmap-logik.js bewusst ohne Firebase-Abhaengigkeit, damit sie ohne
// Login durchrechenbar und pruefbar bleibt (tools/kurs-check.mjs).
// Die Funktionen sind 1:1 aus dem Prototyp uebernommen.
import { MODS } from "./kurs-data.js";

// Alle Lektionen ueber alle Module.
export function alleLektionen() {
  return MODS.flatMap((m) => m.lessons);
}

// [erledigt, gesamt] eines Moduls.
export function modulFortschritt(m, done) {
  return [m.lessons.filter((l) => done[l[0]]).length, m.lessons.length];
}

// Ist ein Modul vollstaendig abgehakt?
export function modulFertig(m, done) {
  const [n, g] = modulFortschritt(m, done);
  return g > 0 && n === g;
}

// In welchem Modul stecken wir gerade? Vor dem Start: das erste, danach: das
// letzte — damit die View nie ohne Modul dasteht.
export function aktuellesModul(tag) {
  for (const m of MODS) {
    if (tag >= new Date(m.from) && tag <= new Date(m.to)) return m;
  }
  return tag < new Date(MODS[0].from) ? MODS[0] : MODS[MODS.length - 1];
}

// Die eine Lektion, die als Naechstes dran ist. Offene aus FRUEHEREN Modulen
// haben Vorrang und werden gekennzeichnet.
// Rueckgabe: [lektion, modul, ueberfaellig] oder null, wenn alles erledigt.
export function naechsteLektion(done, tag) {
  const cur = aktuellesModul(tag);
  const curIdx = MODS.indexOf(cur);
  for (const m of MODS) {
    if (MODS.indexOf(m) < curIdx) {
      const offen = m.lessons.find((l) => !done[l[0]]);
      if (offen) return [offen, m, true];
    }
  }
  const offen = cur.lessons.find((l) => !done[l[0]]);
  if (offen) return [offen, cur, false];
  for (const m of MODS) {
    const x = m.lessons.find((l) => !done[l[0]]);
    if (x) return [x, m, false];
  }
  return null;
}

// Anteil erledigter Lektionen ueber den ganzen Kurs, in Prozent. Wird auch
// von der Roadmap-View fuer ihren Kurs-Zaehler benutzt.
export function kursProzent(done) {
  const alle = alleLektionen();
  if (!alle.length) return 0;
  return Math.round((alle.filter((l) => done[l[0]]).length / alle.length) * 100);
}

// [erledigte Lektionen, gesamt] ueber den ganzen Kurs.
export function kursLektionen(done) {
  const alle = alleLektionen();
  return [alle.filter((l) => done[l[0]]).length, alle.length];
}

// Wie viele Module sind komplett durch?
export function fertigeModule(done) {
  return MODS.filter((m) => modulFertig(m, done)).length;
}

// Suchbegriff -> YouTube-Suchergebnisseite. BEWUSST eine Suche und keine
// Video-ID: eine feste ID ist in einem Jahr tot, die Suche nicht.
export function ytSuche(begriff) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(begriff)}`;
}
