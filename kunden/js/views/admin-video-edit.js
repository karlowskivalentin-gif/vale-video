// Admin-View: Video anlegen / bearbeiten.
// Route #/admin/video/neu = Anlegen, #/admin/video/{id} = Bearbeiten.
import {
  ladeVideo, videoAnlegen, aktualisiereVideo, loescheVideo, ladeObjekte,
  beobachteKommentare, kommentarHinzufuegen, ladePlan, ladeDateiblob
} from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import {
  STATUS, STATUS_REIHENFOLGE, VIDEO_TYPEN, skriptFreigabeNoetig
} from "../status.js";
import { escapeHtml, formatDatum, tsZuDateInput, dateInputZuDate, mdZuHtml } from "../util.js";
import { embedHtml, verarbeiteEmbeds } from "../embeds.js";

export function renderAdminVideoEdit(container, ctx) {
  const user = ctx.user;
  const id = ctx.id;
  const istNeu = !id || id === "neu";

  container.innerHTML = `
    <a class="back-link" href="#/admin/pipeline">← Zurück zur Pipeline</a>
    <h1 class="view-title">${istNeu ? "Neues Video" : "Video bearbeiten"}</h1>
    <div id="aveBody"><div class="card card--pad"><p class="muted">Wird geladen …</p></div></div>`;

  const body = container.querySelector("#aveBody");

  (async function init() {
    let objekte = [];
    try { objekte = await ladeObjekte(); } catch (e) { console.error(e); }

    let video = null;
    if (!istNeu) {
      try { video = await ladeVideo(id); } catch (e) { console.error(e); }
      if (!video) {
        body.innerHTML = `<div class="card card--pad"><p class="notice notice--error" style="margin:0">
          Video nicht gefunden. <a href="#/admin/pipeline">Zurück zur Pipeline</a>.</p></div>`;
        return;
      }
    } else {
      // Optionaler Prefill, wenn aus „Objekte" ein Video angelegt wird.
      const pre = sessionStorage.getItem("neuesVideoObjekt");
      if (pre) {
        sessionStorage.removeItem("neuesVideoObjekt");
        const o = objekte.find((x) => x.id === pre);
        video = { objektId: pre, titel: o ? o.adresse : "" };
      }
    }

    body.innerHTML = formHtml(video, objekte, istNeu);
    wire(video, istNeu, body, id, user);
    if (!istNeu) initKommentare(id, user, body);
    // Stammt das Video aus einem Plan → dessen KOMPLETTE Details anzeigen
    // (Links, Dateien, Sound, Shotlist, Notiz). Live aus /plaene geladen —
    // admin-only, der Kunde kann davon nichts lesen.
    if (!istNeu && video && video.planId) initPlanDetails(video.planId, body);
  })();
}

// --- Formular ---------------------------------------------------------
function formHtml(v, objekte, istNeu) {
  const val = (k, d = "") => (v && v[k] != null ? v[k] : d);
  const typ = val("typ", "");
  const status = val("status", STATUS.IDEE);
  const objektId = val("objektId", "");

  const typOpts = ['<option value="">— Typ wählen —</option>']
    .concat(VIDEO_TYPEN.map((t) => `<option value="${escapeHtml(t)}"${t === typ ? " selected" : ""}>${escapeHtml(t)}</option>`))
    .join("");
  const statusOpts = STATUS_REIHENFOLGE
    .map((s) => `<option value="${escapeHtml(s)}"${s === status ? " selected" : ""}>${escapeHtml(s)}</option>`)
    .join("");
  const objektOpts = ['<option value="">— kein Objekt —</option>']
    .concat(objekte.map((o) =>
      `<option value="${escapeHtml(o.id)}"${o.id === objektId ? " selected" : ""}>${escapeHtml(o.adresse || o.id)}</option>`))
    .join("");

  const cinematicHinweis = typ && !skriptFreigabeNoetig(typ)
    ? `<p class="field-hint muted">Bei „${escapeHtml(typ)}" ist keine separate Skript-Freigabe nötig.</p>` : "";

  const freigabeInfo = (!istNeu && v) ? `
    <div class="freigabe-info">
      <div><span class="muted">Skript-Freigabe:</span> ${freigText(v.freigabeSkript)}</div>
      <div><span class="muted">Schnitt-Freigabe:</span> ${freigText(v.freigabeSchnitt)}</div>
    </div>` : "";

  return `
    <section class="card card--pad form-card">
      <div class="notice notice--ok"    id="aveOk"  hidden role="status"></div>
      <div class="notice notice--error" id="aveErr" hidden role="alert"></div>

      <form id="aveForm" novalidate>
        <div class="field">
          <label for="f-titel">Titel <span class="req">*</span></label>
          <input id="f-titel" type="text" value="${escapeHtml(val("titel"))}" placeholder="z. B. Objektvideo Musterstraße 1" required />
        </div>

        <div class="grid-2">
          <div class="field">
            <label for="f-typ">Typ</label>
            <select id="f-typ">${typOpts}</select>
            ${cinematicHinweis}
          </div>
          <div class="field">
            <label for="f-status">Status</label>
            <select id="f-status">${statusOpts}</select>
          </div>
        </div>

        <div class="field">
          <label for="f-objekt">Verknüpftes Objekt</label>
          <select id="f-objekt">${objektOpts}</select>
        </div>

        <div class="field">
          <label for="f-skript">Skript-Link (Google Drive)</label>
          <input id="f-skript" type="url" value="${escapeHtml(val("skriptLink"))}" placeholder="https://drive.google.com/file/d/…/view" />
        </div>

        <div class="field">
          <label for="f-schnitt">Schnitt-Link (YouTube, nicht gelistet)</label>
          <input id="f-schnitt" type="url" value="${escapeHtml(val("schnittLink"))}" placeholder="https://youtu.be/…  oder  https://www.youtube.com/watch?v=…" />
        </div>

        <div class="grid-2">
          <div class="field">
            <label for="f-datum">Geplantes Veröffentlichungsdatum</label>
            <input id="f-datum" type="date" value="${escapeHtml(tsZuDateInput(val("geplantesDatum", null)))}" />
          </div>
          <div class="field">
            <label for="f-drehdatum">Geplanter Drehtermin</label>
            <input id="f-drehdatum" type="date" value="${escapeHtml(tsZuDateInput(val("geplanterDrehtermin", null)))}" />
          </div>
        </div>

        ${freigabeInfo}

        <div class="action-btns" style="margin-top:1.25rem">
          <button class="btn btn--accent" id="aveSave" type="submit">${istNeu ? "Anlegen" : "Speichern"}</button>
          ${!istNeu ? `<button class="btn btn--ghost" id="aveDelete" type="button">Löschen</button>` : ""}
        </div>
      </form>
    </section>
    ${!istNeu && v && v.planId ? `<div id="avePlanDetails"></div>` : ""}
    ${!istNeu ? `
    <section class="vd-komm">
      <h2 class="section-title">Kommentare &amp; Änderungswünsche</h2>
      <div id="aveKomms" class="komm-list"><p class="muted">Wird geladen …</p></div>
      <form id="aveKommForm" class="komm-form card card--pad">
        <div class="field" style="margin:0 0 .75rem">
          <label for="aveKommText">Antwort / Notiz an Kunde</label>
          <textarea id="aveKommText" placeholder="Antwort oder interne Notiz …"></textarea>
        </div>
        <div class="notice notice--error" id="aveKommErr" hidden role="alert"></div>
        <button class="btn btn--ghost btn--sm" type="submit" id="aveKommSubmit">Kommentar senden</button>
      </form>
    </section>` : ""}`;
}

function freigText(f) {
  if (!f) return `<span class="muted">offen</span>`;
  return `${escapeHtml(f.by || "Kunde")} · ${escapeHtml(formatDatum(f.at, true))}`;
}

// --- Speichern / Anlegen / Löschen ------------------------------------
function wire(v, istNeu, body, id, user) {
  const form   = body.querySelector("#aveForm");
  const okBox  = body.querySelector("#aveOk");
  const errBox = body.querySelector("#aveErr");
  const save   = body.querySelector("#aveSave");
  const del    = body.querySelector("#aveDelete");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    okBox.hidden = true; errBox.hidden = true;

    const daten = {
      titel:       body.querySelector("#f-titel").value.trim(),
      typ:         body.querySelector("#f-typ").value,
      status:      body.querySelector("#f-status").value,
      objektId:    body.querySelector("#f-objekt").value || null,
      skriptLink:  body.querySelector("#f-skript").value.trim(),
      schnittLink: body.querySelector("#f-schnitt").value.trim(),
      geplantesDatum:     dateInputZuDate(body.querySelector("#f-datum").value),
      geplanterDrehtermin: dateInputZuDate(body.querySelector("#f-drehdatum").value)
    };

    if (!daten.titel) { errBox.textContent = "Bitte einen Titel eingeben."; errBox.hidden = false; return; }

    save.disabled = true;
    const orig = save.textContent;
    save.textContent = istNeu ? "Wird angelegt …" : "Wird gespeichert …";
    try {
      if (istNeu) {
        const ref = await videoAnlegen(daten);
        location.hash = "/admin/video/" + ref.id;   // → lädt im Bearbeiten-Modus neu
      } else {
        await aktualisiereVideo(id, daten);
        okBox.textContent = "Gespeichert.";
        okBox.hidden = false;
        okBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    } catch (err) {
      console.error(err);
      errBox.textContent = "Speichern fehlgeschlagen.";
      errBox.hidden = false;
    } finally {
      save.disabled = false;
      save.textContent = orig;
    }
  });

  if (del) {
    del.addEventListener("click", async () => {
      if (!confirm("Dieses Video wirklich löschen? Das kann nicht rückgängig gemacht werden.")) return;
      del.disabled = true;
      try {
        await loescheVideo(id);
        location.hash = "/admin/pipeline";
      } catch (err) {
        console.error(err);
        errBox.textContent = "Löschen fehlgeschlagen.";
        errBox.hidden = false;
        del.disabled = false;
      }
    });
  }
}

// --- Plan-Details (1:1 aus dem Herkunfts-Plan, read-only) --------------
// Zeigt ALLES, was im Plan hinterlegt wurde: Notiz, Sound, Shotlist,
// Inspirations-Links (eingebettet), Anhänge (Bilder/Videos/Links aus einem
// Post). Änderungen macht man im Plan — Link oben rechts.
const POST_STATUS_LABEL = { skript: "📝 Skript", shotlist: "🎬 Shotlist", geschnitten: "✂️ Geschnitten" };

async function initPlanDetails(planId, body) {
  const ziel = body.querySelector("#avePlanDetails");
  if (!ziel) return;
  ziel.innerHTML = `<section class="card card--pad" style="margin-top:1.5rem"><p class="muted">Plan-Details werden geladen …</p></section>`;
  let plan = null;
  try { plan = await ladePlan(planId); } catch (e) { console.error(e); }
  if (!plan) {
    ziel.innerHTML = `<section class="card card--pad" style="margin-top:1.5rem"><p class="muted">Herkunfts-Plan nicht (mehr) gefunden.</p></section>`;
    return;
  }

  const postBadge = plan.poststatus && POST_STATUS_LABEL[plan.poststatus]
    ? `<span class="plan-badge plan-badge--post">${POST_STATUS_LABEL[plan.poststatus]}</span>` : "";

  const inspHtml = (Array.isArray(plan.inspirationen) && plan.inspirationen.length)
    ? `<div class="ave-plan-block"><div class="gd-abschnitt-titel">Inspirationen</div>
        <div class="plan-insp-liste">${plan.inspirationen.map((i) => `
          <div class="plan-insp">${embedHtml(i.url)}
            <a class="plan-insp-link" href="${escapeHtml(i.url)}" target="_blank" rel="noopener">${escapeHtml(i.url)} ↗</a>
          </div>`).join("")}</div></div>` : "";

  const soundHtml = (plan.sound && (plan.sound.name || plan.sound.link))
    ? `<div class="ave-plan-block"><div class="gd-abschnitt-titel">Offizieller Sound</div>
        <p style="margin:.3rem 0">${escapeHtml(plan.sound.name || "")}
        ${plan.sound.link ? ` — <a href="${escapeHtml(plan.sound.link)}" target="_blank" rel="noopener">Sound öffnen ↗</a>` : ""}</p></div>` : "";

  const shotHtml = (Array.isArray(plan.shotlist) && plan.shotlist.length)
    ? `<div class="ave-plan-block"><div class="gd-abschnitt-titel">Shotlist</div>
        <ul class="ave-plan-shots">${plan.shotlist.map((s) => `
          <li class="${s.erledigt ? "is-done" : ""}">${s.erledigt ? "✅" : "⬜"} ${escapeHtml(s.text || "")}
          ${s.notiz ? `<div class="muted" style="font-size:.8rem;margin-left:1.6rem">📝 ${escapeHtml(s.notiz)}</div>` : ""}</li>`).join("")}</ul></div>` : "";

  const notizHtml = plan.notiz
    ? `<div class="ave-plan-block"><div class="gd-abschnitt-titel">Notizen</div>
        <div class="gd-md-preview" style="font-size:.92rem">${mdZuHtml(plan.notiz)}</div></div>` : "";

  const dateien = Array.isArray(plan.dateien) ? plan.dateien : [];
  const anhHtml = dateien.length
    ? `<div class="ave-plan-block"><div class="gd-abschnitt-titel">Anhänge aus dem Post</div>
        <div class="plan-anh-liste" id="avePlanAnh"></div></div>` : "";

  ziel.innerHTML = `
    <section class="card card--pad" style="margin-top:1.5rem">
      <div class="plan-head-row">
        <h2 class="section-title" style="margin:0">📋 Aus dem Plan ${postBadge}</h2>
        <a class="btn btn--ghost btn--sm" href="#/admin/plan/${encodeURIComponent(planId)}">Plan öffnen ↗</a>
      </div>
      ${notizHtml}${soundHtml}${shotHtml}${inspHtml}${anhHtml}
      ${!notizHtml && !soundHtml && !shotHtml && !inspHtml && !anhHtml
        ? `<p class="muted" style="margin:0">Der Plan enthält (noch) keine Details.</p>` : ""}
    </section>`;
  verarbeiteEmbeds(ziel);

  // Anhänge (Blobs on-demand, Links als Embed/Bild/Video) — wie im Plan-Editor.
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

// --- Kommentare (Bearbeiten-Modus) ------------------------------------
function initKommentare(id, user, body) {
  const liste = body.querySelector("#aveKomms");
  const form  = body.querySelector("#aveKommForm");
  const text  = body.querySelector("#aveKommText");
  const err   = body.querySelector("#aveKommErr");
  const submit = body.querySelector("#aveKommSubmit");

  const unsub = beobachteKommentare(id,
    (komms) => {
      if (!komms.length) { liste.innerHTML = `<p class="muted">Noch keine Kommentare.</p>`; return; }
      liste.innerHTML = komms.map((k) => {
        const autor = k.rolle === "admin" ? "Du (Valentin)" : (String(k.autor || "").split("@")[0] || "Kunde");
        const wunsch = k.art === "aenderungswunsch" ? `<span class="pill pill--aktion">Änderungswunsch</span>` : "";
        return `
          <div class="komm komm--${escapeHtml(k.rolle || "kunde")}">
            <div class="komm-head">
              <span class="komm-autor">${escapeHtml(autor)}</span>
              ${wunsch}
              <span class="komm-zeit muted">${escapeHtml(formatDatum(k.erstelltAm, true))}</span>
            </div>
            <div class="komm-text">${escapeHtml(k.text)}</div>
          </div>`;
      }).join("");
    },
    (e) => console.error(e)
  );
  beiViewWechsel(unsub);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.hidden = true;
    const txt = text.value.trim();
    if (!txt) { err.textContent = "Bitte einen Text eingeben."; err.hidden = false; return; }
    submit.disabled = true;
    submit.textContent = "Wird gesendet …";
    try {
      await kommentarHinzufuegen(id, { text: txt, autor: user.email, rolle: "admin", art: "kommentar" });
      text.value = "";
    } catch (e2) {
      console.error(e2);
      err.textContent = "Kommentar konnte nicht gesendet werden.";
      err.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = "Kommentar senden";
    }
  });
}
