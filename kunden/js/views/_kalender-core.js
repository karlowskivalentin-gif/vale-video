// Geteiltes Monatsraster für Admin- und Kunden-Kalender.
// Zeigt zwei Quellen als farbcodierte Marker:
//   1) Videos  → Veröffentlichung (geplantesDatum) + Drehtermin (geplanterDrehtermin)
//   2) Termine → manuelle Einträge (Kategorie besprechung|drehtermin|veroeffentlichung)
// Jeder Marker hat eine „Zu meinem Kalender hinzufügen"-Aktion (.ics-Export).
//
// Parametrisiert über opts:
//   opts.intro    : Intro-Text unter der Überschrift (Klartext)
//   opts.chipHref : (video) => Href-String für Video-Chips
//                   (Admin → #/admin/video/{id}, Kunde → #/video/{id})
import { beobachteVideos, beobachteTermine } from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { escapeHtml } from "../util.js";
import { ladeIcsHerunter } from "../ics.js";

const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember"];
const WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

// Kategorie → Anzeige (Icon, Klartext-Label, CSS-Klassen-Suffix).
const KATEGORIE = {
  veroeffentlichung: { icon: "📣", label: "Veröffentlichung", cls: "veroeffentlichung" },
  dreh:              { icon: "🎬", label: "Drehtermin",       cls: "dreh" },
  besprechung:       { icon: "💬", label: "Besprechung",      cls: "besprechung" },
  plan:              { icon: "📝", label: "Plan",             cls: "plan" }
};

// Termin-Kategorie 'drehtermin' → interne Art 'dreh' (gleiche Farbe wie Video-Dreh).
function normArt(k) {
  if (k === "drehtermin") return "dreh";
  if (KATEGORIE[k]) return k;
  return "besprechung";
}

export function renderKalender(container, opts) {
  opts = opts || {};
  const intro = opts.intro || "Geplante Termine und Veröffentlichungen.";
  const chipHref = opts.chipHref || ((v) => `#/video/${encodeURIComponent(v.id)}`);
  // Nur der Admin-Kalender reicht beobachtePlaene durch → private Plan-Marker
  // (gestrichelt). Der Kunden-Kalender lässt das weg und sieht keine Pläne.
  const beobachtePlaene = typeof opts.beobachtePlaene === "function" ? opts.beobachtePlaene : null;
  // Mandant: Admin reicht den aktiven Kunden durch, der Kunde seinen eigenen.
  // Alle Kalender-Quellen (Videos/Termine/Pläne) werden danach gefiltert.
  const kundeId = opts.kundeId || null;

  const heute = new Date();
  let jahr = heute.getFullYear();
  let monat = heute.getMonth(); // 0–11
  let videos = [];
  let termine = [];
  let plaene = [];
  let markerById = new Map();   // id → Marker (für den .ics-Export per Klick)

  container.innerHTML = `
    <div class="admin-head">
      <h1 class="view-title" style="margin:0">Kalender</h1>
    </div>
    <p class="muted view-intro">${escapeHtml(intro)}</p>

    <div class="kal-legende">
      <span class="kal-leg kal-leg--veroeffentlichung">📣 Veröffentlichung</span>
      <span class="kal-leg kal-leg--dreh">🎬 Drehtermin</span>
      <span class="kal-leg kal-leg--besprechung">💬 Besprechung</span>
      ${beobachtePlaene ? `<span class="kal-leg kal-leg--plan">📝 Plan (privat)</span>` : ""}
    </div>

    <div class="kal-bar">
      <button class="btn btn--ghost btn--sm" id="kalPrev" type="button" aria-label="Vorheriger Monat">←</button>
      <span class="kal-titel" id="kalTitel"></span>
      <button class="btn btn--ghost btn--sm" id="kalNext" type="button" aria-label="Nächster Monat">→</button>
      <button class="btn btn--ghost btn--sm" id="kalHeute" type="button">Heute</button>
    </div>
    <div id="kalGrid"><div class="card card--pad"><p class="muted">Wird geladen …</p></div></div>`;

  const titelEl = container.querySelector("#kalTitel");
  const gridEl  = container.querySelector("#kalGrid");

  // Alle Marker aus Videos + Terminen aufbauen und in markerById indexieren.
  function baueMarker() {
    const alle = [];
    markerById = new Map();

    videos.forEach((v) => {
      const pub = zuDate(v.geplantesDatum);
      if (pub) alle.push(markerEintragen({
        id: `vp_${v.id}`, art: "veroeffentlichung", datum: pub,
        titel: v.titel || "Video", href: chipHref(v)
      }));
      const dreh = zuDate(v.geplanterDrehtermin);
      if (dreh) alle.push(markerEintragen({
        id: `vd_${v.id}`, art: "dreh", datum: dreh,
        titel: v.titel || "Video", href: chipHref(v)
      }));
    });

    termine.forEach((t) => {
      const d = zuDate(t.datum);
      if (!d) return;
      alle.push(markerEintragen({
        id: `t_${t.id}`, art: normArt(t.kategorie), datum: d,
        titel: t.bezeichnung || "Termin", href: null,
        uhrzeitVon: t.uhrzeitVon || "", uhrzeitBis: t.uhrzeitBis || "",
        ort: t.ort || "", notiz: t.notiz || ""
      }));
    });

    // Private Pläne (nur Admin-Kalender) — als gestrichelte „plan"-Marker.
    plaene.forEach((p) => {
      const href = `#/admin/plan/${encodeURIComponent(p.id)}`;
      const titel = p.titel || "Plan";
      const dreh = zuDate(p.geplanterDrehtermin);
      if (dreh) alle.push(markerEintragen({ id: `pd_${p.id}`, art: "plan", datum: dreh, titel, href }));
      const pub = zuDate(p.geplantesDatum);
      if (pub) alle.push(markerEintragen({ id: `pp_${p.id}`, art: "plan", datum: pub, titel, href }));
    });

    return alle;
  }

  function markerEintragen(m) {
    const k = KATEGORIE[m.art] || KATEGORIE.besprechung;
    const voll = {
      uhrzeitVon: "", uhrzeitBis: "", ort: "", notiz: "",
      ...m, icon: k.icon, label: k.label, cls: k.cls
    };
    markerById.set(voll.id, voll);
    return voll;
  }

  function zeichne() {
    titelEl.textContent = `${MONATE[monat]} ${jahr}`;
    const alle = baueMarker();
    gridEl.innerHTML = monatsHtml(jahr, monat, alle);
  }

  container.querySelector("#kalPrev").addEventListener("click", () => {
    monat--; if (monat < 0) { monat = 11; jahr--; } zeichne();
  });
  container.querySelector("#kalNext").addEventListener("click", () => {
    monat++; if (monat > 11) { monat = 0; jahr++; } zeichne();
  });
  container.querySelector("#kalHeute").addEventListener("click", () => {
    jahr = heute.getFullYear(); monat = heute.getMonth(); zeichne();
  });

  // .ics-Export per Event-Delegation (Chips werden bei jedem zeichne() neu gebaut).
  gridEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".kal-ics");
    if (!btn) return;
    e.preventDefault();
    const m = markerById.get(btn.getAttribute("data-ics"));
    if (!m) return;
    try {
      ladeIcsHerunter({
        titel: `${m.label}: ${m.titel}`,
        datum: m.datum, uhrzeitVon: m.uhrzeitVon, uhrzeitBis: m.uhrzeitBis,
        ort: m.ort, notiz: m.notiz, uid: m.id
      });
    } catch (err) { console.error(err); }
  });

  zeichne(); // Skelett mit leeren Tagen sofort

  // Videos: Fehler ist fatal (Hauptquelle).
  const unsubVideos = beobachteVideos(
    (liste) => { videos = liste; zeichne(); },
    (err) => {
      console.error(err);
      gridEl.innerHTML = `<div class="card card--pad"><p class="notice notice--error" style="margin:0">
        Konnte nicht laden. Ist die Firestore-Datenbank eingerichtet?</p></div>`;
    },
    kundeId
  );
  // Termine: Fehler ist NICHT fatal (z. B. Rules noch nicht deployed) → Video-Marker bleiben.
  const unsubTermine = beobachteTermine(
    (liste) => { termine = liste; zeichne(); },
    (err) => { console.warn("Termine konnten nicht geladen werden:", err); },
    kundeId
  );
  // Pläne: nur Admin-Kalender (opts.beobachtePlaene gesetzt). Fehler NICHT fatal.
  const unsubPlaene = beobachtePlaene
    ? beobachtePlaene(
        (liste) => { plaene = liste; zeichne(); },
        (err) => { console.warn("Pläne konnten nicht geladen werden:", err); },
        kundeId
      )
    : null;

  beiViewWechsel(() => { unsubVideos(); unsubTermine(); if (unsubPlaene) unsubPlaene(); });
}

// --- Monatsraster ------------------------------------------------------
function monatsHtml(jahr, monat, marker) {
  // Marker nach Tag im aktuellen Monat gruppieren.
  const proTag = {};
  marker.forEach((m) => {
    const d = m.datum;
    if (d.getFullYear() === jahr && d.getMonth() === monat) {
      const tag = d.getDate();
      (proTag[tag] = proTag[tag] || []).push(m);
    }
  });

  const ersterTag = new Date(jahr, monat, 1);
  // getDay(): 0=So..6=Sa → in Mo-basiertes Raster umrechnen.
  const startOffset = (ersterTag.getDay() + 6) % 7;
  const tageImMonat = new Date(jahr, monat + 1, 0).getDate();
  const heute = new Date();
  const istHeuteMonat = heute.getFullYear() === jahr && heute.getMonth() === monat;

  const zellen = [];
  for (let i = 0; i < startOffset; i++) zellen.push(`<div class="kal-tag kal-tag--leer"></div>`);

  for (let tag = 1; tag <= tageImMonat; tag++) {
    const eintraege = (proTag[tag] || []).slice().sort(sortMarker);
    const istHeute = istHeuteMonat && heute.getDate() === tag;
    const chips = eintraege.map(eintragHtml).join("");
    zellen.push(`
      <div class="kal-tag${istHeute ? " kal-tag--heute" : ""}">
        <span class="kal-tag-num">${tag}</span>
        ${chips}
      </div>`);
  }

  const kopf = WOCHENTAGE.map((w) => `<div class="kal-wt">${w}</div>`).join("");

  return `<div class="card kal-card">
    <div class="kal-grid">
      ${kopf}
      ${zellen.join("")}
    </div>
  </div>`;
}

// Innerhalb eines Tages: nach Uhrzeit (leer zuletzt), dann Label.
function sortMarker(a, b) {
  const av = a.uhrzeitVon || "99:99";
  const bv = b.uhrzeitVon || "99:99";
  if (av !== bv) return av < bv ? -1 : 1;
  return a.label.localeCompare(b.label);
}

function eintragHtml(m) {
  const zeit = m.uhrzeitVon ? ` ${escapeHtml(m.uhrzeitVon)}` : "";
  const tip = escapeHtml(`${m.label}: ${m.titel}${m.uhrzeitVon ? " · " + m.uhrzeitVon : ""}`);
  const inhalt = `${m.icon}${zeit} ${escapeHtml(m.titel)}`;
  const chip = m.href
    ? `<a class="kal-chip kal-chip--${m.cls}" href="${m.href}" title="${tip}">${inhalt}</a>`
    : `<span class="kal-chip kal-chip--${m.cls}" title="${tip}">${inhalt}</span>`;
  const ics = `<button class="kal-ics" type="button" data-ics="${escapeHtml(m.id)}"
      title="Zu meinem Kalender hinzufügen" aria-label="Zu meinem Kalender hinzufügen">＋</button>`;
  return `<span class="kal-eintrag">${chip}${ics}</span>`;
}

function zuDate(ts) {
  if (!ts) return null;
  const d = ts && ts.toDate ? ts.toDate() : (ts instanceof Date ? ts : new Date(ts));
  return isNaN(d.getTime()) ? null : d;
}
