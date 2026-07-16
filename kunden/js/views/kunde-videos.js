// Kunden-View: „Meine Videos" — transparente Fortschritts-Timeline.
// Zeigt pro eigenem Video die realen Produktionsschritte (Idee → Skript →
// Freigabe → Dreh → Schnitt → Freigabe → Fertig) als vertikalen Stepper.
//
// Bewusst KUNDENSICHER: `beobachteVideos(…, kundeId)` liefert nur die Videos
// des eingeloggten Kunden (zusätzlich in firestore.rules abgesichert). Es gibt
// hier KEINE internen Notizen, keine anderen Kunden, kein Status-Dropdown —
// reine Lese-Ansicht. Bei offenen Freigaben führt die Karte ins Video-Detail.
import { beobachteVideos } from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import {
  STATUS, statusIndex, kundenStatus, istFreigabeStufe, skriptFreigabeNoetig
} from "../status.js";
import { escapeHtml } from "../util.js";

// --- Die kuratierten Kunden-Schritte ----------------------------------
// Jeder Schritt hat eine Schwelle (interner Status, ab dem er als „erreicht"
// gilt). Interne Zwischenstufen werden bewusst gruppiert: 🎬 Dreh bündelt
// Drehbereit+Gedreht, ✅ Fertig bündelt Freigegeben+Geplant+Gepostet.
// `nurMitSkript` blendet die Skript-Schritte bei skriptlosen Formaten aus
// (Cinematic / wortlose Edits).
const SCHRITTE = [
  { key: "idee",     label: "Idee",             ab: STATUS.IDEE },
  { key: "skript",   label: "Skript",           ab: STATUS.SKRIPT,           nurMitSkript: true },
  { key: "fskript",  label: "Freigabe Skript",  ab: STATUS.FREIGABE_SKRIPT,  nurMitSkript: true, freigabe: true },
  { key: "dreh",     label: "Dreh",             ab: STATUS.DREHBEREIT },
  { key: "schnitt",  label: "Schnitt",          ab: STATUS.SCHNITT },
  { key: "fschnitt", label: "Freigabe Schnitt", ab: STATUS.FREIGABE_SCHNITT, freigabe: true },
  { key: "fertig",   label: "Fertig",           ab: STATUS.FREIGEGEBEN }
];

export function renderMeineVideos(container, opts = {}) {
  const kundeId = opts.kundeId || null;

  container.innerHTML = `
    <h1 class="view-title">Meine Videos</h1>
    <p class="muted view-intro">So weit ist jedes deiner Videos in der Produktion. Wartet eins auf deine Freigabe, kommst du per Klick direkt hin.</p>
    <div id="mvListe" class="stack"><div class="card card--pad"><p class="muted">Wird geladen …</p></div></div>`;

  const listeEl = container.querySelector("#mvListe");

  const unsubV = beobachteVideos(
    (videos) => zeichne(listeEl, videos),
    (err) => {
      console.error(err);
      listeEl.innerHTML = `<div class="card card--pad"><p class="notice notice--error" style="margin:0">
        Deine Videos konnten nicht geladen werden. Bitte später erneut versuchen.</p></div>`;
    },
    kundeId
  );

  beiViewWechsel(unsubV);
}

// --- Gesamte Liste ----------------------------------------------------
function zeichne(el, videos) {
  if (!videos.length) {
    el.innerHTML = `
      <div class="card card--pad empty-card">
        <div class="empty-emoji">🎬</div>
        <p class="empty-title">Noch keine Videos</p>
        <p class="muted">Sobald wir dein erstes Video anlegen, siehst du hier den Fortschritt.</p>
      </div>`;
    return;
  }

  // Laufende Produktionen zuerst, veröffentlichte/verworfene ans Ende.
  const sortiert = videos.slice().sort((a, b) => rang(a) - rang(b));
  el.innerHTML = sortiert.map(karteHtml).join("");
}

// Sortier-Rang: offene Freigaben ganz oben, dann laufende, dann fertige/verworfen.
function rang(v) {
  if (v.status === STATUS.VERWORFEN) return 3;
  if (istFreigabeStufe(v.status)) return 0;
  if (v.status === STATUS.GEPOSTET) return 2;
  return 1;
}

// --- Eine Video-Karte -------------------------------------------------
function karteHtml(v) {
  const ks = kundenStatus(v.status);
  const typZeile = [
    v.typ ? escapeHtml(v.typ) : "",
    (v.entwurf || 1) > 1 ? "Entwurf " + (v.entwurf || 1) : ""
  ].filter(Boolean).join(" · ");

  // Verworfen: keine Timeline, nur klarer Hinweis.
  if (v.status === STATUS.VERWORFEN) {
    return `
      <div class="card card--pad mv-card mv-card--verworfen">
        <div class="mv-head">
          <span class="mv-titel">${escapeHtml(v.titel || "Unbenanntes Video")}</span>
          <span class="pill pill--rot">${escapeHtml(ks.label)}</span>
        </div>
        ${typZeile ? `<div class="mv-sub muted">${typZeile}</div>` : ""}
      </div>`;
  }

  const offen = istFreigabeStufe(v.status);          // wartet auf DEINE Freigabe
  const timeline = timelineHtml(v);
  const href = `#/video/${encodeURIComponent(v.id)}`;

  const cta = offen
    ? `<span class="mv-cta btn btn--accent btn--sm">Ansehen &amp; freigeben →</span>`
    : `<span class="mv-cta-link">Details ansehen →</span>`;

  return `
    <a class="card card--pad mv-card${offen ? " mv-card--offen" : ""}" href="${href}">
      <div class="mv-head">
        <span class="mv-titel">${escapeHtml(v.titel || "Unbenanntes Video")}</span>
        <span class="pill pill--${ks.ton}">${escapeHtml(ks.label)}</span>
      </div>
      ${typZeile ? `<div class="mv-sub muted">${typZeile}</div>` : ""}
      ${timeline}
      <div class="mv-foot">${cta}</div>
    </a>`;
}

// --- Vertikaler Stepper -----------------------------------------------
function timelineHtml(v) {
  const mitSkript = skriptFreigabeNoetig(v.typ);
  const schritte = SCHRITTE.filter((s) => mitSkript || !s.nurMitSkript);
  const curIdx = statusIndex(v.status);
  const gepostet = v.status === STATUS.GEPOSTET;

  // Aktiver Schritt = der letzte, dessen Schwelle bereits erreicht ist.
  let aktivPos = 0;
  schritte.forEach((s, i) => { if (statusIndex(s.ab) <= curIdx) aktivPos = i; });

  const zeilen = schritte.map((s, i) => {
    let zustand = i < aktivPos ? "done" : i > aktivPos ? "todo" : "current";
    // Ist der aktuelle Schritt eine Freigabe, die auf den Kunden wartet →
    // eigener „warte"-Zustand (gelb, Sanduhr).
    const warten = zustand === "current" && s.freigabe && istFreigabeStufe(v.status);
    if (gepostet) zustand = "done";   // Veröffentlicht → alles abgehakt

    let label = s.label;
    if (s.key === "fertig" && gepostet) label = "Veröffentlicht";

    const marker = warten ? "⏳" : (zustand === "done" ? "✓" : "");
    const klasse = warten ? "is-warten" : "is-" + zustand;
    const hint = warten ? `<span class="mv-step-hint">wartet auf dich</span>` : "";

    return `
      <li class="mv-step ${klasse}">
        <span class="mv-dot">${marker}</span>
        <span class="mv-step-label">${escapeHtml(label)}${hint}</span>
      </li>`;
  }).join("");

  return `<ul class="mv-timeline">${zeilen}</ul>`;
}
