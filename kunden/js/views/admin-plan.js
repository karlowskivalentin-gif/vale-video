// Admin-View: Plan anlegen / bearbeiten / präsentieren (Admin-only).
// Route #/admin/plan/neu = Anlegen, #/admin/plan/{id} = Bearbeiten.
// Inspirations-Links bekommen eine Inline-Vorschau (YouTube/TikTok/Instagram).
// „Veröffentlichen" markiert den Plan als fertige Referenz (kein Kunden-Zugriff).
import {
  ladePlan, planAnlegen, aktualisierePlan, loeschePlan, ladeObjekte,
  ladeShotvorlagen, shotvorlageAnlegen, aktualisiereShotvorlage, loescheShotvorlage,
  ladeDateiblob, videoAnlegen, ladeVideo
} from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { escapeHtml, tsZuDateInput, dateInputZuDate } from "../util.js";
import { embedHtml, erkennePlattform, verarbeiteEmbeds } from "../embeds.js";
import { STATUS } from "../status.js";

// Reihenfolge der Panels — global (alle Pläne), pro Browser in localStorage.
// „anhaenge" erscheint nur, wenn der Plan Anhänge aus einem Post trägt.
const PANEL_KEYS    = ["eckdaten", "anhaenge", "inspiration", "sound", "shotlist", "notizen"];
const LS_PANELORDER = "vale_plan_panelorder";

// Post-Produktionsphase (aus dem Post übernommen) → Badge im Plan.
const POST_STATUS_LABEL = { skript: "📝 Skript", shotlist: "🎬 Shotlist", geschnitten: "✂️ Geschnitten" };

function ladePanelOrder() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_PANELORDER) || "null");
    if (Array.isArray(raw)) {
      const gefiltert = raw.filter((k) => PANEL_KEYS.includes(k));
      PANEL_KEYS.forEach((k) => { if (!gefiltert.includes(k)) gefiltert.push(k); });
      return gefiltert;
    }
  } catch (_) { /* egal */ }
  return PANEL_KEYS.slice();
}
function speicherePanelOrder(order) {
  try { localStorage.setItem(LS_PANELORDER, JSON.stringify(order)); } catch (_) { /* egal */ }
}

export function renderAdminPlan(container, ctx) {
  const id = ctx.id;
  const istNeu = !id || id === "neu";

  container.innerHTML = `
    <a class="back-link" href="#/admin/plaene">← Zurück zu den Plänen</a>
    <h1 class="view-title">${istNeu ? "Neuer Plan" : "Plan bearbeiten"}</h1>
    <div id="planBody"><div class="card card--pad"><p class="muted">Wird geladen …</p></div></div>`;

  const body = container.querySelector("#planBody");

  (async function init() {
    let objekte = [];
    try { objekte = await ladeObjekte(); } catch (e) { console.error(e); }

    let vorlagen = [];
    try { vorlagen = await ladeShotvorlagen(); } catch (e) { console.error("Shot-Vorlagen laden fehlgeschlagen:", e); vorlagen = []; }

    let plan = null;
    if (!istNeu) {
      try { plan = await ladePlan(id); } catch (e) { console.error(e); }
      if (!plan) {
        body.innerHTML = `<div class="card card--pad"><p class="notice notice--error" style="margin:0">
          Plan nicht gefunden. <a href="#/admin/plaene">Zurück zu den Plänen</a>.</p></div>`;
        return;
      }
    }

    // Arbeits-Zustand im Speicher (DOM-Textfelder werden vor jedem Re-Render
    // hineingesynct, damit Struktur-Änderungen keine Eingaben verlieren).
    const state = {
      titel:    plan ? (plan.titel || "") : "",
      typ:      plan ? (plan.typ || "") : "",
      objektId: plan ? (plan.objektId || "") : "",
      status:   plan ? (plan.status || "entwurf") : "entwurf",
      inspirationen: plan && Array.isArray(plan.inspirationen) ? plan.inspirationen.slice() : [],
      sound:    plan && plan.sound ? { name: plan.sound.name || "", link: plan.sound.link || "" } : { name: "", link: "" },
      shotlist: plan && Array.isArray(plan.shotlist) ? plan.shotlist.map((s) => ({ text: s.text || "", erledigt: !!s.erledigt, notiz: s.notiz || "" })) : [],
      notiz:    plan ? (plan.notiz || "") : "",
      dateien:  plan && Array.isArray(plan.dateien) ? plan.dateien : [],   // Anhänge aus dem Post (read-only Anzeige)
      poststatus: plan ? (plan.poststatus || "") : "",
      videoId:  plan ? (plan.videoId || null) : null,   // Verknüpfung zum Pipeline-Video (nach Deploy)
      drehInput: plan ? tsZuDateInput(plan.geplanterDrehtermin) : "",
      pubInput:  plan ? tsZuDateInput(plan.geplantesDatum) : ""
    };

    // Selbstheilung: Wurde das verknüpfte Video in der Pipeline gelöscht,
    // die tote videoId entfernen — der Button wird wieder „🚀 In Video-Pipeline"
    // (statt „öffnen" → „Video nicht gefunden").
    if (!istNeu && state.videoId) {
      try {
        const v = await ladeVideo(state.videoId);
        if (!v) {
          state.videoId = null;
          aktualisierePlan(id, { videoId: null }).catch(() => {});
        }
      } catch (_) { /* egal — im Zweifel Button so lassen */ }
    }

    // Transiente UI-Zustände (nicht persistiert).
    let editShotIndex    = null;        // Index der aktuell bearbeiteten Shotlist-Zeile
    let editVorlageIndex = null;        // Index der aktuell bearbeiteten Bibliotheks-Vorlage
    const notizOffen     = new Set();   // Indizes der Shots mit ausgeklappter Notiz
    const panelOrder     = ladePanelOrder();

    const aktuelleId = istNeu ? null : id;
    zeichne();

    // --- Render + Wiring -------------------------------------------------
    function zeichne() {
      body.innerHTML = formHtml(state, objekte, istNeu, {
        vorlagen, editShotIndex, editVorlageIndex, notizOffen, panelOrder
      });
      wire();
      verarbeiteEmbeds(body.querySelector("#plInspListe"));
      renderAnhaenge();
    }

    // Anhänge aus dem Post (read-only): Bilder/Videos/Audio aus Blobs, Links als
    // Embed (YouTube/Insta/TikTok) bzw. Bild/Video-URL, sonstige zum Download.
    function renderAnhaenge() {
      const ziel = body.querySelector("#plAnhListe");
      if (!ziel) return;
      ziel.innerHTML = "";
      (state.dateien || []).forEach((att) => {
        const box = document.createElement("div");
        box.className = "plan-anh";
        const name = document.createElement("div");
        name.className = "plan-anh-name";
        name.textContent = (att.art === "link" ? "🔗 " : "📄 ") + (att.name || att.url || "Datei");
        const media = document.createElement("div");
        media.className = "plan-anh-media";
        box.append(name, media);
        ziel.appendChild(box);
        fuelleAnhang(media, att);
      });
    }
    function fuelleAnhang(el, att) {
      if (att.art === "link") {
        const u = String(att.url || "").toLowerCase();
        if (/\.(png|jpe?g|gif|webp|svg)(\?.*)?$/.test(u)) { el.innerHTML = `<img class="plan-anh-img" src="${escapeHtml(att.url)}" alt="">`; return; }
        if (/\.(mp4|webm|mov|m4v)(\?.*)?$/.test(u)) { el.innerHTML = `<video class="plan-anh-vid" controls src="${escapeHtml(att.url)}"></video>`; return; }
        el.innerHTML = embedHtml(att.url); verarbeiteEmbeds(el); return;
      }
      if (!att.blobId) { el.innerHTML = `<span class="plan-anh-fehler">Datei fehlt</span>`; return; }
      el.innerHTML = `<span class="muted" style="font-size:.8rem">lädt …</span>`;
      ladeDateiblob(att.blobId).then((b) => {
        if (!b) { el.innerHTML = `<span class="plan-anh-fehler">Datei nicht gefunden</span>`; return; }
        const url = `data:${b.typ};base64,${b.base64}`;
        const typ = b.typ || att.typ || "";
        if (typ.startsWith("image/"))      el.innerHTML = `<img class="plan-anh-img" src="${url}" alt="${escapeHtml(att.name || "")}">`;
        else if (typ.startsWith("video/")) el.innerHTML = `<video class="plan-anh-vid" controls src="${url}"></video>`;
        else if (typ.startsWith("audio/")) el.innerHTML = `<audio style="width:100%" controls src="${url}"></audio>`;
        else el.innerHTML = `<a class="btn btn--ghost btn--sm" href="${url}" download="${escapeHtml(att.name || "datei")}">Herunterladen ↓</a>`;
      }).catch(() => { el.innerHTML = `<span class="plan-anh-fehler">Fehler beim Laden</span>`; });
    }

    function syncText() {
      const g = (sel) => { const el = body.querySelector(sel); return el ? el.value : ""; };
      const has = (sel) => !!body.querySelector(sel);
      if (has("#f-titel"))      state.titel = g("#f-titel").trim();
      if (has("#f-typ"))        state.typ = g("#f-typ").trim();
      if (has("#f-objekt"))     state.objektId = g("#f-objekt");
      if (has("#f-sound-name")) state.sound.name = g("#f-sound-name").trim();
      if (has("#f-sound-link")) state.sound.link = g("#f-sound-link").trim();
      if (has("#f-notiz"))      state.notiz = g("#f-notiz");
      if (has("#f-drehdatum"))  state.drehInput = g("#f-drehdatum");
      if (has("#f-pubdatum"))   state.pubInput = g("#f-pubdatum");
      // Offene Shot-Notizen sichern, damit sie ein Re-Render überleben.
      body.querySelectorAll(".plan-shot-notiz").forEach((ta) => {
        const i = Number(ta.getAttribute("data-i"));
        if (state.shotlist[i]) state.shotlist[i].notiz = ta.value;
      });
      // Laufende Shot-Bearbeitung sichern.
      if (editShotIndex !== null) {
        const ei = body.querySelector(`.plan-shot-editinput[data-i="${editShotIndex}"]`);
        if (ei && state.shotlist[editShotIndex]) state.shotlist[editShotIndex].text = ei.value.trim();
      }
    }

    function datenAusState() {
      return {
        titel: state.titel,
        typ: state.typ,
        objektId: state.objektId || null,
        status: state.status,
        poststatus: state.poststatus,
        inspirationen: state.inspirationen,
        sound: state.sound,
        shotlist: state.shotlist,
        notiz: state.notiz,
        dateien: state.dateien,   // unverändert durchreichen (Anhänge nicht verlieren)
        videoId: state.videoId || null,
        geplanterDrehtermin: dateInputZuDate(state.drehInput),
        geplantesDatum: dateInputZuDate(state.pubInput)
      };
    }

    function wire() {
      const okBox  = body.querySelector("#planOk");
      const errBox = body.querySelector("#planErr");

      // Panels umsortieren (↑↓, global, localStorage)
      body.querySelectorAll(".panel-move").forEach((btn) => {
        btn.addEventListener("click", () => {
          const key = btn.getAttribute("data-key");
          const dir = btn.getAttribute("data-dir");
          const i = panelOrder.indexOf(key);
          const j = dir === "up" ? i - 1 : i + 1;
          if (i < 0 || j < 0 || j >= panelOrder.length) return;
          syncText();
          const tmp = panelOrder[i]; panelOrder[i] = panelOrder[j]; panelOrder[j] = tmp;
          speicherePanelOrder(panelOrder);
          zeichne();
        });
      });

      // Inspiration hinzufügen
      const inspForm = body.querySelector("#plInspForm");
      if (inspForm) inspForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const inp = body.querySelector("#f-insp-url");
        const url = inp.value.trim();
        if (!url) return;
        syncText();
        state.inspirationen.push({ url, plattform: erkennePlattform(url) });
        zeichne();
      });

      // Inspiration entfernen
      body.querySelectorAll(".plan-insp-del").forEach((btn) => {
        btn.addEventListener("click", () => {
          const i = Number(btn.getAttribute("data-i"));
          syncText();
          state.inspirationen.splice(i, 1);
          zeichne();
        });
      });

      // Shotlist hinzufügen
      const shotForm = body.querySelector("#plShotForm");
      if (shotForm) shotForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const inp = body.querySelector("#f-shot-text");
        const text = inp.value.trim();
        if (!text) return;
        syncText();
        state.shotlist.push({ text, erledigt: false, notiz: "" });
        editShotIndex = null; notizOffen.clear();
        zeichne();
        persistShotlistStill();
      });

      // Shotlist: Checkbox abhaken (persistiert sofort, wenn schon gespeichert)
      body.querySelectorAll(".plan-shot-check").forEach((cb) => {
        cb.addEventListener("change", () => {
          const i = Number(cb.getAttribute("data-i"));
          state.shotlist[i].erledigt = cb.checked;
          const row = cb.closest(".plan-shot");
          if (row) row.classList.toggle("is-done", cb.checked);
          persistShotlistStill();
        });
      });

      // Shotlist-Zeile bearbeiten (Stift)
      body.querySelectorAll(".plan-shot-edit").forEach((btn) => {
        btn.addEventListener("click", () => {
          syncText();
          editShotIndex = Number(btn.getAttribute("data-i"));
          zeichne();
          const ei = body.querySelector(`.plan-shot-editinput[data-i="${editShotIndex}"]`);
          if (ei) { ei.focus(); ei.select(); }
        });
      });
      body.querySelectorAll(".plan-shot-editsave").forEach((btn) => {
        btn.addEventListener("click", () => {
          const i = Number(btn.getAttribute("data-i"));
          const inp = body.querySelector(`.plan-shot-editinput[data-i="${i}"]`);
          const neu = inp ? inp.value.trim() : "";
          if (neu && state.shotlist[i]) state.shotlist[i].text = neu;
          editShotIndex = null;
          zeichne();
          persistShotlistStill();
        });
      });
      body.querySelectorAll(".plan-shot-editcancel").forEach((btn) => {
        btn.addEventListener("click", () => { editShotIndex = null; zeichne(); });
      });

      // Shotlist: Notiz aus-/einklappen
      body.querySelectorAll(".plan-shot-notiz-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          syncText();
          const i = Number(btn.getAttribute("data-i"));
          if (notizOffen.has(i)) notizOffen.delete(i); else notizOffen.add(i);
          zeichne();
          if (notizOffen.has(i)) {
            const ta = body.querySelector(`.plan-shot-notiz[data-i="${i}"]`);
            if (ta) ta.focus();
          }
        });
      });
      // Notiz-Textfeld: live in den State, beim Verlassen persistieren (kein Re-Render beim Tippen).
      body.querySelectorAll(".plan-shot-notiz").forEach((ta) => {
        ta.addEventListener("input", () => {
          const i = Number(ta.getAttribute("data-i"));
          if (state.shotlist[i]) state.shotlist[i].notiz = ta.value;
        });
        ta.addEventListener("blur", () => {
          const i = Number(ta.getAttribute("data-i"));
          if (state.shotlist[i]) state.shotlist[i].notiz = ta.value;
          persistShotlistStill();
          zeichne();   // Has-Notiz-Marker (#10) aktualisieren; Notiz bleibt offen (notizOffen)
        });
      });

      // Shotlist entfernen
      body.querySelectorAll(".plan-shot-del").forEach((btn) => {
        btn.addEventListener("click", () => {
          const i = Number(btn.getAttribute("data-i"));
          if (!confirm("Diesen Shot entfernen?")) return;
          syncText();
          state.shotlist.splice(i, 1);
          editShotIndex = null; notizOffen.clear();
          zeichne();
          persistShotlistStill();
        });
      });

      // --- Shot-Bibliothek -----------------------------------------------
      // „+ in Shotlist": Text als unabhängige neue Zeile kopieren.
      body.querySelectorAll(".shotbib-add").forEach((btn) => {
        btn.addEventListener("click", () => {
          const i = Number(btn.getAttribute("data-i"));
          const v = vorlagen[i];
          if (!v) return;
          syncText();
          state.shotlist.push({ text: v.text || "", erledigt: false, notiz: "" });
          zeichne();
          persistShotlistStill();
        });
      });

      // Neue Vorlage anlegen
      const vorlageForm = body.querySelector("#plVorlageForm");
      if (vorlageForm) vorlageForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const inp = body.querySelector("#f-vorlage-text");
        const text = inp ? inp.value.trim() : "";
        if (!text) return;
        syncText();
        inp.disabled = true;
        try {
          const ref = await shotvorlageAnlegen({ text });
          vorlagen.push({ id: ref.id, text });
          zeichne();
        } catch (err) {
          console.error("Vorlage anlegen fehlgeschlagen:", err);
          inp.disabled = false;
          alert("Vorlage konnte nicht angelegt werden.");
        }
      });

      // Vorlage bearbeiten
      body.querySelectorAll(".shotbib-edit").forEach((btn) => {
        btn.addEventListener("click", () => {
          syncText();
          editVorlageIndex = Number(btn.getAttribute("data-i"));
          zeichne();
          const ei = body.querySelector(`.shotbib-editinput[data-i="${editVorlageIndex}"]`);
          if (ei) { ei.focus(); ei.select(); }
        });
      });
      body.querySelectorAll(".shotbib-editsave").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const i = Number(btn.getAttribute("data-i"));
          const inp = body.querySelector(`.shotbib-editinput[data-i="${i}"]`);
          const neu = inp ? inp.value.trim() : "";
          const v = vorlagen[i];
          editVorlageIndex = null;
          if (v && neu && neu !== v.text) {
            const alt = v.text;
            v.text = neu;
            zeichne();
            try { await aktualisiereShotvorlage(v.id, { text: neu }); }
            catch (err) { console.error(err); v.text = alt; zeichne(); alert("Vorlage konnte nicht gespeichert werden."); }
          } else {
            zeichne();
          }
        });
      });
      body.querySelectorAll(".shotbib-editcancel").forEach((btn) => {
        btn.addEventListener("click", () => { editVorlageIndex = null; zeichne(); });
      });

      // Vorlage löschen
      body.querySelectorAll(".shotbib-del").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const i = Number(btn.getAttribute("data-i"));
          const v = vorlagen[i];
          if (!v) return;
          if (!confirm("Diese Vorlage löschen?")) return;
          syncText();
          try {
            await loescheShotvorlage(v.id);
            vorlagen.splice(i, 1);
            if (editVorlageIndex === i) editVorlageIndex = null;
            zeichne();
          } catch (err) {
            console.error(err);
            alert("Vorlage konnte nicht gelöscht werden.");
          }
        });
      });

      // Speichern / Anlegen
      const form = body.querySelector("#planForm");
      const save = body.querySelector("#planSave");
      if (form) form.addEventListener("submit", async (e) => {
        e.preventDefault();
        okBox.hidden = true; errBox.hidden = true;
        syncText();
        if (!state.titel) { errBox.textContent = "Bitte einen Titel eingeben."; errBox.hidden = false; return; }
        save.disabled = true;
        const orig = save.textContent;
        save.textContent = istNeu ? "Wird angelegt …" : "Wird gespeichert …";
        try {
          if (istNeu) {
            const ref = await planAnlegen(datenAusState());
            location.hash = "/admin/plan/" + ref.id;   // → lädt im Bearbeiten-Modus neu
          } else {
            await aktualisierePlan(aktuelleId, datenAusState());
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

      // 🚀 In die Video-Pipeline übernehmen: legt aus dem Plan ein Video an
      // (voller Umfang: Titel, Typ, Objekt, Dreh-/Veröffentlichungstermin;
      // Plan-Notiz + Shotlist bleiben hier als Referenz). Danach direkt ins
      // Video-Edit springen — dort lassen sich alle Pipeline-Statusse setzen.
      const pipe = body.querySelector("#planPipeline");
      if (pipe) {
        pipe.addEventListener("click", async () => {
          if (state.videoId) { location.hash = "/admin/video/" + state.videoId; return; }
          syncText();
          if (!state.titel) { errBox.textContent = "Bitte zuerst einen Titel eingeben."; errBox.hidden = false; return; }
          pipe.disabled = true; pipe.textContent = "Wird angelegt …";
          try {
            // Plan-Stand sichern, damit nichts verloren geht.
            await aktualisierePlan(aktuelleId, datenAusState());
            const ref = await videoAnlegen({
              titel: state.titel,
              typ: state.typ,
              objektId: state.objektId || null,
              planId: aktuelleId,   // Video-Edit zeigt ALLE Plan-Details (Links, Dateien, Shotlist, Notiz)
              status: STATUS.IDEE,
              geplanterDrehtermin: dateInputZuDate(state.drehInput),
              geplantesDatum: dateInputZuDate(state.pubInput)
            });
            state.videoId = ref.id;
            await aktualisierePlan(aktuelleId, { videoId: ref.id });
            location.hash = "/admin/video/" + ref.id;   // → Status direkt setzbar
          } catch (err) {
            console.error("Pipeline-Übernahme fehlgeschlagen:", err);
            pipe.disabled = false; pipe.textContent = "🚀 In Video-Pipeline";
            errBox.textContent = "Konnte das Video nicht anlegen.";
            errBox.hidden = false;
          }
        });
      }

      // Veröffentlichen / Auf Entwurf zurücksetzen
      const pub = body.querySelector("#planPublish");
      if (pub) {
        pub.addEventListener("click", async () => {
          syncText();
          const neu = state.status === "veroeffentlicht" ? "entwurf" : "veroeffentlicht";
          pub.disabled = true;
          try {
            await aktualisierePlan(aktuelleId, { ...datenAusState(), status: neu });
            state.status = neu;
            zeichne();
          } catch (err) {
            console.error(err);
            pub.disabled = false;
            alert("Status konnte nicht geändert werden.");
          }
        });
      }

      // Löschen
      const del = body.querySelector("#planDelete");
      if (del) {
        del.addEventListener("click", async () => {
          if (!confirm("Diesen Plan wirklich löschen? Das kann nicht rückgängig gemacht werden.")) return;
          del.disabled = true;
          try {
            await loeschePlan(aktuelleId);
            location.hash = "/admin/plaene";
          } catch (err) {
            console.error(err);
            del.disabled = false;
            alert("Löschen fehlgeschlagen.");
          }
        });
      }
    }

    // Shotlist nach Abhaken/Ändern still speichern (nur bei bereits angelegtem Plan).
    async function persistShotlistStill() {
      if (istNeu || !aktuelleId) return;
      try { await aktualisierePlan(aktuelleId, { shotlist: state.shotlist }); }
      catch (err) { console.error("Shotlist speichern fehlgeschlagen:", err); }
    }

    beiViewWechsel(() => {});
  })();
}

// --- Panel-Kopf mit ↑↓-Buttons ---------------------------------------
function panelKopf(key, titel, panelOrder, rechts = "") {
  const idx = panelOrder.indexOf(key);
  const istErster = idx <= 0;
  const istLetzter = idx >= panelOrder.length - 1;
  return `
    <div class="plan-head-row">
      <div class="plan-head-left">
        <h2 class="section-title" style="margin:0">${titel}</h2>
        <span class="panel-move-wrap">
          <button class="panel-move" type="button" data-key="${key}" data-dir="up"   title="Panel nach oben"${istErster ? " disabled" : ""}>↑</button>
          <button class="panel-move" type="button" data-key="${key}" data-dir="down" title="Panel nach unten"${istLetzter ? " disabled" : ""}>↓</button>
        </span>
      </div>
      ${rechts}
    </div>`;
}

// --- Shotlist-Zeile ----------------------------------------------------
function shotRowHtml(s, i, editShotIndex, notizOffen) {
  const istEdit = editShotIndex === i;
  const notizAuf = notizOffen.has(i);
  const hatNotiz = !!(s.notiz && s.notiz.trim());
  const main = istEdit
    ? `<div class="plan-shot-editrow">
         <input class="plan-shot-editinput" type="text" data-i="${i}" value="${escapeHtml(s.text)}" />
         <button class="btn btn--accent btn--sm plan-shot-editsave"   type="button" data-i="${i}">Speichern</button>
         <button class="btn btn--ghost  btn--sm plan-shot-editcancel" type="button" data-i="${i}">Abbrechen</button>
       </div>`
    : `<label class="plan-shot-label">
         <input class="plan-shot-check" type="checkbox" data-i="${i}"${s.erledigt ? " checked" : ""} />
         <span class="plan-shot-text">${escapeHtml(s.text)}</span>
       </label>
       <div class="plan-shot-actions">
         <button class="btn btn--ghost btn--sm plan-shot-notiz-btn${notizAuf ? " is-active" : ""}${hatNotiz ? " has-notiz" : ""}" type="button" data-i="${i}" title="${hatNotiz ? "Notiz vorhanden" : "Notiz"}">📝</button>
         <button class="btn btn--ghost btn--sm plan-shot-edit" type="button" data-i="${i}" title="Bearbeiten">✏️</button>
         <button class="btn btn--ghost btn--sm plan-shot-del"  type="button" data-i="${i}" title="Entfernen">✕</button>
       </div>`;
  const notizFeld = notizAuf
    ? `<textarea class="plan-shot-notiz" data-i="${i}" placeholder="Notiz zu diesem Shot …">${escapeHtml(s.notiz || "")}</textarea>`
    : "";
  return `
    <div class="plan-shot${s.erledigt ? " is-done" : ""}${istEdit ? " is-editing" : ""}">
      <div class="plan-shot-main">${main}</div>
      ${notizFeld}
    </div>`;
}

// --- Formular-HTML -----------------------------------------------------
function formHtml(state, objekte, istNeu, opts) {
  const { vorlagen, editShotIndex, editVorlageIndex, notizOffen, panelOrder } = opts;

  const objektOpts = ['<option value="">— kein Objekt —</option>']
    .concat(objekte.map((o) =>
      `<option value="${escapeHtml(o.id)}"${o.id === state.objektId ? " selected" : ""}>${escapeHtml(o.adresse || o.id)}</option>`))
    .join("");

  const postBadge = state.poststatus && POST_STATUS_LABEL[state.poststatus]
    ? `<span class="plan-badge plan-badge--post">${POST_STATUS_LABEL[state.poststatus]}</span>` : "";
  const statusBadge = postBadge + (state.status === "veroeffentlicht"
    ? `<span class="plan-badge plan-badge--veroeffentlicht">Veröffentlicht</span>`
    : `<span class="plan-badge plan-badge--entwurf">Entwurf</span>`);

  const inspListe = state.inspirationen.length
    ? state.inspirationen.map((insp, i) => `
        <div class="plan-insp">
          <div class="plan-insp-head">
            <span class="plan-insp-plattform">${escapeHtml(plattformLabel(insp.plattform))}</span>
            <button class="btn btn--ghost btn--sm plan-insp-del" type="button" data-i="${i}">Entfernen</button>
          </div>
          ${embedHtml(insp.url)}
          <a class="plan-insp-link" href="${escapeHtml(insp.url)}" target="_blank" rel="noopener">${escapeHtml(insp.url)} ↗</a>
        </div>`).join("")
    : `<p class="muted" style="margin:0">Noch keine Inspirationen. Füge oben einen Link ein.</p>`;

  const shotListe = state.shotlist.length
    ? state.shotlist.map((s, i) => shotRowHtml(s, i, editShotIndex, notizOffen)).join("")
    : `<p class="muted" style="margin:0">Noch keine Shots. Füge einen hinzu oder übernimm eine Vorlage.</p>`;

  const vorlagenListe = vorlagen.length
    ? vorlagen.map((v, i) => {
        if (editVorlageIndex === i) {
          return `<div class="shotbib-row is-editing">
            <input class="shotbib-editinput" type="text" data-i="${i}" value="${escapeHtml(v.text)}" />
            <div class="shotbib-actions">
              <button class="btn btn--accent btn--sm shotbib-editsave"   type="button" data-i="${i}" title="Speichern">✓</button>
              <button class="btn btn--ghost  btn--sm shotbib-editcancel" type="button" data-i="${i}" title="Abbrechen">✕</button>
            </div>
          </div>`;
        }
        return `<div class="shotbib-row">
          <button class="btn btn--ghost btn--sm shotbib-add" type="button" data-i="${i}" title="In Shotlist übernehmen">+</button>
          <span class="shotbib-text">${escapeHtml(v.text)}</span>
          <div class="shotbib-actions">
            <button class="btn btn--ghost btn--sm shotbib-edit" type="button" data-i="${i}" title="Bearbeiten">✏️</button>
            <button class="btn btn--ghost btn--sm shotbib-del"  type="button" data-i="${i}" title="Löschen">🗑</button>
          </div>
        </div>`;
      }).join("")
    : `<p class="muted" style="margin:0">Noch keine Vorlagen. Lege unten eine an.</p>`;

  // --- Panels (einzeln, nach Reihenfolge zusammengesetzt) --------------
  const panels = {
    eckdaten: `
    <section class="card card--pad form-card">
      ${panelKopf("eckdaten", "Eckdaten", panelOrder, statusBadge)}
      <form id="planForm" novalidate>
        <div class="field">
          <label for="f-titel">Titel <span class="req">*</span></label>
          <input id="f-titel" type="text" value="${escapeHtml(state.titel)}" placeholder="z. B. Reel — Objekt-Tour Musterstraße" required />
        </div>
        <div class="grid-2">
          <div class="field">
            <label for="f-typ">Typ</label>
            <input id="f-typ" type="text" value="${escapeHtml(state.typ)}" placeholder="z. B. Reel, Objekt-Tour, Hook-Test" />
          </div>
          <div class="field">
            <label for="f-objekt">Verknüpftes Objekt</label>
            <select id="f-objekt">${objektOpts}</select>
          </div>
        </div>
        <div class="grid-2">
          <div class="field">
            <label for="f-drehdatum">Geplanter Drehtermin</label>
            <input id="f-drehdatum" type="date" value="${escapeHtml(state.drehInput)}" />
          </div>
          <div class="field">
            <label for="f-pubdatum">Geplante Veröffentlichung</label>
            <input id="f-pubdatum" type="date" value="${escapeHtml(state.pubInput)}" />
          </div>
        </div>

        <div class="action-btns" style="margin-top:1.25rem">
          <button class="btn btn--accent" id="planSave" type="submit">${istNeu ? "Anlegen" : "Speichern"}</button>
          ${!istNeu ? (state.videoId
            ? `<button class="btn btn--ghost plan-pipeline-btn is-deployt" id="planPipeline" type="button" title="Dieser Plan liegt als Video in der Produktions-Pipeline">✓ In Video-Pipeline — öffnen</button>`
            : `<button class="btn btn--ghost plan-pipeline-btn" id="planPipeline" type="button" title="Legt aus diesem Plan ein Video in der Produktions-Pipeline an — dort kannst du alle Statusse (💡 Idee … 🚀 Gepostet) setzen">🚀 In Video-Pipeline</button>`) : ""}
          ${!istNeu ? `<button class="btn btn--ghost" id="planPublish" type="button">${state.status === "veroeffentlicht" ? "Auf Entwurf zurücksetzen" : "Als Plan veröffentlichen"}</button>` : ""}
          ${!istNeu ? `<button class="btn btn--ghost" id="planDelete" type="button">Löschen</button>` : ""}
        </div>
      </form>
    </section>`,

    anhaenge: state.dateien.length ? `
    <section class="card card--pad form-card">
      ${panelKopf("anhaenge", "Anhänge aus dem Post", panelOrder)}
      <p class="field-hint muted" style="margin-top:-0.4rem">Alle Bilder, Videos, Links und Dateien, die am Post hingen — automatisch übernommen.</p>
      <div id="plAnhListe" class="plan-anh-liste"></div>
    </section>` : "",

    inspiration: `
    <section class="card card--pad form-card">
      ${panelKopf("inspiration", "Inspirationen", panelOrder)}
      <p class="field-hint muted" style="margin-top:-0.4rem">Links von YouTube/Shorts, TikTok oder Instagram — mit Inline-Vorschau.</p>
      <form id="plInspForm" class="field-inline-form">
        <input id="f-insp-url" type="url" placeholder="https://www.tiktok.com/@…  ·  https://youtube.com/shorts/…  ·  https://instagram.com/reel/…" />
        <button class="btn btn--accent btn--sm" type="submit">+ Hinzufügen</button>
      </form>
      <div id="plInspListe" class="plan-insp-liste">${inspListe}</div>
    </section>`,

    sound: `
    <section class="card card--pad form-card">
      ${panelKopf("sound", "Offizieller Sound", panelOrder)}
      <div class="grid-2">
        <div class="field">
          <label for="f-sound-name">Name</label>
          <input id="f-sound-name" type="text" value="${escapeHtml(state.sound.name)}" placeholder="z. B. „Originalton — name_des_creators“" />
        </div>
        <div class="field">
          <label for="f-sound-link">Link</label>
          <input id="f-sound-link" type="url" value="${escapeHtml(state.sound.link)}" placeholder="Link zum Sound (TikTok/Instagram/…)" />
        </div>
      </div>
      ${state.sound.link ? `<a class="plan-insp-link" href="${escapeHtml(state.sound.link)}" target="_blank" rel="noopener">Sound öffnen ↗</a>` : ""}
    </section>`,

    shotlist: `
    <section class="card card--pad form-card">
      ${panelKopf("shotlist", "Shotlist", panelOrder)}
      <div class="grid-2 shotlist-grid">
        <div class="shotlist-col">
          <form id="plShotForm" class="field-inline-form">
            <input id="f-shot-text" type="text" placeholder="z. B. Drohne Anflug Fassade, 5 Sek" />
            <button class="btn btn--accent btn--sm" type="submit">+ Shot</button>
          </form>
          <div class="plan-shot-liste">${shotListe}</div>
        </div>
        <div class="shotbib-col">
          <h3 class="shotbib-title">Vorlagen-Bibliothek</h3>
          <p class="field-hint muted" style="margin-top:-0.2rem">Wiederverwendbare Shots. „+" kopiert die Zeile in die Shotlist.</p>
          <div class="shotbib-liste">${vorlagenListe}</div>
          <form id="plVorlageForm" class="field-inline-form">
            <input id="f-vorlage-text" type="text" placeholder="Neue Vorlage …" />
            <button class="btn btn--accent btn--sm" type="submit">+ Vorlage</button>
          </form>
        </div>
      </div>
    </section>`,

    notizen: `
    <section class="card card--pad form-card">
      ${panelKopf("notizen", "Notizen", panelOrder)}
      <div class="field" style="margin:0">
        <textarea id="f-notiz" placeholder="Freie Notizen zum Konzept, Ablauf, Caption-Ideen …">${escapeHtml(state.notiz)}</textarea>
      </div>
    </section>`
  };

  return `
    <div class="notice notice--ok"    id="planOk"  hidden role="status"></div>
    <div class="notice notice--error" id="planErr" hidden role="alert"></div>
    ${panelOrder.map((k) => panels[k] || "").join("")}`;
}

function plattformLabel(p) {
  return { youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram", andere: "Link" }[p] || "Link";
}
