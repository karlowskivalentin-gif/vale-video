// Admin-View: Pipeline. Alle Videos mit Status-Dropdown (alle 10 Stufen).
// Beim Setzen auf eine Freigabe-Stufe → EmailJS-Benachrichtigung an die Kunden.
import { beobachteVideos, adminSetzeStatus } from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { STATUS, STATUS_REIHENFOLGE, istFreigabeStufe, kundenStatus } from "../status.js";
import { sendKundeFreigabe } from "../email.js";
import { escapeHtml, formatDatum } from "../util.js";

export function renderAdminPipeline(container) {
  container.innerHTML = `
    <div class="admin-head">
      <h1 class="view-title" style="margin:0">Pipeline</h1>
      <a class="btn btn--accent btn--sm" href="#/admin/video/neu">+ Neues Video</a>
    </div>
    <p class="muted view-intro">Status frei steuerbar. Auf eine Freigabe-Stufe gesetzt → Kunde wird benachrichtigt.</p>
    <div id="plList"><div class="card card--pad"><p class="muted">Wird geladen …</p></div></div>`;

  const plList = container.querySelector("#plList");

  const unsub = beobachteVideos(
    (videos) => zeichne(plList, videos),
    (err) => {
      console.error(err);
      plList.innerHTML = `<div class="card card--pad"><p class="notice notice--error" style="margin:0">
        Konnte nicht laden. Ist die Firestore-Datenbank eingerichtet?</p></div>`;
    }
  );
  beiViewWechsel(unsub);
}

function zeichne(el, videos) {
  if (!videos.length) {
    el.innerHTML = `<div class="card card--pad empty-card">
      <div class="empty-emoji">🎬</div>
      <p class="empty-title">Noch keine Videos</p>
      <a class="btn btn--accent btn--sm" href="#/admin/video/neu">Erstes Video anlegen</a>
    </div>`;
    return;
  }

  el.innerHTML = `<div class="card row-list">
    ${videos.map((v) => {
      const ks = kundenStatus(v.status);
      const opts = STATUS_REIHENFOLGE
        .map((s) => `<option value="${escapeHtml(s)}"${s === v.status ? " selected" : ""}>${escapeHtml(s)}</option>`)
        .join("");
      return `
        <div class="pl-row" data-id="${escapeHtml(v.id)}">
          <div class="pl-main">
            <a class="row-name" href="#/admin/video/${encodeURIComponent(v.id)}">${escapeHtml(v.titel || "Unbenanntes Video")}</a>
            <span class="row-sub muted">
              ${v.typ ? escapeHtml(v.typ) + " · " : ""}Kunde sieht: „${escapeHtml(ks.label)}"
              ${v.geplantesDatum ? " · 📅 " + escapeHtml(formatDatum(v.geplantesDatum)) : ""}
            </span>
          </div>
          <select class="pl-status field-inline" aria-label="Status">${opts}</select>
        </div>`;
    }).join("")}
  </div>`;

  el.querySelectorAll(".pl-row").forEach((row) => {
    const id = row.getAttribute("data-id");
    const sel = row.querySelector(".pl-status");
    const video = videos.find((x) => x.id === id);
    sel.addEventListener("change", async () => {
      const neu = sel.value;
      sel.disabled = true;
      try {
        await adminSetzeStatus(id, neu);
        if (istFreigabeStufe(neu)) {
          const art = neu === STATUS.FREIGABE_SKRIPT ? "Skript" : "Schnitt";
          sendKundeFreigabe({ titel: (video && video.titel) || "Dein Video", art, videoId: id });
        }
      } catch (e) {
        console.error(e);
        alert("Status konnte nicht gespeichert werden.");
      } finally {
        sel.disabled = false;
      }
    });
  });
}
