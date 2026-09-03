// Kunden-View: Formate — Route #/formate
//
// Die Lese-Seite von /admin/kunde-formate: der Kunde sieht die Baupläne, die
// für IHN angelegt wurden (Collection /kundenformate, gefiltert auf seine
// kundeId — die Rules lassen nichts anderes durch).
//
// Bewusst read-only: Formate sind Valentins Handwerk, der Kunde soll sie
// verstehen, nicht bearbeiten. Deshalb hier auch keine Beat-Felder zum
// Tippen, sondern der Aufbau als lesbare Abfolge.
//
// Referenzen sind ausschliesslich die `links` eines Formats. Die
// `inspirationIds` zeigen auf /inspirationen (admin-only) — der Kunde koennte
// sie nicht laden, darum werden sie im Admin-Editor im Kundenmodus gar nicht
// erst angeboten (admin-formate.js).
import { ladeKundenformate } from "../db.js";
import { escapeHtml } from "../util.js";
import { embedHtml, verarbeiteEmbeds } from "../embeds.js";
import { PLATTFORMEN, GROESSEN, PERSPEKTIVEN, BEWEGUNGEN, AUFWAND, labelVon } from "../brandplan.js";

export function renderKundeFormate(container, opts = {}) {
  const kundeId = opts.kundeId || null;
  let formate = [];
  let offen = null;              // aufgeklapptes Format

  container.innerHTML = `
    <h1 class="view-title">Formate</h1>
    <p class="muted view-intro">Die Baupläne für deine Videos: wie sie aufgebaut sind, was dafür
      gebraucht wird und woran wir uns orientieren. Tipp auf ein Format, um den Aufbau zu sehen.</p>
    <div class="fm-liste" id="kfListe"><p class="muted">Lädt …</p></div>`;

  const liste = container.querySelector("#kfListe");

  function karteHtml(f) {
    const auf = offen === f.id;
    const beats = Array.isArray(f.beats) ? f.beats : [];
    const links = (Array.isArray(f.links) ? f.links : [])
      .map((l) => String((l && l.url) || "").trim())
      .filter(Boolean);
    const chips = [
      f.talkingHead === false ? "Ohne Auftritt vor der Kamera" : "Mit Auftritt vor der Kamera",
      labelVon(AUFWAND, f.aufwand),
      ...(Array.isArray(f.plattformen) ? f.plattformen : []).map((p) => labelVon(PLATTFORMEN, p))
    ].filter(Boolean);

    return `
      <article class="card fm-karte${auf ? " is-offen" : ""}" data-id="${escapeHtml(f.id)}">
        <div class="fm-kopf">
          <button class="fm-titel" type="button">${escapeHtml(f.name || "Format")}</button>
          <span class="muted fm-sub">${beats.length} Schritt${beats.length === 1 ? "" : "e"}${
            links.length ? ` · ${links.length} Referenz${links.length === 1 ? "" : "en"}` : ""}</span>
        </div>
        ${f.beschreibung ? `<p class="muted fm-beschr">${escapeHtml(f.beschreibung)}</p>` : ""}
        <div class="bs-chips">${chips.map((c) => `<span class="bs-chip">${escapeHtml(c)}</span>`).join("")}</div>
        ${f.materialBedarf ? `<p class="fm-material">🎞️ ${escapeHtml(f.materialBedarf)}</p>` : ""}
        ${auf ? detailHtml(beats, links) : ""}
      </article>`;
  }

  function detailHtml(beats, links) {
    return `
      <div class="fm-editor">
        ${beats.length ? `
          <div class="fm-block">
            <span class="bs-feld-titel">Aufbau</span>
            <div class="fm-beats">${beats.map(beatHtml).join("")}</div>
          </div>` : ""}
        ${links.length ? `
          <div class="fm-block">
            <span class="bs-feld-titel">Daran orientieren wir uns</span>
            <div class="fm-vorschau">${links.map((u) => `<div class="insp-embed">${embedHtml(u)}</div>`).join("")}</div>
          </div>` : ""}
      </div>`;
  }

  // Ein Beat als Fliesstext statt als Formularzeile: Kameragroesse, Perspektive
  // und Bewegung sind Fachbegriffe, die als Aufzaehlung hinter dem Hinweis
  // stehen — wer sie nicht kennt, liest einfach darueber hinweg.
  function beatHtml(b, i) {
    const technik = [
      labelVon(GROESSEN, b.groesse),
      labelVon(PERSPEKTIVEN, b.perspektive),
      labelVon(BEWEGUNGEN, b.bewegung),
      b.dauer == null || b.dauer === "" ? null : `${b.dauer} Sek.`
    ].filter(Boolean);

    return `
      <div class="fm-beat">
        <div class="fm-beat-kopf">
          <span class="fm-beat-nr">${i + 1}</span>
          <strong>${escapeHtml(b.label || "Schritt")}</strong>
        </div>
        ${b.hinweis ? `<p class="muted" style="margin:.2rem 0 0">${escapeHtml(b.hinweis)}</p>` : ""}
        ${technik.length ? `<p class="muted" style="margin:.25rem 0 0;font-size:.85em">${
          escapeHtml(technik.join(" · "))}</p>` : ""}
      </div>`;
  }

  function zeichne() {
    if (!formate.length) {
      liste.innerHTML = `<div class="card card--pad empty-card">
        <div class="empty-emoji">🧩</div>
        <p class="empty-title">Noch keine Formate</p>
        <p class="muted">Sobald wir Baupläne für deine Videos angelegt haben, stehen sie hier.</p>
      </div>`;
      return;
    }

    liste.innerHTML = formate.map(karteHtml).join("");
    const offeneKarte = liste.querySelector(".fm-karte.is-offen");
    if (offeneKarte) verarbeiteEmbeds(offeneKarte);

    liste.querySelectorAll(".fm-karte").forEach((karte) => {
      const fid = karte.getAttribute("data-id");
      karte.querySelector(".fm-titel").addEventListener("click", () => {
        offen = offen === fid ? null : fid;
        zeichne();
      });
    });
  }

  (async function laden() {
    try {
      formate = await ladeKundenformate(kundeId);
      zeichne();
    } catch (e) {
      console.error("[Formate] Laden fehlgeschlagen:", e && e.code, e && e.message);
      liste.innerHTML = `<div class="card card--pad"><p class="notice notice--error" style="margin:0">
        Formate konnten nicht geladen werden — bitte die Seite neu laden.</p></div>`;
    }
  })();
}
