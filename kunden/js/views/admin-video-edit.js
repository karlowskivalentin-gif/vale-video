// Admin-View: Video anlegen / bearbeiten.
// Route #/admin/video/neu = Anlegen, #/admin/video/{id} = Bearbeiten.
import {
  ladeVideo, videoAnlegen, aktualisiereVideo, loescheVideo, ladeObjekte,
  beobachteKommentare, kommentarHinzufuegen, kommentarSetzeBearbeitung, ladePlan,
  aktualisierePlan, benachrichtigeKunde,
  beobachteSkriptUploads, setzeSkriptUploadErledigt, loescheSkriptUpload, skriptUploadAnlegen
} from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import {
  STATUS, STATUS_REIHENFOLGE, videoTypenFuer, skriptFreigabeNoetig, objektProduktionsMonat,
  istFreigabeStufe
} from "../status.js";
import { getAktivKunde } from "../kunde-context.js";
import { escapeHtml, formatDatum, tsZuDateInput, dateInputZuDate, monatsLabel } from "../util.js";
import { renderPlanDetails, planZuSnapshot } from "../plan-ansicht.js";
import { sendKundeFreigabe } from "../email.js";
import { videoNeuerEntwurf } from "../versionen.js";
import { embedHtml, erkennePlattform, verarbeiteEmbeds } from "../embeds.js";
import { dateiZuBase64, extrahiereText, zeigeDateiInline } from "../docparse.js";
import { rolleVon } from "../roles.js";
import { parseBeats, beatsZuChecklist } from "../beats.js";

const BEARB_LABEL = {
  neu: "Neu", gelesen: "Gelesen", in_umsetzung: "In Umsetzung", umgesetzt: "Umgesetzt"
};

export function renderAdminVideoEdit(container, ctx) {
  const user = ctx.user;
  const id = ctx.id;
  const kundeId = ctx.kundeId || null;   // aktiver Kunde (Mandant) für neue Videos
  const kundenart = ctx.kundenart || "immobilien";   // steuert Typ-Liste & Wording
  const istNeu = !id || id === "neu";

  container.innerHTML = `
    <a class="back-link" href="#/admin/pipeline">← Zurück zur Pipeline</a>
    <div id="aveKopf"></div>
    <div id="aveBody"><div class="card card--pad"><p class="muted">Wird geladen …</p></div></div>`;

  const body = container.querySelector("#aveBody");
  const kopf = container.querySelector("#aveKopf");
  kopf.innerHTML = `<h1 class="view-title">${istNeu ? "Neues Video" : "Video bearbeiten"}</h1>`;

  (async function init() {
    let objekte = [];
    try { objekte = await ladeObjekte(kundeId); } catch (e) { console.error(e); }

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

    if (!istNeu && video) kopf.innerHTML = kopfHtml(video);
    body.innerHTML = formHtml(video, objekte, istNeu, kundenart);
    // Skript-Upload direkt im Formular. Beim NEUEN Video gibt es noch keine
    // videoId — die Datei wird vorgemerkt und von wire() nach dem Anlegen
    // nachgereicht (siehe skriptUpload.ladeHoch).
    const skriptUpload = initSkriptUpload(body, {
      istNeu, user,
      videoId: istNeu ? null : id,
      kundeId: istNeu ? kundeId : ((video && video.kundeId) || kundeId)
    });
    wire(video, istNeu, body, id, user, objekte, kundeId, skriptUpload);
    initEmbedVorschau(body);
    if (!istNeu) initKommentare(id, user, body);
    if (!istNeu && video) initDrehplan(video, body);
    // Stammt das Video aus einem Plan → dessen KOMPLETTE Details anzeigen
    // (Links, Dateien, Sound, Shotlist, Notiz). Live aus /plaene geladen.
    // Zusätzlich wird hier der kundensichtbare planSnapshot aktuell gehalten.
    if (!istNeu && video && video.planId) initPlanDetails(video, body);
  })();
}

// --- Formular ---------------------------------------------------------
function formHtml(v, objekte, istNeu, kundenart) {
  const val = (k, d = "") => (v && v[k] != null ? v[k] : d);
  const typ = val("typ", "");
  const status = val("status", STATUS.IDEE);
  const objektId = val("objektId", "");
  const istGastro = kundenart === "gastro";

  // Typ-Liste der Kundenart — plus den gespeicherten Typ, falls er (Altbestand,
  // Kundenart-Wechsel) außerhalb liegt: sonst wäre die Selektion unsichtbar.
  const typen = videoTypenFuer(kundenart).slice();
  if (typ && !typen.includes(typ)) typen.push(typ);
  const typOpts = ['<option value="">— Typ wählen —</option>']
    .concat(typen.map((t) => `<option value="${escapeHtml(t)}"${t === typ ? " selected" : ""}>${escapeHtml(t)}</option>`))
    .join("");
  const statusOpts = STATUS_REIHENFOLGE
    .map((s) => `<option value="${escapeHtml(s)}"${s === status ? " selected" : ""}>${escapeHtml(s)}</option>`)
    .join("");
  const objektOpts = [`<option value="">${istGastro ? "— keine Filiale —" : "— kein Objekt —"}</option>`]
    .concat(objekte.map((o) =>
      `<option value="${escapeHtml(o.id)}"${o.id === objektId ? " selected" : ""}>${escapeHtml(o.adresse || o.id)}</option>`))
    .join("");

  const cinematicHinweis = typ && !skriptFreigabeNoetig(typ)
    ? `<p class="field-hint muted">Bei „${escapeHtml(typ)}" ist keine separate Skript-Freigabe nötig.</p>` : "";

  const freigabeInfo = (!istNeu && v) ? `
    <div class="freigabe-info">
      <div><span class="muted">Entwurf:</span> <strong>${v.entwurf || 1}</strong></div>
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
          <input id="f-titel" type="text" value="${escapeHtml(val("titel"))}" placeholder="${istGastro ? "z. B. Reel — Neue Winterkarte" : "z. B. Objektvideo Musterstraße 1"}" required />
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

        <div class="ave-gruppe ave-gruppe--kunde">
          <div class="ave-gruppe-kopf">
            <span class="ave-gruppe-titel">👁 Was der Kunde sieht</span>
            <span class="ave-gruppe-sub muted">Erscheint sofort in seiner Videoansicht — leere Felder bleiben bei ihm unsichtbar.</span>
          </div>

        <div class="field">
          <label>Skript</label>
          <div class="skript-drop skript-drop--kompakt" id="skAdminDrop" tabindex="0" role="button"
               aria-label="Skript-Datei hochladen">
            <span class="skript-drop-icon" aria-hidden="true">📄</span>
            <span class="skript-drop-text">Skript hochladen — <span class="skript-drop-link">Datei wählen</span> oder hierher ziehen</span>
            <span class="muted skript-drop-hint">Word / PDF / TXT · max. ~700 KB · liegt danach direkt im Portal</span>
          </div>
          <input type="file" id="skAdminFile" accept=".docx,.pdf,.txt,.md,.rtf,application/pdf,text/plain" hidden />
          <div class="skript-vorgemerkt" id="skAdminPending" hidden></div>
          <div class="notice notice--ok"    id="skAdminOk"  hidden role="status"></div>
          <div class="notice notice--error" id="skAdminErr" hidden role="alert"></div>
        </div>

        <div class="field">
          <label for="f-skript">Skript-Link (Google Drive) <span class="muted">— optional</span></label>
          <input id="f-skript" type="url" value="${escapeHtml(val("skriptLink"))}" placeholder="https://drive.google.com/file/d/…/view" />
          <p class="field-hint muted">Nur nötig, wenn das Skript in Drive liegen soll statt hier hochgeladen zu werden.</p>
        </div>

        <div class="field">
          <label for="f-schnitt">Fertiges Video (YouTube · TikTok · Instagram · Vimeo · Drive)</label>
          <input id="f-schnitt" type="url" value="${escapeHtml(val("schnittLink"))}" placeholder="Link von irgendeiner Plattform einfügen — wird automatisch erkannt & eingebettet" />
          <div class="ave-embed-vorschau" id="aveEmbedVorschau"></div>
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
        </div>

        <div class="ave-gruppe ave-gruppe--intern">
          <div class="ave-gruppe-kopf">
            <span class="ave-gruppe-titel">🔒 Intern</span>
            <span class="ave-gruppe-sub muted">Sieht nur du — nichts davon erreicht den Kunden.</span>
          </div>

          <div class="field">
            <label for="f-objekt">${istGastro ? "Verknüpfte Filiale" : "Verknüpftes Objekt"}</label>
            <select id="f-objekt">${objektOpts}</select>
            ${istNeu ? `<p class="field-hint muted" id="f-objekt-hint"${objektMonatHinweis(objekte, objektId) ? "" : " hidden"}>${objektMonatHinweis(objekte, objektId)}</p>` : ""}
          </div>

          <div class="field">
            <label for="f-drive">Google-Drive-Ordner (Rohmaterial/Projekt)</label>
            <input id="f-drive" type="url" value="${escapeHtml(val("driveOrdner"))}" placeholder="https://drive.google.com/drive/folders/…" />
            <p class="field-hint muted">Leer lassen → Fallback auf den Drive-Ordner des Kunden.</p>
          </div>

          ${freigabeInfo}
        </div>

        <!-- Speichern/Löschen liegen in der Sticky-Leiste am Seitenende; hier
             bleibt nur, was zum Formular selbst gehört. -->
        ${istNeu ? `
        <div class="action-btns" style="margin-top:1.25rem">
          <button class="btn btn--accent" id="aveSave" type="submit">Anlegen</button>
        </div>` : `
        <div class="entwurf-box">
          <p class="muted" style="margin:0 0 .6rem">
            Änderungen umgesetzt? Aktualisiere den Plan/die Links oben, dann gib den Kunden einen neuen Entwurf zur Freigabe.
          </p>
          <button class="btn btn--ok" id="aveNeuerEntwurf" type="button">🔁 Neuen Entwurf an Kunden geben</button>
        </div>`}
      </form>
    </section>
    ${!istNeu && v && v.planId ? `
    <details class="ave-block" open>
      <summary class="ave-block-kopf"><span class="ave-block-titel">📋 Plan-Details</span></summary>
      <div id="avePlanDetails"></div>
    </details>` : ""}
    ${!istNeu ? `
    <details class="ave-block" open>
      <summary class="ave-block-kopf"><span class="ave-block-titel">🎬 Drehplan &amp; Skripte</span></summary>
      <div id="aveDrehplan"></div>
    </details>` : ""}
    ${!istNeu ? `
    <details class="ave-block">
      <summary class="ave-block-kopf">
        <span class="ave-block-titel">💬 Kommentare &amp; Änderungswünsche</span>
        <span class="ave-block-zahl muted" id="aveKommZahl"></span>
      </summary>
      <section class="vd-komm">
        <div id="aveKomms" class="komm-list"><p class="muted">Wird geladen …</p></div>
        <form id="aveKommForm" class="komm-form card card--pad">
          <div class="field" style="margin:0 0 .75rem">
            <label for="aveKommText">Antwort / Notiz an Kunde</label>
            <textarea id="aveKommText" placeholder="Antwort oder interne Notiz …"></textarea>
          </div>
          <div class="notice notice--error" id="aveKommErr" hidden role="alert"></div>
          <button class="btn btn--ghost btn--sm" type="submit" id="aveKommSubmit">Kommentar senden</button>
        </form>
      </section>
    </details>` : ""}
    ${!istNeu ? `
    <div class="ave-speicherleiste" id="aveSpeicherleiste" hidden>
      <span class="ave-speicher-hinweis">Ungespeicherte Änderungen</span>
      <button class="btn btn--ghost btn--sm" id="aveDelete" type="button">Löschen</button>
      <button class="btn btn--accent" id="aveSave" type="submit" form="aveForm">Speichern</button>
    </div>` : ""}`;
}

// --- Kopf: das Wichtigste vor dem Formular ----------------------------
// Beantwortet beim Öffnen sofort: welches Video, welcher Kunde, welcher Stand
// — und ob der Kunde gerade auf mich oder ich auf ihn warte.
function kopfHtml(v) {
  const kunde = getAktivKunde();
  const teile = [];
  if (kunde) teile.push(escapeHtml(kunde.name || kunde.id));
  if (v.typ) teile.push(escapeHtml(v.typ));
  teile.push(`Entwurf ${v.entwurf || 1}`);

  // „Wartet seit": Näherung über aktualisiertAm — das ist der Zeitpunkt, seit
  // dem der aktuelle Stand beim Kunden liegt. Deshalb bewusst als „Stand seit"
  // beschriftet und nicht als exakte Wartezeit ausgegeben.
  let hinweis = "";
  if (istFreigabeStufe(v.status)) {
    const was = v.status === STATUS.FREIGABE_SKRIPT ? "das Skript" : "den Schnitt";
    hinweis = `<div class="ave-wartet">
      <span aria-hidden="true">⏳</span>
      <span>Der <strong>Kunde ist am Zug</strong> — er soll ${was} freigeben.${tageSeit(v.aktualisiertAm)}</span>
    </div>`;
  }

  return `
    <h1 class="view-title" style="margin-bottom:.35rem">${escapeHtml(v.titel || "Video bearbeiten")}</h1>
    <p class="ave-kopf-meta muted">
      ${teile.join(" · ")}
      <span class="pill pill--neutral ave-kopf-status">${escapeHtml(v.status || "")}</span>
    </p>
    ${hinweis}`;
}

// „ · Stand seit 3 Tagen" — leer, wenn kein brauchbarer Zeitstempel vorliegt.
function tageSeit(ts) {
  const d = ts && ts.toDate ? ts.toDate() : null;
  if (!d || isNaN(d.getTime())) return "";
  const tage = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (tage < 1) return " Stand von heute.";
  return ` Stand seit ${tage} Tag${tage === 1 ? "" : "en"}.`;
}

// Herkunft eines Skript-Uploads für die Liste: von mir (Admin) oder vom Kunden.
function quelleLabel(u) {
  const von = String(u.gemeldetVon || "");
  return rolleVon(von) === "admin" ? "von mir" : `vom Kunden (${von.split("@")[0] || "Kunde"})`;
}

// --- Skript-Upload im Video-Formular ----------------------------------
// Gleiche Mechanik wie der Kunden-Upload in kunde-video-detail.js: Datei →
// Base64 (max ~700 KB) + offline extrahierter Text → Collection `skriptuploads`.
// Admin-Uploads werden sofort als `erledigt` angelegt, damit sie nicht als
// offener Kunden-Upload in der Pipeline anbadgen.
// Rückgabe: { ladeHoch(videoId) } — für den Anlege-Fall, in dem die videoId
// erst nach dem Speichern existiert.
function initSkriptUpload(body, { istNeu, user, videoId, kundeId }) {
  const drop    = body.querySelector("#skAdminDrop");
  const input   = body.querySelector("#skAdminFile");
  const pendEl  = body.querySelector("#skAdminPending");
  const okB     = body.querySelector("#skAdminOk");
  const errB    = body.querySelector("#skAdminErr");
  let vorgemerkt = null;   // nur im Anlege-Modus belegt

  if (!drop || !input) return { ladeHoch: async () => {} };

  // Datei → { base64, name, typ, text }. Textextraktion best-effort.
  async function lies(file) {
    const { base64, name, typ } = await dateiZuBase64(file);
    let text = "";
    try { text = await extrahiereText(file); } catch (_) { /* ohne Text weiter */ }
    return { base64, dateiName: name, dateiTyp: typ, text };
  }

  async function speichere(daten, zielVideoId) {
    return skriptUploadAnlegen({
      ...daten, videoId: zielVideoId, kundeId,
      gemeldetVon: user && user.email, erledigt: true
    });
  }

  function zeigeVorgemerkt() {
    if (!vorgemerkt) { pendEl.hidden = true; pendEl.innerHTML = ""; return; }
    pendEl.hidden = false;
    pendEl.innerHTML = `<span>📄 ${escapeHtml(vorgemerkt.dateiName)}</span>
      <span class="muted">wird beim Anlegen hochgeladen</span>
      <button class="btn btn--ghost btn--sm" type="button" id="skAdminPendingDel" title="Datei verwerfen">✕</button>`;
    pendEl.querySelector("#skAdminPendingDel").addEventListener("click", () => {
      vorgemerkt = null; zeigeVorgemerkt();
    });
  }

  const verarbeite = async (file) => {
    if (!file) return;
    okB.hidden = true; errB.hidden = true;
    const txtEl = drop.querySelector(".skript-drop-text");
    const alt = txtEl.textContent;
    drop.classList.add("is-busy");
    txtEl.textContent = istNeu ? "Wird gelesen …" : "Wird hochgeladen …";
    try {
      const daten = await lies(file);
      if (istNeu) {
        // Noch keine videoId → vormerken, wire() reicht sie nach dem Anlegen nach.
        vorgemerkt = daten;
        zeigeVorgemerkt();
      } else {
        await speichere(daten, videoId);
        okB.textContent = `„${daten.dateiName}" ist hochgeladen — du findest es unten unter „Skripte".`;
        okB.hidden = false;
      }
    } catch (e) {
      console.error(e);
      errB.textContent = (e && e.message) ? e.message : "Upload fehlgeschlagen. Bitte erneut versuchen.";
      errB.hidden = false;
    } finally {
      drop.classList.remove("is-busy");
      txtEl.textContent = alt;
      input.value = "";
    }
  };

  drop.addEventListener("click", () => input.click());
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  input.addEventListener("change", () => verarbeite(input.files && input.files[0]));
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("is-over"); }));
  ["dragleave", "dragend"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("is-over")));
  drop.addEventListener("drop", (e) => {
    e.preventDefault(); drop.classList.remove("is-over");
    verarbeite(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
  });

  return {
    // Vorgemerkte Datei an das frisch angelegte Video hängen. Schlägt das fehl,
    // wirft es NICHT — das Video ist schon gespeichert, nur der Anhang fehlt.
    async ladeHoch(neueVideoId) {
      if (!vorgemerkt || !neueVideoId) return;
      try { await speichere(vorgemerkt, neueVideoId); vorgemerkt = null; }
      catch (e) { console.error(e); alert("Das Video wurde angelegt, aber das Skript konnte nicht hochgeladen werden. Bitte im Bearbeiten-Modus erneut versuchen."); }
    }
  };
}

// Hinweistext unter dem Objekt-Select: in welchen Pipeline-Monat das neue Video
// dadurch fällt. Leerer String = kein Objekt gewählt (Hinweis bleibt versteckt).
function objektMonatHinweis(objekte, objektId) {
  const o = objektId && (objekte || []).find((x) => x.id === objektId);
  if (!o) return "";
  return `Landet in der Pipeline-Sektion <strong>${escapeHtml(monatsLabel(objektProduktionsMonat(o)))}</strong> — dem Produktionsmonat des Objekts.`;
}

function freigText(f) {
  if (!f) return `<span class="muted">offen</span>`;
  return `${escapeHtml(f.by || "Kunde")} · ${escapeHtml(formatDatum(f.at, true))}`;
}

// --- Speichern / Anlegen / Löschen ------------------------------------
// `objekte` = Objektliste des Kunden (für den Produktionsmonat beim Anlegen),
// `kundeId` = aktiver Mandant (kommt aus renderAdminVideoEdit),
// `skriptUpload` = Handle aus initSkriptUpload() (reicht die vorgemerkte Datei nach).
function wire(v, istNeu, body, id, user, objekte, kundeId, skriptUpload) {
  const form   = body.querySelector("#aveForm");
  const okBox  = body.querySelector("#aveOk");
  const errBox = body.querySelector("#aveErr");
  const save   = body.querySelector("#aveSave");
  const del    = body.querySelector("#aveDelete");
  const leiste = body.querySelector("#aveSpeicherleiste");

  // Speicherleiste erscheint erst, wenn wirklich etwas geändert wurde — so
  // scrollt man nicht mehr am Speichern vorbei, ohne dass sie ständig im Weg ist.
  // Der Datei-Dialog des Skript-Uploads zählt nicht: der speichert selbst.
  if (leiste) {
    const zeige = (e) => {
      if (e && e.target && e.target.id === "skAdminFile") return;
      leiste.hidden = false;
    };
    form.addEventListener("input", zeige);
    form.addEventListener("change", zeige);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    okBox.hidden = true; errBox.hidden = true;

    const daten = {
      titel:       body.querySelector("#f-titel").value.trim(),
      typ:         body.querySelector("#f-typ").value,
      status:      body.querySelector("#f-status").value,
      objektId:    body.querySelector("#f-objekt").value || null,
      skriptLink:  body.querySelector("#f-skript").value.trim(),
      driveOrdner: body.querySelector("#f-drive").value.trim(),
      schnittLink: body.querySelector("#f-schnitt").value.trim(),
      geplantesDatum:     dateInputZuDate(body.querySelector("#f-datum").value),
      geplanterDrehtermin: dateInputZuDate(body.querySelector("#f-drehdatum").value)
    };

    if (!daten.titel) { errBox.textContent = "Bitte einen Titel eingeben."; errBox.hidden = false; return; }

    // Terminänderung erkennen (Vergleich über die Input-Strings — robust gegen
    // Timestamp/Date-Typmix). Nur relevant beim Bearbeiten.
    const terminGeaendert = !istNeu && (
      tsZuDateInput(v.geplantesDatum)      !== body.querySelector("#f-datum").value ||
      tsZuDateInput(v.geplanterDrehtermin) !== body.querySelector("#f-drehdatum").value
    );

    save.disabled = true;
    const orig = save.textContent;
    save.textContent = istNeu ? "Wird angelegt …" : "Wird gespeichert …";
    try {
      if (istNeu) {
        // Hängt das Video an einem Objekt, erbt es dessen Produktionsmonat —
        // Objekt und Video liegen so in derselben Monats-Sektion. Danach ist der
        // Monat nur noch über das Dropdown in der Pipeline umhängbar.
        const quelle = daten.objektId && (objekte || []).find((o) => o.id === daten.objektId);
        if (quelle) daten.monat = objektProduktionsMonat(quelle);

        const ref = await videoAnlegen({ ...daten, kundeId });
        // Erst jetzt gibt es eine videoId für ein vorgemerktes Skript.
        // WICHTIG: Ab hier ist das Video ANGELEGT. Ein Fehler beim Skript darf
        // deshalb nicht in den äußeren catch laufen — der meldete sonst
        // „Speichern fehlgeschlagen", obwohl das Video längst in der Pipeline
        // liegt. Wer daraufhin erneut klickt, erzeugt ein Duplikat.
        let uploadFehler = null;
        if (skriptUpload) {
          try { await skriptUpload.ladeHoch(ref.id); }
          catch (e) { console.error("Skript-Upload fehlgeschlagen:", e); uploadFehler = e; }
        }
        if (uploadFehler) {
          alert(`Das Video „${daten.titel}" wurde angelegt — nur das Skript konnte nicht hochgeladen werden:\n\n`
              + `${(uploadFehler && uploadFehler.message) || uploadFehler}\n\n`
              + `Du kannst es gleich in der Bearbeitung erneut hochladen.`);
        }
        // Kunden-News: neues Video in der Pipeline.
        benachrichtigeKunde(kundeId, {
          text: `🎬 Ein neues Video wurde für dich angelegt: „${daten.titel}".`,
          videoId: ref.id, art: "neu"
        }).catch(() => {});
        location.hash = "/admin/video/" + ref.id;   // → lädt im Bearbeiten-Modus neu
      } else {
        await aktualisiereVideo(id, daten);
        if (terminGeaendert) {
          benachrichtigeKunde(v.kundeId, {
            text: `📅 Termin aktualisiert für „${daten.titel}".`,
            videoId: id, art: "termin"
          }).catch(() => {});
        }
        okBox.textContent = "Gespeichert.";
        okBox.hidden = false;
        if (leiste) leiste.hidden = true;   // nichts Ungespeichertes mehr offen
        okBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    } catch (err) {
      console.error(err);
      // Den ECHTEN Grund zeigen. Das blanke „Speichern fehlgeschlagen" zwang
      // vorher dazu, die Browser-Konsole zu öffnen, um überhaupt zu erfahren,
      // woran es lag (Rechte? Feldwert? Netz?).
      const grund = (err && (err.message || err.code)) ? ` ${err.message || err.code}` : "";
      errBox.textContent = `Speichern fehlgeschlagen.${grund}`;
      errBox.hidden = false;
    } finally {
      save.disabled = false;
      save.textContent = orig;
    }
  });

  // „Neuen Entwurf an Kunden geben": Entwurfsnummer +1, Status auf die passende
  // Freigabe-Stufe, Kunde wird zur Freigabe informiert. Der aktuelle Plan-Stand
  // wird als kundensichtbarer Snapshot übernommen.
  const neuerEntwurf = body.querySelector("#aveNeuerEntwurf");
  if (neuerEntwurf) {
    neuerEntwurf.addEventListener("click", async () => {
      const naechste = (v.entwurf || 1) + 1;
      if (!confirm(`Neuen Entwurf (Nr. ${naechste}) an den Kunden geben?\nStatus springt auf die passende Freigabe-Stufe und der Kunde wird zur Freigabe benachrichtigt.`)) return;

      okBox.hidden = true; errBox.hidden = true;
      neuerEntwurf.disabled = true;
      const orig = neuerEntwurf.textContent;
      neuerEntwurf.textContent = "Wird veröffentlicht …";
      try {
        const res = await videoNeuerEntwurf(v);   // entwurf+1, Freigabe-Stufe, planSnapshot
        sendKundeFreigabe({ titel: v.titel || "Dein Video", art: res.artLabel, videoId: id });
        benachrichtigeKunde(v.kundeId, {
          text: `Neue Version (Entwurf ${res.entwurf}) von „${v.titel || "deinem Video"}" — wartet auf deine Freigabe.`,
          videoId: id, art: "version"
        }).catch(() => {});
        v.entwurf = res.entwurf; v.status = res.status;   // lokalen Stand nachziehen
        okBox.textContent = `Entwurf ${res.entwurf} veröffentlicht – der Kunde wurde zur Freigabe informiert.`;
        okBox.hidden = false;
        okBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } catch (err) {
        console.error(err);
        errBox.textContent = "Konnte den neuen Entwurf nicht veröffentlichen.";
        errBox.hidden = false;
      } finally {
        neuerEntwurf.disabled = false;
        neuerEntwurf.textContent = orig;
      }
    });
  }

  if (del) {
    del.addEventListener("click", async () => {
      if (!confirm("Dieses Video wirklich löschen? Das kann nicht rückgängig gemacht werden.")) return;
      del.disabled = true;
      try {
        await loescheVideo(id);
        // Plan-Verknüpfung lösen, damit der Plan nicht auf ein totes Video zeigt.
        if (v && v.planId) aktualisierePlan(v.planId, { videoId: null }).catch(() => {});
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
// Zeigt LIVE aus /plaene ALLES, was im Plan hinterlegt wurde (Notiz, Sound,
// Shotlist, Inspirationen, Anhänge). Dieselbe Darstellung wie beim Kunden —
// die Render-Logik steckt in plan-ansicht.js.
//
// Zusätzlich: hier wird der kundensichtbare `planSnapshot` des Videos aktuell
// gehalten. Das heilt auch Bestandsvideos, die vor diesem Feature deployt
// wurden (ohne Snapshot) — sobald der Admin sie einmal öffnet.
async function initPlanDetails(video, body) {
  const ziel = body.querySelector("#avePlanDetails");
  if (!ziel) return;
  ziel.innerHTML = `<section class="card card--pad" style="margin-top:1.5rem"><p class="muted">Plan-Details werden geladen …</p></section>`;
  let plan = null;
  try { plan = await ladePlan(video.planId); } catch (e) { console.error(e); }
  if (!plan) {
    ziel.innerHTML = `<section class="card card--pad" style="margin-top:1.5rem"><p class="muted">Herkunfts-Plan nicht (mehr) gefunden.</p></section>`;
    return;
  }

  renderPlanDetails(ziel, plan, {
    titel: "📋 Aus dem Plan",
    editLink: "#/admin/plan/" + video.planId
  });

  // Snapshot für den Kunden aktuell halten — nur schreiben, wenn abweichend.
  try {
    const neu = planZuSnapshot(plan);
    const alt = video.planSnapshot ? planZuSnapshot(video.planSnapshot) : null;
    if (JSON.stringify(neu) !== JSON.stringify(alt)) {
      aktualisiereVideo(video.id, { planSnapshot: neu }).catch(() => {});
    }
  } catch (_) { /* Snapshot-Sync ist Best-Effort */ }
}

// --- Live-Vorschau des universellen Video-Links -----------------------
function initEmbedVorschau(body) {
  const inp  = body.querySelector("#f-schnitt");
  const ziel = body.querySelector("#aveEmbedVorschau");
  if (!inp || !ziel) return;
  const render = () => {
    const url = inp.value.trim();
    if (!/^https?:\/\//i.test(url)) { ziel.innerHTML = ""; return; }
    ziel.innerHTML = embedHtml(url);
    verarbeiteEmbeds(ziel);
  };
  render();
  inp.addEventListener("change", render);
  inp.addEventListener("blur", render);
}

// --- Drehplan / Beats -------------------------------------------------
// Erzeugt aus dem Skript (Datei-Drop / Kunden-Upload / eingefügter Text) eine
// abhakbare Beat-Checkliste (Feld video.drehbeats) für den Drehtag.
function initDrehplan(video, body) {
  const wrap = body.querySelector("#aveDrehplan");
  if (!wrap) return;
  let beats = Array.isArray(video.drehbeats) ? video.drehbeats.slice() : [];

  wrap.innerHTML = `
    <section class="card card--pad ave-drehplan">
      <div class="plan-head-row">
        <h2 class="section-title" style="margin:0">🎬 Drehplan / Beats</h2>
        <a class="btn btn--ghost btn--sm" id="drehOpen" href="#/admin/drehtag/${escapeHtml(video.id)}">Drehtag öffnen ↗</a>
      </div>
      <div id="drehUploads"></div>
      <div id="drehMain"></div>
    </section>`;

  const uploadsEl = wrap.querySelector("#drehUploads");
  const mainEl    = wrap.querySelector("#drehMain");

  // --- Kunden-Uploads (überarbeitete Skripte) ------------------------
  const unsub = beobachteSkriptUploads(video.id, (uploads) => {
    const liste = uploads.sort((a, b) => ((b.erstelltAm && b.erstelltAm.seconds) || 0) - ((a.erstelltAm && a.erstelltAm.seconds) || 0));
    if (!liste.length) { uploadsEl.innerHTML = ""; return; }
    uploadsEl.innerHTML = `<div class="dreh-uploads">
      <div class="gd-abschnitt-titel">📄 Skripte</div>
      ${liste.map((u) => `
        <div class="dreh-upload" data-id="${escapeHtml(u.id)}">
          <div class="dreh-upload-kopf">
            <span>📄 ${escapeHtml(u.dateiName || "Skript")} <span class="muted">· ${escapeHtml(quelleLabel(u))} · ${escapeHtml(formatDatum(u.erstelltAm, true))}${u.erledigt ? " · ✅" : ""}</span></span>
            <span class="dreh-upload-btns">
              <button class="btn btn--ghost btn--sm" data-akt="ansehen" type="button">Ansehen</button>
              <button class="btn btn--ok btn--sm" data-akt="beats" type="button">Beats erzeugen</button>
              <button class="btn btn--ghost btn--sm" data-akt="erledigt" type="button">${u.erledigt ? "Als offen" : "Erledigt"}</button>
              <button class="btn btn--ghost btn--sm" data-akt="del" type="button" title="Löschen">✕</button>
            </span>
          </div>
          <div class="dreh-upload-view" hidden></div>
        </div>`).join("")}
    </div>`;

    uploadsEl.querySelectorAll(".dreh-upload").forEach((row) => {
      const uid = row.getAttribute("data-id");
      const u = liste.find((x) => x.id === uid);
      row.querySelector('[data-akt="ansehen"]').addEventListener("click", () => {
        const view = row.querySelector(".dreh-upload-view");
        if (!view.hidden) { view.hidden = true; view.innerHTML = ""; return; }
        view.hidden = false;
        const cleanup = zeigeDateiInline(view, { base64: u.base64, typ: u.dateiTyp, name: u.dateiName });
        beiViewWechsel(cleanup);
      });
      row.querySelector('[data-akt="beats"]').addEventListener("click", () => {
        const txt = (u.text || "").trim();
        if (!txt) { alert("Aus dieser Datei konnte kein Text extrahiert werden. Bitte Text unten einfügen oder die Datei erneut hochladen."); return; }
        zeigeVorschau(parseBeats(txt));
      });
      row.querySelector('[data-akt="erledigt"]').addEventListener("click", async (e) => {
        e.target.disabled = true;
        try { await setzeSkriptUploadErledigt(uid, !u.erledigt); } catch (err) { console.error(err); e.target.disabled = false; }
      });
      row.querySelector('[data-akt="del"]').addEventListener("click", async () => {
        if (!confirm("Diesen Skript-Upload löschen?")) return;
        try { await loescheSkriptUpload(uid); } catch (err) { console.error(err); }
      });
    });
  }, () => {});
  beiViewWechsel(unsub);

  // --- Checkliste vs. Generator --------------------------------------
  function speichereBeats(neu) {
    beats = neu;
    video.drehbeats = neu;
    return aktualisiereVideo(video.id, { drehbeats: neu });
  }

  function renderMain() {
    if (beats.length) renderChecklist(); else renderGenerator();
  }

  function renderChecklist() {
    const done = beats.filter((b) => b.erledigt).length;
    mainEl.innerHTML = `
      <div class="dreh-check-kopf">
        <span class="dreh-fortschritt">${done}/${beats.length} Beats gedreht</span>
        <button class="btn btn--ghost btn--sm" id="drehNeu" type="button">Beats neu erzeugen</button>
      </div>
      <ul class="dreh-beats">
        ${beats.map((b, i) => `
          <li class="dreh-beat${b.erledigt ? " is-done" : ""}">
            <label class="dreh-beat-haupt">
              <input type="checkbox" data-i="${i}" ${b.erledigt ? "checked" : ""}>
              <span class="dreh-beat-titel">${escapeHtml(b.text || `Beat ${i + 1}`)}</span>
            </label>
            ${b.sprechtext ? `<div class="dreh-beat-text">${escapeHtml(b.sprechtext)}</div>` : ""}
          </li>`).join("")}
      </ul>`;
    mainEl.querySelectorAll('input[type="checkbox"][data-i]').forEach((cb) => {
      cb.addEventListener("change", async () => {
        const i = Number(cb.getAttribute("data-i"));
        const neu = beats.map((b, idx) => idx === i ? { ...b, erledigt: cb.checked } : b);
        cb.closest(".dreh-beat").classList.toggle("is-done", cb.checked);
        const kopf = mainEl.querySelector(".dreh-fortschritt");
        if (kopf) kopf.textContent = `${neu.filter((b) => b.erledigt).length}/${neu.length} Beats gedreht`;
        try { await speichereBeats(neu); } catch (e) { console.error(e); }
      });
    });
    mainEl.querySelector("#drehNeu").addEventListener("click", () => {
      if (!confirm("Beats neu erzeugen? Der aktuelle Abhak-Stand geht dabei verloren.")) return;
      renderGenerator();
    });
  }

  function renderGenerator() {
    mainEl.innerHTML = `
      <p class="muted" style="margin:0 0 .6rem">Aus dem Skript einzelne Beats als Dreh-Checkliste erzeugen. Word/PDF hier ablegen oder Text einfügen:</p>
      <div class="skript-drop" id="drehDrop" tabindex="0" role="button">
        <span class="skript-drop-icon" aria-hidden="true">⬆️</span>
        <span class="skript-drop-text">Skript-Datei hierher ziehen oder <span class="skript-drop-link">auswählen</span></span>
        <span class="muted skript-drop-hint">.docx / .pdf</span>
      </div>
      <input type="file" id="drehFile" accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden />
      <div class="dreh-oder muted">— oder Text einfügen —</div>
      <textarea id="drehText" class="dreh-textarea" placeholder="Skript-Text hier einfügen (Beats mit „BEAT 1", „BEAT 2" …)"></textarea>
      <div class="notice notice--error" id="drehErr" hidden role="alert"></div>
      <button class="btn btn--accent btn--sm" id="drehGen" type="button">Beats erzeugen</button>`;

    const drop  = mainEl.querySelector("#drehDrop");
    const file  = mainEl.querySelector("#drehFile");
    const text  = mainEl.querySelector("#drehText");
    const err   = mainEl.querySelector("#drehErr");
    const genBtn = mainEl.querySelector("#drehGen");

    const ausDatei = async (f) => {
      if (!f) return;
      err.hidden = true;
      drop.querySelector(".skript-drop-text").textContent = "Wird gelesen …";
      try {
        const t = await extrahiereText(f);
        const bs = parseBeats(t);
        if (!bs.length) throw new Error("Keine Beats erkannt.");
        zeigeVorschau(bs);
      } catch (e) {
        err.textContent = (e && e.message) || "Konnte die Datei nicht lesen."; err.hidden = false;
        drop.querySelector(".skript-drop-text").innerHTML = 'Skript-Datei hierher ziehen oder <span class="skript-drop-link">auswählen</span>';
      }
    };
    drop.addEventListener("click", () => file.click());
    drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); } });
    file.addEventListener("change", () => ausDatei(file.files && file.files[0]));
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("is-over"); }));
    ["dragleave", "dragend"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("is-over")));
    drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("is-over"); ausDatei(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]); });

    genBtn.addEventListener("click", () => {
      err.hidden = true;
      const bs = parseBeats(text.value || "");
      if (!bs.length) { err.textContent = "Kein Text / keine Beats erkannt."; err.hidden = false; return; }
      zeigeVorschau(bs);
    });
  }

  function zeigeVorschau(rohBeats) {
    const neu = beatsZuChecklist(rohBeats);
    mainEl.innerHTML = `
      <div class="dreh-vorschau">
        <div class="gd-abschnitt-titel">Erkannte Beats (${neu.length}):</div>
        <ul class="dreh-beats">
          ${neu.map((b, i) => `<li class="dreh-beat"><span class="dreh-beat-titel">${escapeHtml(b.text || `Beat ${i + 1}`)}</span>
            ${b.sprechtext ? `<div class="dreh-beat-text">${escapeHtml(b.sprechtext)}</div>` : ""}</li>`).join("")}
        </ul>
        <div class="action-btns">
          <button class="btn btn--accent btn--sm" id="drehSpeichern" type="button">Als Drehplan speichern</button>
          <button class="btn btn--ghost btn--sm" id="drehAbbr" type="button">Abbrechen</button>
        </div>
      </div>`;
    mainEl.querySelector("#drehSpeichern").addEventListener("click", async (e) => {
      e.target.disabled = true;
      try { await speichereBeats(neu); renderMain(); }
      catch (err) { console.error(err); e.target.disabled = false; alert("Speichern fehlgeschlagen."); }
    });
    mainEl.querySelector("#drehAbbr").addEventListener("click", renderMain);
  }

  renderMain();
}

// --- Kommentare (Bearbeiten-Modus) ------------------------------------
function initKommentare(id, user, body) {
  const liste = body.querySelector("#aveKomms");
  const form  = body.querySelector("#aveKommForm");
  const text  = body.querySelector("#aveKommText");
  const err   = body.querySelector("#aveKommErr");
  const submit = body.querySelector("#aveKommSubmit");

  const zahl  = body.querySelector("#aveKommZahl");

  const unsub = beobachteKommentare(id,
    (komms) => {
      // Zähler im Sektions-Kopf, damit man den Block nicht aufklappen muss,
      // um zu sehen, ob etwas Neues drin ist.
      if (zahl) {
        const neu = komms.filter((k) => k.rolle !== "admin" && (k.bearbeitung || "neu") === "neu").length;
        zahl.textContent = komms.length
          ? `${komms.length}${neu ? ` · ${neu} neu` : ""}`
          : "keine";
        zahl.classList.toggle("ave-block-zahl--neu", neu > 0);
      }
      if (!komms.length) { liste.innerHTML = `<p class="muted">Noch keine Kommentare.</p>`; return; }
      liste.innerHTML = komms.map((k) => {
        const istKunde = k.rolle !== "admin";
        const autor = k.rolle === "admin" ? "Du (Valentin)" : (String(k.autor || "").split("@")[0] || "Kunde");
        const wunsch = k.art === "aenderungswunsch" ? `<span class="pill pill--aktion">Änderungswunsch</span>` : "";
        // Bearbeitungs-Status + Buttons nur bei Kunden-Nachrichten.
        const status = k.bearbeitung || "neu";
        const statusPille = istKunde
          ? `<span class="komm-status komm-status--${status}">${BEARB_LABEL[status] || status}</span>` : "";
        const setBtn = (val, label) =>
          `<button class="ave-msg-set${status === val ? " is-active" : ""}" data-kid="${escapeHtml(k.id)}" data-set="${val}" type="button">${label}</button>`;
        const btns = istKunde
          ? `<div class="komm-btns">${setBtn("gelesen", "Gelesen")}${setBtn("in_umsetzung", "In Umsetzung")}${setBtn("umgesetzt", "Umgesetzt")}</div>` : "";
        const neuKlasse = (istKunde && status === "neu") ? " komm--neu" : "";
        return `
          <div class="komm komm--${escapeHtml(k.rolle || "kunde")}${neuKlasse}">
            <div class="komm-head">
              <span class="komm-autor">${escapeHtml(autor)}</span>
              ${wunsch}
              ${statusPille}
              <span class="komm-zeit muted">${escapeHtml(formatDatum(k.erstelltAm, true))}</span>
            </div>
            <div class="komm-text">${escapeHtml(k.text)}</div>
            ${btns}
          </div>`;
      }).join("");
    },
    (e) => console.error(e)
  );
  beiViewWechsel(unsub);

  // Event-Delegation: der Thread wird bei jedem Snapshot neu gerendert, daher
  // einmal am Container lauschen statt pro Button.
  liste.addEventListener("click", async (e) => {
    const btn = e.target.closest(".ave-msg-set");
    if (!btn) return;
    const kid = btn.getAttribute("data-kid");
    const wert = btn.getAttribute("data-set");
    if (!kid) return;
    try { await kommentarSetzeBearbeitung(id, kid, wert); }
    catch (err) { console.error(err); }
  });

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
