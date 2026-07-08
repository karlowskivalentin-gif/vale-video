// =====================================================================
// Gemeinsame, read-only Darstellung eines Plan-Inhalts.
//
// Genau EINE Render-Logik für zwei Aufrufer, damit Admin und Kunde 1:1
// dasselbe sehen:
//   - admin-video-edit.js  → speist den LIVE aus /plaene geladenen Plan ein.
//   - kunde-video-detail.js → speist den beim Deploy ins Video kopierten
//                             planSnapshot ein (der Kunde darf /plaene nicht
//                             lesen, siehe firestore.rules).
//
// Zeigt ALLES, was im Plan hinterlegt wurde: Notiz (= das Skript), offizieller
// Sound, Shotlist, Inspirations-Links (eingebettet), Anhänge (Bilder/Videos/
// Links). Anhang-Bytes liegen als Blob in /dateiblobs und werden on-demand
// geladen (get muss dem Aufrufer erlaubt sein).
// =====================================================================
import { embedHtml, verarbeiteEmbeds } from "./embeds.js";
import { escapeHtml, mdZuHtml } from "./util.js";
import { ladeDateiblob } from "./db.js";

const POST_STATUS_LABEL = { skript: "📝 Skript", shotlist: "🎬 Shotlist", geschnitten: "✂️ Geschnitten" };

// Enthält der Plan überhaupt anzeigbare Details? (steuert Leer-Text / ob der
// Aufrufer die Sektion überhaupt einblendet)
export function planHatDetails(plan) {
  if (!plan) return false;
  return !!(
    plan.notiz ||
    (plan.sound && (plan.sound.name || plan.sound.link)) ||
    (Array.isArray(plan.shotlist) && plan.shotlist.length) ||
    (Array.isArray(plan.inspirationen) && plan.inspirationen.length) ||
    (Array.isArray(plan.dateien) && plan.dateien.length)
  );
}

// Rendert die Plan-Details als Karte in `ziel`. Lädt Embeds + Anhang-Blobs.
//   opts.titel     : Überschrift (Default "📋 Aus dem Plan")
//   opts.editLink   : Hash-Link zum Plan-Editor (nur Admin) — weglassen = kein Button
//   opts.leerText   : Text, wenn der Plan (noch) keine Details enthält
//   opts.anhangLabel: Überschrift des Anhang-Blocks (Default "Anhänge aus dem Post")
export function renderPlanDetails(ziel, plan, opts = {}) {
  if (!ziel) return;
  const titel      = opts.titel || "📋 Aus dem Plan";
  const leerText   = opts.leerText || "Der Plan enthält (noch) keine Details.";
  const anhLabel   = opts.anhangLabel || "Anhänge aus dem Post";

  const postBadge = plan && plan.poststatus && POST_STATUS_LABEL[plan.poststatus]
    ? `<span class="plan-badge plan-badge--post">${POST_STATUS_LABEL[plan.poststatus]}</span>` : "";

  const editBtn = opts.editLink
    ? `<a class="btn btn--ghost btn--sm" href="${escapeHtml(opts.editLink)}">Plan öffnen ↗</a>` : "";

  const notizHtml = (plan && plan.notiz)
    ? `<div class="ave-plan-block"><div class="gd-abschnitt-titel">Notizen</div>
        <div class="gd-md-preview" style="font-size:.92rem">${mdZuHtml(plan.notiz)}</div></div>` : "";

  const soundHtml = (plan && plan.sound && (plan.sound.name || plan.sound.link))
    ? `<div class="ave-plan-block"><div class="gd-abschnitt-titel">Offizieller Sound</div>
        <p style="margin:.3rem 0">${escapeHtml(plan.sound.name || "")}
        ${plan.sound.link ? ` — <a href="${escapeHtml(plan.sound.link)}" target="_blank" rel="noopener">Sound öffnen ↗</a>` : ""}</p></div>` : "";

  const shotHtml = (plan && Array.isArray(plan.shotlist) && plan.shotlist.length)
    ? `<div class="ave-plan-block"><div class="gd-abschnitt-titel">Shotlist</div>
        <ul class="ave-plan-shots">${plan.shotlist.map((s) => `
          <li class="${s.erledigt ? "is-done" : ""}">${s.erledigt ? "✅" : "⬜"} ${escapeHtml(s.text || "")}
          ${s.notiz ? `<div class="muted" style="font-size:.8rem;margin-left:1.6rem">📝 ${escapeHtml(s.notiz)}</div>` : ""}</li>`).join("")}</ul></div>` : "";

  const inspHtml = (plan && Array.isArray(plan.inspirationen) && plan.inspirationen.length)
    ? `<div class="ave-plan-block"><div class="gd-abschnitt-titel">Inspirationen</div>
        <div class="plan-insp-liste">${plan.inspirationen.map((i) => `
          <div class="plan-insp">${embedHtml(i.url)}
            <a class="plan-insp-link" href="${escapeHtml(i.url)}" target="_blank" rel="noopener">${escapeHtml(i.url)} ↗</a>
          </div>`).join("")}</div></div>` : "";

  const dateien = (plan && Array.isArray(plan.dateien)) ? plan.dateien : [];
  const anhHtml = dateien.length
    ? `<div class="ave-plan-block"><div class="gd-abschnitt-titel">${escapeHtml(anhLabel)}</div>
        <div class="plan-anh-liste" id="avePlanAnh"></div></div>` : "";

  const hatDetails = notizHtml || soundHtml || shotHtml || inspHtml || anhHtml;

  ziel.innerHTML = `
    <section class="card card--pad" style="margin-top:1.5rem">
      <div class="plan-head-row">
        <h2 class="section-title" style="margin:0">${escapeHtml(titel)} ${postBadge}</h2>
        ${editBtn}
      </div>
      ${notizHtml}${soundHtml}${shotHtml}${inspHtml}${anhHtml}
      ${!hatDetails ? `<p class="muted" style="margin:0">${escapeHtml(leerText)}</p>` : ""}
    </section>`;
  verarbeiteEmbeds(ziel);

  // Anhänge (Blobs on-demand, Links als Embed/Bild/Video).
  const anhZiel = ziel.querySelector("#avePlanAnh");
  if (anhZiel) {
    dateien.forEach((att) => {
      const box = document.createElement("div");
      box.className = "plan-anh";
      box.innerHTML = `<div class="plan-anh-name">${(att.art === "link" ? "🔗 " : "📄 ")}${escapeHtml(att.name || att.url || "Datei")}</div><div class="plan-anh-media"></div>`;
      anhZiel.appendChild(box);
      const el = box.querySelector(".plan-anh-media");
      if (att.art === "link") {
        const u = String(att.url || "").toLowerCase();
        if (/\.(png|jpe?g|gif|webp|svg)(\?.*)?$/.test(u)) el.innerHTML = `<img class="plan-anh-img" src="${escapeHtml(att.url)}" alt="">`;
        else if (/\.(mp4|webm|mov|m4v)(\?.*)?$/.test(u)) el.innerHTML = `<video class="plan-anh-vid" controls src="${escapeHtml(att.url)}"></video>`;
        else { el.innerHTML = embedHtml(att.url); verarbeiteEmbeds(el); }
        return;
      }
      if (!att.blobId) { el.innerHTML = `<span class="plan-anh-fehler">Datei fehlt</span>`; return; }
      el.innerHTML = `<span class="muted" style="font-size:.8rem">lädt …</span>`;
      ladeDateiblob(att.blobId).then((b) => {
        if (!b) { el.innerHTML = `<span class="plan-anh-fehler">Datei nicht gefunden</span>`; return; }
        const url = `data:${b.typ};base64,${b.base64}`;
        const typ = b.typ || att.typ || "";
        if (typ.startsWith("image/"))      el.innerHTML = `<img class="plan-anh-img" src="${url}" alt="">`;
        else if (typ.startsWith("video/")) el.innerHTML = `<video class="plan-anh-vid" controls src="${url}"></video>`;
        else if (typ.startsWith("audio/")) el.innerHTML = `<audio style="width:100%" controls src="${url}"></audio>`;
        else el.innerHTML = `<a class="btn btn--ghost btn--sm" href="${url}" download="${escapeHtml(att.name || "datei")}">Herunterladen ↓</a>`;
      }).catch(() => { el.innerHTML = `<span class="plan-anh-fehler">Fehler beim Laden</span>`; });
    });
  }
}

// Reduziert einen vollständigen Plan auf den Ausschnitt, den der Kunde sehen
// darf/soll — den „Snapshot", der beim Deploy ins Video kopiert wird. Bewusst
// NUR die inhaltlichen Felder (keine internen IDs/Status der Planung).
export function planZuSnapshot(plan) {
  if (!plan) return null;
  return {
    notiz:         plan.notiz || "",
    sound:         plan.sound || { name: "", link: "" },
    shotlist:      Array.isArray(plan.shotlist) ? plan.shotlist : [],
    inspirationen: Array.isArray(plan.inspirationen) ? plan.inspirationen : [],
    dateien:       Array.isArray(plan.dateien) ? plan.dateien : [],
    poststatus:    plan.poststatus || ""
  };
}
