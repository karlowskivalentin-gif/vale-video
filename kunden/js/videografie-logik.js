// Reine Rechenlogik des Videografie-Lernstands — welches Thema, wie weit,
// was ist passiert.
//
// Wie roadmap-logik.js bewusst ohne Firebase-Abhängigkeit: dieselben
// Funktionen nutzen die View (views/admin-lernen.js), Claudes Werkzeug
// (tools/lernstand.mjs) und die Prüfung (tools/lernstand-check.mjs).
//
// Der Lernstand ist EIN Dokument lernen/<schlüssel> (Aufbau in
// tools/lernstand.mjs, Kopf). Alle Datumsangaben sind ISO-Strings
// („2026-10-06“ bzw. mit Uhrzeit) — die schreibt Claude per REST genauso wie
// das Portal, ohne Firestore-Timestamps.
import { LEHRPLAN } from "./videografie-data.js";

export const STATUS = ["offen", "in_arbeit", "erledigt"];

// Alle Themen über alle Module, flach, mit Modul-Verweis.
export function alleThemen() {
  return LEHRPLAN.flatMap((m) =>
    m.themen.map(([id, titel, kannst]) => ({ id, titel, kannst, modul: m })));
}

export function themaInfo(id) {
  return alleThemen().find((t) => t.id === id) || null;
}

export function statusVon(stand, id) {
  const s = stand && stand.themen && stand.themen[id] && stand.themen[id].status;
  return STATUS.includes(s) ? s : "offen";
}

// { erledigt, inArbeit, gesamt, prozent } über den ganzen Lehrplan.
// Prozent zählt nur Erledigtes — „in Arbeit“ ist noch nicht gekonnt.
export function fortschritt(stand) {
  const alle = alleThemen();
  const erledigt = alle.filter((t) => statusVon(stand, t.id) === "erledigt").length;
  const inArbeit = alle.filter((t) => statusVon(stand, t.id) === "in_arbeit").length;
  return { erledigt, inArbeit, gesamt: alle.length,
           prozent: alle.length ? Math.round((erledigt / alle.length) * 100) : 0 };
}

// [erledigt, gesamt] eines Moduls.
export function modulFortschritt(stand, modul) {
  return [modul.themen.filter(([id]) => statusVon(stand, id) === "erledigt").length,
          modul.themen.length];
}

// Woran wird gerade gearbeitet? Reihenfolge: ausdrücklich gesetztes
// `aktuell` (solange nicht erledigt) → erstes Thema „in Arbeit“ → erstes
// offenes. null, wenn alles erledigt ist.
export function aktuellesThema(stand) {
  const alle = alleThemen();
  const gesetzt = stand && stand.aktuell && themaInfo(stand.aktuell);
  if (gesetzt && statusVon(stand, gesetzt.id) !== "erledigt") return gesetzt;
  return alle.find((t) => statusVon(stand, t.id) === "in_arbeit")
      || alle.find((t) => statusVon(stand, t.id) === "offen")
      || null;
}

// Das nächste offene Thema NACH dem aktuellen (für „danach kommt …“).
export function naechstesThema(stand) {
  const alle = alleThemen();
  const cur = aktuellesThema(stand);
  const ab = cur ? alle.indexOf(alle.find((t) => t.id === cur.id)) + 1 : 0;
  return alle.slice(ab).find((t) => statusVon(stand, t.id) === "offen") || null;
}

// Die offene Übung (die jüngste mit status „offen“) oder null. Eine neue
// Übung setzt eine noch offene alte auf „ersetzt“ — es gibt nie zwei offene.
export function offeneUebung(stand) {
  const liste = (stand && stand.uebungen) || [];
  for (let i = liste.length - 1; i >= 0; i--) {
    if (liste[i] && liste[i].status === "offen") return liste[i];
  }
  return null;
}

// Videos eines Themas, Hauptvideo zuerst, dann in der Reihenfolge des Eintrags.
export function videosZuThema(stand, id) {
  const liste = ((stand && stand.videos) || []).filter((v) => v && v.thema === id);
  return liste.sort((a, b) => (a.rolle === "haupt" ? 0 : 1) - (b.rolle === "haupt" ? 0 : 1));
}

// Die Kennzahlen für die Zählerreihe.
export function zahlen(stand) {
  const videos = (stand && stand.videos) || [];
  const quiz = (stand && stand.quiz) || [];
  const richtig = quiz.reduce((s, q) => s + (Number(q.richtig) || 0), 0);
  const gesamt = quiz.reduce((s, q) => s + (Number(q.gesamt) || 0), 0);
  return {
    videosGesehen: videos.filter((v) => v.gesehen).length,
    videosGesamt: videos.length,
    uebungenErledigt: ((stand && stand.uebungen) || []).filter((u) => u.status === "erledigt").length,
    quizQuote: gesamt ? Math.round((richtig / gesamt) * 100) : null,
    quizFragen: gesamt,
    praxis: ((stand && stand.praxis) || []).length,
    schwachstellenOffen: ((stand && stand.schwachstellen) || []).filter((s) => !s.erledigt_am).length,
  };
}

// YouTube-ID aus watch?v=, youtu.be/, /shorts/, /embed/, /live/. Sonst null.
export function ytId(url) {
  if (!url || typeof url !== "string") return null;
  const m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

export function ytBild(url) {
  const id = ytId(url);
  return id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null;
}

// Nur der Tag eines ISO-Strings („2026-10-06T21:10…“ → „2026-10-06“).
export function tagVon(iso) {
  return typeof iso === "string" && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null;
}

// Lokales Datum als „YYYY-MM-DD“ (nicht UTC — sonst springt der Tag nachts).
export function isoTag(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Alles, was passiert ist, als eine Zeitleiste — jüngstes zuerst.
// Jeder Eintrag: { tag, art, text, thema }.
export function verlauf(stand) {
  if (!stand) return [];
  const ev = [];
  const name = (id) => { const t = themaInfo(id); return t ? `${t.id} ${t.titel}` : ""; };
  for (const l of stand.log || []) {
    if (tagVon(l.datum)) ev.push({ tag: tagVon(l.datum), art: "log", text: l.text || "", thema: l.thema || null });
  }
  for (const q of stand.quiz || []) {
    if (tagVon(q.datum)) ev.push({ tag: tagVon(q.datum), art: "quiz",
      text: `Abfrage ${q.richtig}/${q.gesamt} richtig${q.thema ? ` · ${name(q.thema)}` : ""}`, thema: q.thema || null });
  }
  for (const u of stand.uebungen || []) {
    if (tagVon(u.gegeben_am)) ev.push({ tag: tagVon(u.gegeben_am), art: "uebung", text: `Übung bekommen: ${u.titel || ""}`, thema: u.thema || null });
    if (u.status === "erledigt" && tagVon(u.erledigt_am)) {
      ev.push({ tag: tagVon(u.erledigt_am), art: "uebung-fertig", text: `Übung erledigt: ${u.titel || ""}`, thema: u.thema || null });
    }
  }
  for (const v of stand.videos || []) {
    if (v.rolle === "haupt" && tagVon(v.datum)) {
      ev.push({ tag: tagVon(v.datum), art: "video", text: `Video: ${v.titel || ""}${v.kanal ? ` (${v.kanal})` : ""}`, thema: v.thema || null });
    }
  }
  for (const p of stand.praxis || []) {
    if (tagVon(p.datum)) ev.push({ tag: tagVon(p.datum), art: "praxis",
      text: `Praxis: ${p.titel || ""}${p.kunde ? ` · ${p.kunde}` : ""}`, thema: (p.themen || [])[0] || null });
  }
  for (const [id, t] of Object.entries(stand.themen || {})) {
    if (t && t.status === "erledigt" && tagVon(t.erledigt_am)) {
      ev.push({ tag: tagVon(t.erledigt_am), art: "thema", text: `Thema erledigt: ${name(id)}`, thema: id });
    }
  }
  // Stabil nach Tag absteigend; innerhalb eines Tages bleibt die Reihenfolge
  // der Arten wie oben (Log zuerst).
  return ev.map((e, i) => [e, i]).sort((a, b) => (a[0].tag < b[0].tag ? 1 : a[0].tag > b[0].tag ? -1 : a[1] - b[1])).map(([e]) => e);
}

// Lern-Aktivität je Tag (für die Kalender-Kacheln): { "YYYY-MM-DD": anzahl }.
export function aktivitaet(stand) {
  const z = {};
  for (const e of verlauf(stand)) z[e.tag] = (z[e.tag] || 0) + 1;
  return z;
}

// Die letzten `wochen` Wochen als Spalten (Mo–So), endend mit der Woche von
// `heute`. Rückgabe: Array von Wochen, jede ein Array aus 7 Tagen
// { tag, anzahl, zukunft }.
export function aktivitaetsRaster(stand, heute = new Date(), wochen = 12) {
  const z = aktivitaet(stand);
  const h = new Date(heute.getFullYear(), heute.getMonth(), heute.getDate());
  const wt = (h.getDay() + 6) % 7;                 // Mo = 0
  const start = new Date(h); start.setDate(h.getDate() - wt - (wochen - 1) * 7);
  const raster = [];
  for (let w = 0; w < wochen; w++) {
    const spalte = [];
    for (let d = 0; d < 7; d++) {
      const t = new Date(start); t.setDate(start.getDate() + w * 7 + d);
      const tag = isoTag(t);
      spalte.push({ tag, anzahl: z[tag] || 0, zukunft: t > h });
    }
    raster.push(spalte);
  }
  return raster;
}

// Wie viele Tage seit dem letzten Eintrag? null, wenn noch nie.
export function tageSeitLetztem(stand, heute = new Date()) {
  const v = verlauf(stand);
  if (!v.length) return null;
  const [y, m, d] = v[0].tag.split("-").map(Number);
  const letzter = new Date(y, m - 1, d);
  const h = new Date(heute.getFullYear(), heute.getMonth(), heute.getDate());
  return Math.round((h - letzter) / 86400000);
}
