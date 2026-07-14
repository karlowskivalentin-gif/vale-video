// Admin-View: Pipeline. Alle Videos mit Status-Dropdown (alle Stufen).
// Beim Setzen auf eine Freigabe-Stufe → EmailJS-Benachrichtigung an die Kunden.
// Zusätzlich: pro Video ein 💬-Nachrichten-Block (Kunden-Kommentare &
// Änderungswünsche) mit Bearbeitungs-Status (neu → gelesen → in Umsetzung →
// umgesetzt). Ein einziger collectionGroup-Listener liefert alle Kommentare.
import {
  beobachteVideos, adminSetzeStatus, loescheVideo, aktualisierePlan,
  beobachteAlleKommentare, kommentarSetzeBearbeitung
} from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { STATUS, STATUS_REIHENFOLGE, istFreigabeStufe, kundenStatus } from "../status.js";
import { sendKundeFreigabe } from "../email.js";
import { escapeHtml, formatDatum } from "../util.js";

const BEARB_LABEL = {
  neu: "Neu", gelesen: "Gelesen", in_umsetzung: "In Umsetzung", umgesetzt: "Umgesetzt"
};

export function renderAdminPipeline(container, opts = {}) {
  const kundeId = opts.kundeId || null;
  container.innerHTML = `
    <div class="admin-head">
      <h1 class="view-title" style="margin:0">Pipeline</h1>
      <a class="btn btn--accent btn--sm" href="#/admin/video/neu">+ Neues Video</a>
    </div>
    <p class="muted view-intro">Status frei steuerbar. Auf eine Freigabe-Stufe gesetzt → Kunde wird benachrichtigt.</p>
    <div id="plList"><div class="card card--pad"><p class="muted">Wird geladen …</p></div></div>`;

  const plList = container.querySelector("#plList");

  let videos = [];
  let kommMap = new Map();   // videoId → [Kunden-Kommentare], neueste zuerst
  const offen = new Set();   // aufgeklappte Nachrichten-Blöcke (videoId)
  let videosGeladen = false;

  const render = () => zeichne(plList, videos, kommMap, offen);

  const unsubV = beobachteVideos(
    (v) => { videos = v; videosGeladen = true; render(); },
    (err) => {
      console.error(err);
      plList.innerHTML = `<div class="card card--pad"><p class="notice notice--error" style="margin:0">
        Konnte nicht laden. Ist die Firestore-Datenbank eingerichtet?</p></div>`;
    },
    kundeId
  );

  const unsubK = beobachteAlleKommentare(
    (liste) => {
      const m = new Map();
      liste.forEach((k) => {
        if (k.rolle !== "kunde" || !k.videoId) return;   // nur Kunden-Nachrichten
        if (!m.has(k.videoId)) m.set(k.videoId, []);
        m.get(k.videoId).push(k);
      });
      m.forEach((arr) => arr.sort((a, b) => tsSek(b.erstelltAm) - tsSek(a.erstelltAm)));
      kommMap = m;
      if (videosGeladen) render();
    },
    (err) => console.error(err)
  );

  beiViewWechsel(unsubV);
  beiViewWechsel(unsubK);
}

function zeichne(el, videos, kommMap, offen) {
  if (!videos.length) {
    el.innerHTML = `<div class="card card--pad empty-card">
      <div class="empty-emoji">🎬</div>
      <p class="empty-title">Noch keine Videos</p>
      <a class="btn btn--accent btn--sm" href="#/admin/video/neu">Erstes Video anlegen</a>
    </div>`;
    return;
  }

  el.innerHTML = `<div class="card row-list">
    ${videos.map((v) => rowHtml(v, kommMap.get(v.id) || [], offen.has(v.id))).join("")}
  </div>`;

  el.querySelectorAll(".pl-item").forEach((item) => {
    const id = item.getAttribute("data-id");
    const sel = item.querySelector(".pl-status");
    const video = videos.find((x) => x.id === id);

    // Entfernen mit 2-Klick-Bestätigung (erst „Löschen?", dann wirklich weg).
    const del = item.querySelector(".pl-del");
    del.addEventListener("click", async () => {
      if (!del.classList.contains("is-bestaetigen")) {
        del.classList.add("is-bestaetigen");
        del.textContent = "Löschen?";
        setTimeout(() => { if (del.isConnected) { del.classList.remove("is-bestaetigen"); del.textContent = "✕"; } }, 4000);
        return;
      }
      del.disabled = true;
      try {
        await loescheVideo(id);   // Liste aktualisiert der Observer
        // Stammt das Video aus einem Plan → dessen Verknüpfung lösen, damit
        // der Plan wieder "🚀 In Video-Pipeline" anbietet (kein toter Link).
        if (video && video.planId) aktualisierePlan(video.planId, { videoId: null }).catch(() => {});
      }
      catch (e) { console.error(e); del.disabled = false; del.classList.remove("is-bestaetigen"); del.textContent = "✕"; }
    });

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

    // 💬 Nachrichten-Block auf-/zuklappen (Zustand in `offen` merken, damit er
    // ein Re-Render durch neue Snapshots übersteht).
    const msgBtn = item.querySelector(".pl-msg-btn");
    const msgs   = item.querySelector(".pl-msgs");
    if (msgBtn && msgs) {
      msgBtn.addEventListener("click", () => {
        const jetztOffen = msgs.hidden;
        msgs.hidden = !jetztOffen;
        if (jetztOffen) offen.add(id); else offen.delete(id);
      });
    }

    // Bearbeitungs-Status je Nachricht setzen (gelesen / in Umsetzung / umgesetzt).
    item.querySelectorAll(".pl-msg-set").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const msg = btn.closest(".pl-msg");
        const kid = msg && msg.getAttribute("data-kid");
        const wert = btn.getAttribute("data-set");
        if (!kid) return;
        offen.add(id);   // Block offen halten
        try { await kommentarSetzeBearbeitung(id, kid, wert); }
        catch (e) { console.error(e); }
      });
    });
  });
}

function rowHtml(v, komms, istOffen) {
  const ks = kundenStatus(v.status);
  const opts = STATUS_REIHENFOLGE
    .map((s) => `<option value="${escapeHtml(s)}"${s === v.status ? " selected" : ""}>${escapeHtml(s)}</option>`)
    .join("");

  const ungelesen = komms.filter((k) => (k.bearbeitung || "neu") === "neu").length;
  const hatMsgs = komms.length > 0;
  const verworfen = v.status === STATUS.VERWORFEN ? " pl-item--verworfen" : "";

  const msgBtn = hatMsgs
    ? `<button class="pl-msg-btn${ungelesen ? " has-neu" : ""}" type="button" title="Kunden-Nachrichten">💬${ungelesen ? `<span class="pl-msg-badge">${ungelesen}</span>` : ""}</button>`
    : "";

  return `
    <div class="pl-item${verworfen}" data-id="${escapeHtml(v.id)}">
      <div class="pl-row">
        <div class="pl-main">
          <a class="row-name" href="#/admin/video/${encodeURIComponent(v.id)}">${escapeHtml(v.titel || "Unbenanntes Video")}</a>
          <span class="row-sub muted">
            ${v.typ ? escapeHtml(v.typ) + " · " : ""}Kunde sieht: „${escapeHtml(ks.label)}"
            ${(v.entwurf || 1) > 1 ? " · 📝 Entwurf " + (v.entwurf || 1) : ""}
            ${v.geplantesDatum ? " · 📅 " + escapeHtml(formatDatum(v.geplantesDatum)) : ""}
          </span>
        </div>
        ${msgBtn}
        <select class="pl-status field-inline" aria-label="Status">${opts}</select>
        <button class="pl-del" type="button" title="Video aus der Pipeline entfernen">✕</button>
      </div>
      ${hatMsgs ? `<div class="pl-msgs"${istOffen ? "" : " hidden"}>${komms.map(msgHtml).join("")}</div>` : ""}
    </div>`;
}

function msgHtml(k) {
  const status = k.bearbeitung || "neu";
  const neu = status === "neu";
  const artPill = k.art === "aenderungswunsch"
    ? `<span class="pill pill--aktion">Änderungswunsch</span>` : "";
  const setBtn = (val, label) =>
    `<button class="pl-msg-set${status === val ? " is-active" : ""}" data-set="${val}" type="button">${label}</button>`;

  return `
    <div class="pl-msg${neu ? " is-neu" : ""}" data-kid="${escapeHtml(k.id)}">
      <div class="pl-msg-head">
        <span class="pl-msg-autor">${escapeHtml(kurzname(k.autor))}</span>
        ${artPill}
        <span class="pl-msg-status pl-msg-status--${status}">${BEARB_LABEL[status] || status}</span>
        <span class="muted pl-msg-zeit">${escapeHtml(formatDatum(k.erstelltAm, true))}</span>
      </div>
      <div class="pl-msg-text">${escapeHtml(k.text)}</div>
      <div class="pl-msg-btns">
        ${setBtn("gelesen", "Gelesen")}
        ${setBtn("in_umsetzung", "In Umsetzung")}
        ${setBtn("umgesetzt", "Umgesetzt")}
      </div>
    </div>`;
}

function tsSek(t) { return (t && t.seconds) || 0; }
function kurzname(email) { return String(email || "").split("@")[0] || "Kunde"; }
