// Prüft Claudes Lernstand-Werkzeug (tools/lernstand.mjs) und die Rechenlogik
// des Reiters „Lernen“ (kunden/js/videografie-logik.js) gegeneinander —
// gegen eine Wegwerf-Kopie, nie gegen lernen/lernstand.json.
//
//   node tools/lernstand-check.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LEHRPLAN } from "../kunden/js/videografie-data.js";
import { alleThemen, fortschritt, aktuellesThema, naechstesThema, offeneUebung,
         zahlen, ytId, verlauf, aktivitaetsRaster, modulFortschritt, isoTag } from "../kunden/js/videografie-logik.js";

const HIER = dirname(fileURLToPath(import.meta.url));
const ordner = mkdtempSync(join(tmpdir(), "lernstand-check-"));
const datei = join(ordner, "lernstand.json");
let fehler = 0;

function pruefe(name, ok, info) {
  if (ok) console.log(`ok   ${name}`);
  else { fehler++; console.log(`FAIL ${name}${info !== undefined ? ` — ${JSON.stringify(info)}` : ""}`); }
}
function tool(...args) {
  return execFileSync(process.execPath, [join(HIER, "lernstand.mjs"), ...args],
    { env: { ...process.env, LERNSTAND_DATEI: datei }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}
function toolFehler(...args) {
  try { tool(...args); return null; } catch (e) { return String(e.stderr || e.message); }
}
const stand = () => JSON.parse(readFileSync(datei, "utf8"));
function patch(obj) {
  const p = join(ordner, "patch.json");
  writeFileSync(p, JSON.stringify(obj));
  return tool("eintragen", p);
}

try {
  // --- Lehrplan --------------------------------------------------------
  const ids = alleThemen().map((t) => t.id);
  pruefe("Lehrplan hat 23 Themen in 5 Modulen", ids.length === 23 && LEHRPLAN.length === 5, ids.length);
  pruefe("Themen-IDs eindeutig", new Set(ids).size === ids.length);
  pruefe("Leerer Stand: 0 %, aktuell 1.1", fortschritt(null).prozent === 0 && aktuellesThema(null).id === "1.1");

  // --- YouTube-IDs -----------------------------------------------------
  pruefe("ytId watch", ytId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3") === "dQw4w9WgXcQ");
  pruefe("ytId youtu.be", ytId("https://youtu.be/dQw4w9WgXcQ?si=x") === "dQw4w9WgXcQ");
  pruefe("ytId shorts", ytId("https://youtube.com/shorts/dQw4w9WgXcQ") === "dQw4w9WgXcQ");
  pruefe("ytId Unsinn", ytId("https://vimeo.com/123") === null && ytId(null) === null);

  // --- Erste Session: Thema, Video, Übung ------------------------------
  pruefe("zeigen ohne Datei", /Noch kein Lernstand/.test(tool("zeigen")));
  patch({
    aktuell: "1.1",
    videos: [
      { thema: "1.1", titel: "Haupt", kanal: "K", url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", rolle: "haupt" },
      { thema: "1.1", titel: "Alt", kanal: "K2", url: "https://youtu.be/bbbbbbbbbbb", rolle: "alternative" },
    ],
    uebung: { thema: "1.1", titel: "Fünf Richtungen", aufbau: ["a"], filmen: ["b"], fertig_wenn: ["x", "y"] },
    log: "Start",
  });
  let s = stand();
  pruefe("1.1 in Arbeit", s.themen["1.1"].status === "in_arbeit" && s.themen["1.1"].seit === isoTag());
  pruefe("zwei Videos, Rollen richtig", s.videos.length === 2 && s.videos[1].rolle === "alternative");
  pruefe("offene Übung da", offeneUebung(s) && offeneUebung(s).titel === "Fünf Richtungen");
  pruefe("Fortschritt 0 erledigt, 1 in Arbeit", fortschritt(s).erledigt === 0 && fortschritt(s).inArbeit === 1);

  // --- Doppeltes Video wird nicht doppelt eingetragen -------------------
  patch({ videos: [{ thema: "1.1", titel: "Haupt", url: "https://www.youtube.com/watch?v=aaaaaaaaaaa" }] });
  pruefe("Video-Duplikat ignoriert", stand().videos.length === 2);

  // --- Fehleingaben werden abgelehnt, Datei bleibt heil -----------------
  const vorher = readFileSync(datei, "utf8");
  pruefe("unbekanntes Thema abgelehnt", /unbekanntes Thema/.test(toolFehler("praxis", "X", "--themen", "9.9") || ""));
  pruefe("Übung ohne Kriterien abgelehnt", (() => {
    const p = join(ordner, "p2.json"); writeFileSync(p, JSON.stringify({ uebung: { thema: "1.1", titel: "t" } }));
    return /fertig_wenn/.test(toolFehler("eintragen", p) || "");
  })());
  pruefe("Quiz 4/3 abgelehnt", (() => {
    const p = join(ordner, "p3.json"); writeFileSync(p, JSON.stringify({ quiz: { richtig: 4, gesamt: 3 } }));
    return /quiz/.test(toolFehler("eintragen", p) || "");
  })());
  pruefe("nach Fehlern unverändert", readFileSync(datei, "utf8") === vorher);

  // --- Übung erledigt → Thema erledigt, nächstes Thema ------------------
  tool("uebung-erledigt", "--notiz", "Schatten bei 90° zu hart");
  s = stand();
  pruefe("Übung erledigt mit Notiz", s.uebungen[0].status === "erledigt" && s.uebungen[0].notiz.startsWith("Schatten"));
  pruefe("Thema 1.1 erledigt", s.themen["1.1"].status === "erledigt" && s.themen["1.1"].erledigt_am === isoTag());
  pruefe("aktuell springt auf 1.2", aktuellesThema(s).id === "1.2" && naechstesThema(s).id === "1.3");
  pruefe("Modul 1: 1/8", modulFortschritt(s, LEHRPLAN[0]).join("/") === "1/8");
  pruefe("4 % (1/23)", fortschritt(s).prozent === 4);

  // --- Neue Übung ersetzt offene ----------------------------------------
  patch({ uebung: { thema: "1.2", titel: "Weich/hart", fertig_wenn: ["k"] } });
  patch({ uebung: { thema: "1.2", titel: "Weich/hart v2", fertig_wenn: ["k"] } });
  s = stand();
  pruefe("alte Übung ersetzt, nur eine offen",
    s.uebungen.filter((u) => u.status === "offen").length === 1 && s.uebungen[1].status === "ersetzt" && offeneUebung(s).titel === "Weich/hart v2");

  // --- Quiz, Schwachstellen, Praxis, Bewertung --------------------------
  patch({ quiz: { thema: "1.1", richtig: 2, gesamt: 3 }, schwachstellen: [{ text: "Fill zu nah am Key", thema: "1.3" }] });
  patch({ schwachstellen: [{ text: "Fill zu nah am Key", thema: "1.3" }] });
  tool("praxis", "Deussen Reel Benrath", "--themen", "1.7,2.6", "--kunde", "Deussen");
  patch({ video_bewertung: [{ url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", bewertung: 4 }] });
  s = stand();
  const z = zahlen(s);
  pruefe("Quiz-Quote 67 %", z.quizQuote === 67, z.quizQuote);
  pruefe("Schwachstelle nicht doppelt", s.schwachstellen.length === 1);
  pruefe("Praxis mit Themen", s.praxis[0].themen.join() === "1.7,2.6" && s.praxis[0].kunde === "Deussen");
  pruefe("Bewertung setzt gesehen", s.videos[0].bewertung === 4 && s.videos[0].gesehen === true && z.videosGesehen === 1);
  patch({ schwachstellen_erledigt: ["Fill zu nah"] });
  pruefe("Schwachstelle sitzt", stand().schwachstellen[0].erledigt_am === isoTag() && zahlen(stand()).schwachstellenOffen === 0);

  // --- Verlauf und Kalender ---------------------------------------------
  const v = verlauf(stand());
  pruefe("Verlauf hat Einträge, alle heute", v.length >= 8 && v.every((e) => e.tag === isoTag()), v.length);
  const raster = aktivitaetsRaster(stand(), new Date(), 12);
  const heuteZelle = raster.flat().find((d) => d.tag === isoTag());
  pruefe("Kalender 12×7, heute aktiv", raster.length === 12 && raster.every((w) => w.length === 7) && heuteZelle && heuteZelle.anzahl > 0);

  // --- trocken schreibt nicht -------------------------------------------
  const vorTrocken = readFileSync(datei, "utf8");
  tool("log", "nur ein Test", "--trocken");
  pruefe("--trocken schreibt nicht", readFileSync(datei, "utf8") === vorTrocken);

  // --- Firestore-tauglich: keine Arrays in Arrays, kein undefined --------
  const tief = (x) => Array.isArray(x) ? x.every((y) => !Array.isArray(y) && tief(y))
    : x && typeof x === "object" ? Object.values(x).every((y) => y !== undefined && tief(y)) : true;
  pruefe("Dokument Firestore-tauglich", tief(stand()));
} finally {
  rmSync(ordner, { recursive: true, force: true });
}

console.log(fehler ? `\n${fehler} Prüfung(en) fehlgeschlagen.` : "\nAlles grün.");
process.exit(fehler ? 1 : 0);
