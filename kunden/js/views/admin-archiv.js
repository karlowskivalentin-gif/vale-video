// Admin-View: Archiv. Alle veröffentlichten (geposteten) Videos — read-orientiert.
// Gepostete Beiträge bleiben zusätzlich in der Pipeline sichtbar; hier werden sie
// als abgeschlossenes Archiv gebündelt (Titel → Video-Bearbeiten, kein Status-Dropdown).
import { beobachteVideos } from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { STATUS } from "../status.js";
import { escapeHtml, formatDatum } from "../util.js";

export function renderAdminArchiv(container, opts = {}) {
  const kundeId = opts.kundeId || null;
  container.innerHTML = `
    <div class="admin-head">
      <h1 class="view-title" style="margin:0">Archiv</h1>
    </div>
    <p class="muted view-intro">Veröffentlichte Beiträge (Status „🚀 Gepostet"). Sie bleiben auch in der Pipeline sichtbar.</p>
    <div id="arList"><div class="card card--pad"><p class="muted">Wird geladen …</p></div></div>`;

  const arList = container.querySelector("#arList");

  const unsub = beobachteVideos(
    (videos) => {
      const gepostet = videos
        .filter((v) => v.status === STATUS.GEPOSTET)
        .sort((a, b) => tsSek(b.aktualisiertAm) - tsSek(a.aktualisiertAm));   // zuletzt gepostet zuerst
      zeichne(arList, gepostet);
    },
    (err) => {
      console.error(err);
      arList.innerHTML = `<div class="card card--pad"><p class="notice notice--error" style="margin:0">
        Konnte nicht laden.</p></div>`;
    },
    kundeId
  );
  beiViewWechsel(unsub);
}

function zeichne(el, videos) {
  if (!videos.length) {
    el.innerHTML = `<div class="card card--pad empty-card">
      <div class="empty-emoji">📦</div>
      <p class="empty-title">Noch nichts archiviert</p>
      <p class="muted">Sobald ein Video auf „🚀 Gepostet" steht, erscheint es hier.</p>
    </div>`;
    return;
  }
  el.innerHTML = `<div class="card row-list">
    ${videos.map(rowHtml).join("")}
  </div>`;
}

function rowHtml(v) {
  return `
    <div class="pl-item">
      <div class="pl-row">
        <div class="pl-main">
          <a class="row-name" href="#/admin/video/${encodeURIComponent(v.id)}">${escapeHtml(v.titel || "Unbenanntes Video")}</a>
          <span class="row-sub muted">
            ${v.typ ? escapeHtml(v.typ) + " · " : ""}🚀 Veröffentlicht
            ${(v.entwurf || 1) > 1 ? " · 📝 Entwurf " + (v.entwurf || 1) : ""}
            ${v.geplantesDatum ? " · 📅 " + escapeHtml(formatDatum(v.geplantesDatum)) : ""}
          </span>
        </div>
      </div>
    </div>`;
}

function tsSek(t) { return (t && t.seconds) || 0; }
