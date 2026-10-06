// Claudes Werkzeug für den Videografie-Lernstand im Arbeitsportal.
//
// Der Lernstand liegt als JSON in lernen/lernstand.json (dieses Repo,
// versioniert = Verlauf und Backup über GitHub; wird NICHT auf die Website
// deployt). Claude schreibt NUR diese Datei — keine Zugangsdaten, kein
// Firestore. Ins Portal kommt er über das Social-Brain-Cockpit: dessen Seite
// (frontend/pipeline.js, lernstandSync) liest die Datei über GET
// /api/lernstand und schreibt sie unter Vales Admin-Login nach Firestore
// roadmap/videografie — dieselbe Bauweise wie der Content-Kalender. Das
// Portal (Reiter „Lernen“, views/admin-lernen.js) zeigt das Dokument live.
//
// Aufrufe (Pfade relativ zu vale-video/):
//   node tools/lernstand.mjs zeigen            Lernstand als Text (Session-Start)
//   node tools/lernstand.mjs zeigen --json     … als JSON
//   node tools/lernstand.mjs eintragen <datei.json>   Ergebnis einer Session
//   node tools/lernstand.mjs praxis "<titel>" --themen 1.1,2.6 [--kunde X] [--notiz "…"]
//   node tools/lernstand.mjs uebung-erledigt [--notiz "…"]
//   node tools/lernstand.mjs log "<text>" [--thema 1.2]
//   Jeder Schreibbefehl kennt --trocken (zeigt das Ergebnis, schreibt nicht).
//
// Aufbau von <datei.json> für „eintragen“ (alles optional):
//   {
//     "aktuell": "1.2",
//     "themen": { "1.1": "erledigt", "1.2": "in_arbeit" },
//     "uebung_erledigt": { "notiz": "Schatten bei 90° zu hart" },   // oder true
//     "uebung": { "thema": "1.2", "titel": "…", "dauer": "30 min",
//                 "aufbau": ["…"], "filmen": ["…"], "fertig_wenn": ["…"],
//                 "immobilien": "…" },
//     "videos": [ { "thema": "1.2", "titel": "…", "kanal": "…", "url": "https://…",
//                   "laenge": "12:30", "warum": "…", "rolle": "haupt" } ],
//     "video_bewertung": [ { "url": "https://…", "gesehen": true, "bewertung": 4 } ],
//     "quiz": { "thema": "1.1", "richtig": 2, "gesamt": 3, "notiz": "…" },
//     "schwachstellen": [ { "text": "Fill zu nah am Key", "thema": "1.3" } ],
//     "schwachstellen_erledigt": [ "Fill zu nah" ],     // Text-Anfang oder id
//     "praxis": [ { "titel": "Deussen Reel Benrath", "kunde": "Deussen",
//                   "themen": ["1.7", "2.6"], "notiz": "…" } ],
//     "log": "Freitext für die Zeitleiste"
//   }
//
// Aufbau von lernen/lernstand.json:
//   version 1 · aktualisiert (ISO, bei jedem Schreiben neu)
//   aktuell        Thema-ID, an dem gearbeitet wird
//   themen         { "<id>": { status: offen|in_arbeit|erledigt, seit, erledigt_am } }
//   uebungen       [ { id, thema, titel, dauer, aufbau[], filmen[], fertig_wenn[],
//                      immobilien, gegeben_am, status: offen|erledigt|ersetzt,
//                      erledigt_am, notiz } ]
//   videos         [ { id, datum, thema, titel, kanal, url, laenge, warum,
//                      rolle: haupt|alternative, gesehen, bewertung } ]
//   quiz           [ { datum, thema, richtig, gesamt, notiz } ]
//   schwachstellen [ { id, text, thema, seit, erledigt_am } ]
//   praxis         [ { datum, titel, kunde, themen[], notiz } ]
//   log            [ { datum, text, thema } ]
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { LEHRPLAN } from "../kunden/js/videografie-data.js";
import { alleThemen, themaInfo, statusVon, STATUS, fortschritt, aktuellesThema,
         naechstesThema, offeneUebung, zahlen, isoTag, verlauf } from "../kunden/js/videografie-logik.js";

const HIER = dirname(fileURLToPath(import.meta.url));
// LERNSTAND_DATEI nur für tools/lernstand-check.mjs (prüft gegen eine Kopie).
const DATEI = process.env.LERNSTAND_DATEI || join(HIER, "..", "lernen", "lernstand.json");

function fehler(text) {
  console.error(`FEHLER: ${text}`);
  process.exit(1);
}

function laden() {
  let roh;
  try { roh = readFileSync(DATEI, "utf8"); } catch { return null; }
  try { return JSON.parse(roh.replace(/^﻿/, "")); }
  catch (e) { fehler(`lernen/lernstand.json ist kein gültiges JSON (${e.message}) — erst reparieren, nicht überschreiben.`); }
}

// Erst in eine Nachbardatei, dann umbenennen: ein Abbruch mitten im
// Schreiben (SSD abgezogen) hinterlässt nie eine halbe Datei.
function speichern(stand) {
  mkdirSync(dirname(DATEI), { recursive: true });
  const tmp = DATEI + ".tmp";
  writeFileSync(tmp, JSON.stringify(stand, null, 2) + "\n", "utf8");
  renameSync(tmp, DATEI);
}

// --- Bausteine ------------------------------------------------------------
const kurzId = () => randomBytes(4).toString("hex");
const jetzt = () => new Date().toISOString();

function leer() {
  return { version: 1, aktualisiert: jetzt(), aktuell: alleThemen()[0].id,
           themen: {}, uebungen: [], videos: [], quiz: [], schwachstellen: [], praxis: [], log: [] };
}

function normalisiere(s) {
  const n = { ...leer(), ...(s || {}) };
  for (const k of ["uebungen", "videos", "quiz", "schwachstellen", "praxis", "log"]) {
    if (!Array.isArray(n[k])) n[k] = [];
  }
  if (!n.themen || typeof n.themen !== "object") n.themen = {};
  return n;
}

function pruefeThema(id, wo) {
  if (!themaInfo(id)) fehler(`${wo}: unbekanntes Thema „${id}“. Gültig: ${alleThemen().map((t) => t.id).join(", ")}`);
}
function pruefeUrl(url, wo) {
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) fehler(`${wo}: URL fehlt oder ist ungültig („${url}“).`);
}
const liste = (x) => (Array.isArray(x) ? x.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim()) : []);

function setzeStatus(stand, id, status, tag) {
  pruefeThema(id, "themen");
  if (!STATUS.includes(status)) fehler(`Status „${status}“ für ${id} ungültig. Gültig: ${STATUS.join(", ")}`);
  const alt = stand.themen[id] || {};
  const t = { ...alt, status };
  if (status === "in_arbeit" && !t.seit) t.seit = tag;
  if (status === "erledigt") { t.erledigt_am = alt.erledigt_am || tag; if (!t.seit) t.seit = tag; }
  if (status !== "erledigt") t.erledigt_am = null;
  stand.themen[id] = t;
}

// Wendet eine Session auf den Stand an und liefert eine Liste dessen, was
// passiert ist (für die Ausgabe an Vale).
function anwenden(stand, p) {
  const tag = isoTag();
  const was = [];

  if (p.uebung_erledigt) {
    const u = offeneUebung(stand);
    if (!u) was.push("keine offene Übung zum Abschließen");
    else {
      u.status = "erledigt";
      u.erledigt_am = tag;
      if (typeof p.uebung_erledigt === "object" && p.uebung_erledigt.notiz) u.notiz = String(p.uebung_erledigt.notiz);
      was.push(`Übung erledigt: ${u.titel}`);
      // Skill-Regel: erledigte Übung = Thema erledigt (außer die Session sagt
      // ausdrücklich etwas anderes über „themen“).
      if (!(p.themen && p.themen[u.thema])) {
        setzeStatus(stand, u.thema, "erledigt", tag);
        was.push(`Thema ${u.thema} erledigt`);
      }
    }
  }

  for (const [id, status] of Object.entries(p.themen || {})) {
    setzeStatus(stand, id, status, tag);
    was.push(`Thema ${id} → ${status}`);
  }

  if (p.aktuell) {
    pruefeThema(p.aktuell, "aktuell");
    stand.aktuell = p.aktuell;
    if (statusVon(stand, p.aktuell) === "offen") setzeStatus(stand, p.aktuell, "in_arbeit", tag);
    was.push(`Aktuelles Thema: ${p.aktuell}`);
  }

  if (p.quiz) {
    const q = p.quiz;
    if (q.thema) pruefeThema(q.thema, "quiz");
    const richtig = Number(q.richtig), gesamt = Number(q.gesamt);
    if (!Number.isInteger(richtig) || !Number.isInteger(gesamt) || gesamt < 1 || richtig < 0 || richtig > gesamt) {
      fehler("quiz: richtig/gesamt müssen ganze Zahlen sein (0 ≤ richtig ≤ gesamt, gesamt ≥ 1).");
    }
    stand.quiz.push({ datum: tag, thema: q.thema || null, richtig, gesamt, notiz: q.notiz ? String(q.notiz) : null });
    was.push(`Abfrage ${richtig}/${gesamt}`);
  }

  for (const v of p.videos || []) {
    pruefeThema(v.thema, "videos");
    pruefeUrl(v.url, "videos");
    if (stand.videos.some((x) => x.url === v.url)) { was.push(`Video schon bekannt: ${v.titel || v.url}`); continue; }
    stand.videos.push({
      id: kurzId(), datum: tag, thema: v.thema, titel: String(v.titel || ""), kanal: String(v.kanal || ""),
      url: v.url, laenge: v.laenge ? String(v.laenge) : null, warum: v.warum ? String(v.warum) : null,
      rolle: v.rolle === "alternative" ? "alternative" : "haupt", gesehen: false, bewertung: null,
    });
    was.push(`Video (${v.rolle === "alternative" ? "Alternative" : "Hauptvideo"}): ${v.titel}`);
  }

  for (const b of p.video_bewertung || []) {
    const v = stand.videos.find((x) => x.url === b.url || x.id === b.id);
    if (!v) { was.push(`Video zum Bewerten nicht gefunden: ${b.url || b.id}`); continue; }
    if (typeof b.gesehen === "boolean") v.gesehen = b.gesehen;
    if (b.bewertung != null) {
      const n = Number(b.bewertung);
      if (!(n >= 1 && n <= 5)) fehler("video_bewertung: bewertung muss 1–5 sein.");
      v.bewertung = Math.round(n);
      v.gesehen = true;
    }
    was.push(`Video bewertet: ${v.titel}`);
  }

  if (p.uebung) {
    const u = p.uebung;
    pruefeThema(u.thema, "uebung");
    if (!u.titel) fehler("uebung: titel fehlt.");
    const fw = liste(u.fertig_wenn);
    if (!fw.length) fehler("uebung: fertig_wenn braucht 2–3 überprüfbare Kriterien.");
    const alt = offeneUebung(stand);
    if (alt) { alt.status = "ersetzt"; was.push(`Alte Übung ersetzt: ${alt.titel}`); }
    stand.uebungen.push({
      id: kurzId(), thema: u.thema, titel: String(u.titel), dauer: u.dauer ? String(u.dauer) : null,
      aufbau: liste(u.aufbau), filmen: liste(u.filmen), fertig_wenn: fw,
      immobilien: u.immobilien ? String(u.immobilien) : null,
      gegeben_am: tag, status: "offen", erledigt_am: null, notiz: null,
    });
    if (statusVon(stand, u.thema) === "offen") setzeStatus(stand, u.thema, "in_arbeit", tag);
    if (!p.aktuell) stand.aktuell = u.thema;
    was.push(`Neue Übung: ${u.titel}`);
  }

  for (const s of p.schwachstellen || []) {
    const text = typeof s === "string" ? s : s.text;
    if (!text) continue;
    if (s.thema) pruefeThema(s.thema, "schwachstellen");
    if (stand.schwachstellen.some((x) => !x.erledigt_am && x.text === text)) continue;
    stand.schwachstellen.push({ id: kurzId(), text: String(text), thema: s.thema || null, seit: tag, erledigt_am: null });
    was.push(`Schwachstelle: ${text}`);
  }

  for (const k of p.schwachstellen_erledigt || []) {
    const s = stand.schwachstellen.find((x) => !x.erledigt_am && (x.id === k || x.text.startsWith(k)));
    if (!s) { was.push(`Schwachstelle nicht gefunden: ${k}`); continue; }
    s.erledigt_am = tag;
    was.push(`Schwachstelle sitzt jetzt: ${s.text}`);
  }

  for (const pr of p.praxis || []) {
    if (!pr.titel) fehler("praxis: titel fehlt.");
    const themen = liste(pr.themen);
    themen.forEach((id) => pruefeThema(id, "praxis"));
    stand.praxis.push({ datum: pr.datum && /^\d{4}-\d{2}-\d{2}$/.test(pr.datum) ? pr.datum : tag,
                        titel: String(pr.titel), kunde: pr.kunde ? String(pr.kunde) : null,
                        themen, notiz: pr.notiz ? String(pr.notiz) : null });
    was.push(`Praxis: ${pr.titel}${themen.length ? ` (${themen.join(", ")})` : ""}`);
  }

  if (p.log) {
    const thema = p.log_thema || null;
    if (thema) pruefeThema(thema, "log_thema");
    stand.log.push({ datum: jetzt(), text: String(p.log), thema });
    was.push(`Log: ${p.log}`);
  }

  stand.aktualisiert = jetzt();
  return was;
}

// --- Ausgabe „zeigen“ -----------------------------------------------------
function alsText(stand) {
  if (!stand) return `Noch kein Lernstand. Start mit ${alleThemen()[0].id} ${alleThemen()[0].titel}.`;
  const z = [];
  const f = fortschritt(stand);
  const cur = aktuellesThema(stand);
  const nach = naechstesThema(stand);
  const zz = zahlen(stand);
  z.push(`# Videografie-Lernstand (aktualisiert ${stand.aktualisiert})`);
  z.push(`Fortschritt: ${f.erledigt}/${f.gesamt} Themen erledigt (${f.prozent} %), ${f.inArbeit} in Arbeit.`);
  z.push(`Aktuell: ${cur ? `${cur.id} ${cur.titel} (Modul ${cur.modul.id} – ${cur.modul.name}) · Status ${statusVon(stand, cur.id)}` : "alles erledigt"}`);
  if (nach) z.push(`Danach: ${nach.id} ${nach.titel}`);
  const u = offeneUebung(stand);
  z.push("");
  z.push("## Offene Übung");
  if (u) {
    z.push(`- ${u.titel} (Thema ${u.thema}, seit ${u.gegeben_am}${u.dauer ? `, ${u.dauer}` : ""})`);
    u.fertig_wenn.forEach((k) => z.push(`  - fertig, wenn: ${k}`));
  } else z.push("- keine");
  z.push("");
  z.push("## Themen");
  for (const m of LEHRPLAN) {
    z.push(`- Modul ${m.id} ${m.name}: ` + m.themen.map(([id]) => `${id} ${statusVon(stand, id)}`).join(" · "));
  }
  const sw = stand.schwachstellen.filter((s) => !s.erledigt_am);
  z.push("");
  z.push("## Schwachstellen (wiederholen)");
  z.push(sw.length ? sw.map((s) => `- ${s.text}${s.thema ? ` (${s.thema})` : ""} [id ${s.id}]`).join("\n") : "- keine");
  z.push("");
  z.push(`## Videos (${zz.videosGesehen}/${zz.videosGesamt} gesehen) — URLs nicht erneut vorschlagen`);
  z.push(stand.videos.length ? stand.videos.map((v) => `- ${v.datum} ${v.thema} ${v.rolle} ${v.gesehen ? "gesehen" : "offen"}${v.bewertung ? ` ${v.bewertung}/5` : ""}: ${v.titel} — ${v.kanal} — ${v.url}`).join("\n") : "- noch keine");
  z.push("");
  z.push(`## Abfragen: ${zz.quizQuote == null ? "noch keine" : `${zz.quizQuote} % richtig aus ${zz.quizFragen} Fragen`}`);
  stand.quiz.slice(-3).forEach((q) => z.push(`- ${q.datum} ${q.thema || ""} ${q.richtig}/${q.gesamt}${q.notiz ? ` — ${q.notiz}` : ""}`));
  z.push("");
  z.push(`## Praxis (${stand.praxis.length})`);
  stand.praxis.slice(-5).forEach((p) => z.push(`- ${p.datum} ${p.titel}${p.kunde ? ` · ${p.kunde}` : ""}${p.themen.length ? ` (${p.themen.join(", ")})` : ""}`));
  z.push("");
  z.push("## Letzte Einträge");
  verlauf(stand).slice(0, 8).forEach((e) => z.push(`- ${e.tag} ${e.text}`));
  return z.join("\n");
}

// --- Befehle --------------------------------------------------------------
function argWert(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

function schreibe(patch, trocken) {
  const stand = normalisiere(laden());
  const was = anwenden(stand, patch);
  if (trocken) {
    console.log("TROCKEN — nichts geschrieben.\n" + was.map((w) => `- ${w}`).join("\n"));
    console.log("\n" + alsText(stand));
    return;
  }
  speichern(stand);
  console.log("Eingetragen in lernen/lernstand.json (ins Portal übernimmt es das Cockpit, Reiter „Lernen“):\n"
    + was.map((w) => `- ${w}`).join("\n"));
}

const [befehl, ...args] = process.argv.slice(2);
const trocken = args.includes("--trocken");

switch (befehl) {
  case "zeigen": {
    const stand = laden();
    console.log(args.includes("--json") ? JSON.stringify(stand, null, 2) : alsText(stand ? normalisiere(stand) : null));
    break;
  }
  case "eintragen": {
    const datei = args.find((a) => !a.startsWith("--"));
    if (!datei) fehler("eintragen braucht eine JSON-Datei (oder - für stdin).");
    let roh;
    try { roh = datei === "-" ? readFileSync(0, "utf8") : readFileSync(datei, "utf8"); }
    catch (e) { fehler(`Datei nicht lesbar: ${datei}`); }
    let patch;
    try { patch = JSON.parse(roh.replace(/^﻿/, "")); } catch (e) { fehler(`Kein gültiges JSON: ${e.message}`); }
    schreibe(patch, trocken);
    break;
  }
  case "praxis": {
    const titel = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
    if (!titel) fehler('praxis braucht einen Titel: praxis "Deussen Reel Benrath" --themen 1.7,2.6');
    const themen = (argWert(args, "--themen") || "").split(",").map((s) => s.trim()).filter(Boolean);
    schreibe({ praxis: [{ titel, themen, kunde: argWert(args, "--kunde"), notiz: argWert(args, "--notiz") }] }, trocken);
    break;
  }
  case "uebung-erledigt": {
    schreibe({ uebung_erledigt: { notiz: argWert(args, "--notiz") } }, trocken);
    break;
  }
  case "log": {
    const text = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
    if (!text) fehler('log braucht einen Text: log "…"');
    schreibe({ log: text, log_thema: argWert(args, "--thema") }, trocken);
    break;
  }
  default:
    console.log(`Befehle: zeigen [--json] · eintragen <datei.json> · praxis "<titel>" --themen … · uebung-erledigt · log "<text>"
Siehe Kopf von tools/lernstand.mjs.`);
}
