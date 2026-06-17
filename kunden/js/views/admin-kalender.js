// Admin-View: Kalender. Read-only Monatsansicht der Videos mit geplantesDatum.
// Fokus auf die Stufen „Geplant" / „Gepostet", aber alle Videos mit Datum erscheinen.
import { beobachteVideos } from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { escapeHtml } from "../util.js";

const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember"];
const WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export function renderAdminKalender(container) {
  const heute = new Date();
  let jahr = heute.getFullYear();
  let monat = heute.getMonth(); // 0–11
  let videos = [];

  container.innerHTML = `
    <div class="admin-head">
      <h1 class="view-title" style="margin:0">Kalender</h1>
    </div>
    <p class="muted view-intro">Geplante Veröffentlichungen. Datum setzt du im jeweiligen Video.</p>

    <div class="kal-bar">
      <button class="btn btn--ghost btn--sm" id="kalPrev" type="button" aria-label="Vorheriger Monat">←</button>
      <span class="kal-titel" id="kalTitel"></span>
      <button class="btn btn--ghost btn--sm" id="kalNext" type="button" aria-label="Nächster Monat">→</button>
      <button class="btn btn--ghost btn--sm" id="kalHeute" type="button">Heute</button>
    </div>
    <div id="kalGrid"><div class="card card--pad"><p class="muted">Wird geladen …</p></div></div>`;

  const titelEl = container.querySelector("#kalTitel");
  const gridEl  = container.querySelector("#kalGrid");

  function zeichne() {
    titelEl.textContent = `${MONATE[monat]} ${jahr}`;
    gridEl.innerHTML = monatsHtml(jahr, monat, videos);
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

  zeichne(); // Skelett mit leeren Tagen sofort

  const unsub = beobachteVideos(
    (liste) => { videos = liste; zeichne(); },
    (err) => {
      console.error(err);
      gridEl.innerHTML = `<div class="card card--pad"><p class="notice notice--error" style="margin:0">
        Konnte nicht laden. Ist die Firestore-Datenbank eingerichtet?</p></div>`;
    }
  );
  beiViewWechsel(unsub);
}

// --- Monatsraster ------------------------------------------------------
function monatsHtml(jahr, monat, videos) {
  // Videos nach Tag im aktuellen Monat gruppieren.
  const proTag = {};
  videos.forEach((v) => {
    const d = zuDate(v.geplantesDatum);
    if (!d) return;
    if (d.getFullYear() === jahr && d.getMonth() === monat) {
      const tag = d.getDate();
      (proTag[tag] = proTag[tag] || []).push(v);
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
    const eintraege = proTag[tag] || [];
    const istHeute = istHeuteMonat && heute.getDate() === tag;
    const chips = eintraege.map((v) =>
      `<a class="kal-chip" href="#/admin/video/${encodeURIComponent(v.id)}" title="${escapeHtml(v.titel || "")}">${escapeHtml(v.titel || "Video")}</a>`
    ).join("");
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

function zuDate(ts) {
  if (!ts) return null;
  const d = ts && ts.toDate ? ts.toDate() : (ts instanceof Date ? ts : new Date(ts));
  return isNaN(d.getTime()) ? null : d;
}
