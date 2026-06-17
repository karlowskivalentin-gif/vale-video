// Admin-View: Video anlegen / bearbeiten.
// Route #/admin/video/neu = Anlegen, #/admin/video/{id} = Bearbeiten.
import {
  ladeVideo, videoAnlegen, aktualisiereVideo, loescheVideo, ladeObjekte,
  beobachteKommentare, kommentarHinzufuegen
} from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import {
  STATUS, STATUS_REIHENFOLGE, VIDEO_TYPEN, skriptFreigabeNoetig
} from "../status.js";
import { escapeHtml, formatDatum, tsZuDateInput, dateInputZuDate } from "../util.js";

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

        <div class="field">
          <label for="f-datum">Geplantes Veröffentlichungsdatum</label>
          <input id="f-datum" type="date" value="${escapeHtml(tsZuDateInput(val("geplantesDatum", null)))}" />
        </div>

        ${freigabeInfo}

        <div class="action-btns" style="margin-top:1.25rem">
          <button class="btn btn--accent" id="aveSave" type="submit">${istNeu ? "Anlegen" : "Speichern"}</button>
          ${!istNeu ? `<button class="btn btn--ghost" id="aveDelete" type="button">Löschen</button>` : ""}
        </div>
      </form>
    </section>
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
      geplantesDatum: dateInputZuDate(body.querySelector("#f-datum").value)
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
