// Kunden-Startseite: oben Videos, die auf eine Freigabe warten (= Aktionen),
// darunter eine Übersicht aller Videos und die gemeldeten Objekte.
// Interne Pipeline-Stufen werden NIE gezeigt – nur das Kunden-Mapping.
import { beobachteVideos, beobachteObjekte } from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { kundenStatus, istFreigabeStufe, OBJEKT_STATUS } from "../status.js";
import { escapeHtml, formatDatum } from "../util.js";

export function renderAufgaben(container, opts = {}) {
  const kundeId = opts.kundeId || null;   // eigener Mandant des eingeloggten Kunden
  container.innerHTML = `
    <h1 class="view-title">Aufgaben</h1>
    <p class="muted view-intro">Dein Überblick: offene Freigaben, deine Videos und gemeldete Objekte.</p>

    <section id="secAufgaben" class="stack"></section>
    <section id="secVideos"   class="stack"></section>
    <section id="secObjekte"  class="stack"></section>`;

  const secAufgaben = container.querySelector("#secAufgaben");
  const secVideos   = container.querySelector("#secVideos");
  const secObjekte  = container.querySelector("#secObjekte");

  secAufgaben.innerHTML = ladeBlock("Wird geladen …");
  secVideos.innerHTML   = "";
  secObjekte.innerHTML  = "";

  let videos = null;
  let objekte = null;

  function rerender() {
    if (videos === null) return; // erste Videos noch nicht da
    zeichneAufgaben(secAufgaben, videos);
    zeichneVideos(secVideos, videos);
    if (objekte !== null) zeichneObjekte(secObjekte, objekte);
  }

  const unsubV = beobachteVideos(
    (liste) => { videos = liste; rerender(); },
    (err) => { console.error(err); secAufgaben.innerHTML = fehlerBlock(); },
    kundeId
  );
  const unsubO = beobachteObjekte(
    (liste) => { objekte = liste; rerender(); },
    (err) => { console.error(err); },
    kundeId
  );

  beiViewWechsel(unsubV);
  beiViewWechsel(unsubO);
}

// --- Block: offene Freigaben ------------------------------------------
function zeichneAufgaben(el, videos) {
  const offen = videos.filter((v) => istFreigabeStufe(v.status));
  if (!offen.length) {
    el.innerHTML = `
      <div class="card card--pad empty-card">
        <div class="empty-emoji">✅</div>
        <p class="empty-title">Alles erledigt</p>
        <p class="muted">Aktuell wartet nichts auf deine Freigabe.</p>
      </div>`;
    return;
  }
  el.innerHTML = `
    <h2 class="section-title">Wartet auf dich <span class="count-badge">${offen.length}</span></h2>
    <div class="task-list">
      ${offen.map((v) => {
        const ks = kundenStatus(v.status);
        return `
          <a class="card card--pad task-card" href="#/video/${encodeURIComponent(v.id)}">
            <div class="task-main">
              <span class="pill pill--aktion">${escapeHtml(ks.label)}</span>
              <span class="task-name">${escapeHtml(v.titel || "Unbenanntes Video")}</span>
              ${v.typ ? `<span class="task-typ muted">${escapeHtml(v.typ)}${(v.entwurf || 1) > 1 ? " · Entwurf " + (v.entwurf || 1) : ""}</span>` : ((v.entwurf || 1) > 1 ? `<span class="task-typ muted">Entwurf ${v.entwurf}</span>` : "")}
            </div>
            <span class="task-cta btn btn--accent btn--sm">Ansehen &amp; freigeben</span>
          </a>`;
      }).join("")}
    </div>`;
}

// --- Block: alle Videos (Übersicht) -----------------------------------
function zeichneVideos(el, videos) {
  if (!videos.length) {
    el.innerHTML = `
      <h2 class="section-title">Deine Videos</h2>
      <div class="card card--pad"><p class="muted">Noch keine Videos angelegt.</p></div>`;
    return;
  }
  el.innerHTML = `
    <h2 class="section-title">Deine Videos</h2>
    <div class="card row-list">
      ${videos.map((v) => {
        const ks = kundenStatus(v.status);
        return `
          <a class="row-item" href="#/video/${encodeURIComponent(v.id)}">
            <span class="row-name">${escapeHtml(v.titel || "Unbenanntes Video")}</span>
            <span class="pill pill--${ks.ton}">${escapeHtml(ks.label)}</span>
          </a>`;
      }).join("")}
    </div>`;
}

// --- Block: gemeldete Objekte -----------------------------------------
function zeichneObjekte(el, objekte) {
  const kopf = `<h2 class="section-title">Deine gemeldeten Objekte</h2>`;
  if (!objekte.length) {
    el.innerHTML = `${kopf}
      <div class="card card--pad empty-card">
        <p class="muted">Noch keine Objekte gemeldet.</p>
        <a class="btn btn--ghost btn--sm" href="#/objekt-melden">Objekt melden</a>
      </div>`;
    return;
  }
  el.innerHTML = `${kopf}
    <div class="card row-list">
      ${objekte.map((o) => `
        <div class="row-item row-item--static">
          <span class="row-main">
            <span class="row-name">${escapeHtml(o.adresse || "Ohne Adresse")}</span>
            <span class="row-sub muted">${escapeHtml(o.objektTyp || "")}${
              o.erstelltAm ? " · gemeldet " + escapeHtml(formatDatum(o.erstelltAm)) : ""
            }</span>
          </span>
          <span class="pill pill--${objektTon(o.status)}">${escapeHtml(o.status || OBJEKT_STATUS.EINGEGANGEN)}</span>
        </div>`).join("")}
    </div>`;
}

function objektTon(status) {
  if (status === OBJEKT_STATUS.ERLEDIGT) return "ok";
  return "neutral";
}

function ladeBlock(text) {
  return `<div class="card card--pad"><p class="muted">${escapeHtml(text)}</p></div>`;
}
function fehlerBlock() {
  return `<div class="card card--pad"><p class="notice notice--error" style="margin:0">
    Daten konnten nicht geladen werden. Ist die Firestore-Datenbank schon eingerichtet?
  </p></div>`;
}
