// Kunden-View: „Content-Kalender" — Route #/content-kalender (Vale, 04.10.2026)
//
// Zeigt dem Kunden jeden fest eingeplanten Instagram-Post mit Vorschaubild,
// Termin, Caption und Standort — und nach dem Posten den Link. Die Daten
// legt das Social-Brain-Cockpit selbst in /contentplan an (Auto-Posten über
// Strato und von Hand in Instagram geplante Posts), der Kunde muss nichts tun.
//
// Bewusst KUNDENSICHER und read-only: `beobachteContentplan(kundeId)` liefert
// nur die eigenen Einträge (in firestore.rules fail-closed abgesichert).
// Interne Zustände (Fehler, gestoppt) erscheinen nur als neutrales
// „Verschoben" bzw. gar nicht — der Kunde soll planen können, nicht debuggen.
// Dieselbe View dient dem Admin unter #/admin/content-kalender für den
// aktiven Kunden.
import { beobachteContentplan } from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { escapeHtml } from "../util.js";

const WT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const ONLINE_ANFANG = 9;           // so viele bereits veröffentlichte Posts sofort zeigen

export function renderKundeContentKalender(container, opts = {}) {
  const kundeId = opts.kundeId || null;
  let posts = [];
  let alleOnline = false;
  const offen = new Set();         // Post-IDs mit ausgeklappter Caption

  container.innerHTML = `
    <h1 class="view-title">Content-Kalender</h1>
    <p class="muted view-intro">Alle Posts, die fest eingeplant sind. Sie gehen zum angegebenen
      Zeitpunkt automatisch auf Instagram online. Danach findest du sie unten mit Link.</p>
    <div id="ckBody"><div class="card card--pad"><p class="muted">Wird geladen …</p></div></div>`;
  const body = container.querySelector("#ckBody");

  if (!kundeId) {
    body.innerHTML = `<div class="card card--pad"><p class="muted" style="margin:0">Kein Kunde ausgewählt.</p></div>`;
    return;
  }

  const unsub = beobachteContentplan(kundeId,
    (liste) => { posts = liste.filter((p) => p.status !== "gestoppt"); zeichne(); },
    (err) => {
      console.error(err);
      body.innerHTML = `<div class="card card--pad"><p class="notice notice--error" style="margin:0">
        Der Content-Kalender konnte nicht geladen werden. Bitte später erneut versuchen.</p></div>`;
    });
  beiViewWechsel(unsub);

  body.addEventListener("click", (e) => {
    const mehr = e.target.closest("[data-mehr]");
    if (mehr) { const id = mehr.getAttribute("data-mehr"); offen.has(id) ? offen.delete(id) : offen.add(id); zeichne(); return; }
    if (e.target.closest("#ckAlleOnline")) { alleOnline = true; zeichne(); }
  });

  function zeichne() {
    const jetzt = Date.now();
    const istOnline = (p) => p.status === "veroeffentlicht" || (p.status === "geplant" && p.weg === "hand" && (p.terminTs || 0) < jetzt);
    const kommend = posts.filter((p) => !istOnline(p)).sort((a, b) => (a.terminTs || 0) - (b.terminTs || 0));
    const online = posts.filter(istOnline).sort((a, b) => (b.terminTs || 0) - (a.terminTs || 0));

    if (!kommend.length && !online.length) {
      body.innerHTML = `
        <div class="card card--pad empty-card">
          <div class="empty-emoji">📅</div>
          <p class="muted" style="margin:0">Gerade ist noch kein Post eingeplant. Sobald ein Termin feststeht, erscheint er hier.</p>
        </div>`;
      return;
    }

    const naechster = kommend.find((p) => (p.terminTs || 0) >= jetzt);
    const zeigeOnline = alleOnline ? online : online.slice(0, ONLINE_ANFANG);
    body.innerHTML = `
      ${naechster ? `<div class="card card--pad ck-naechster">📣 <b>Nächster Post:</b> ${escapeHtml(terminText(naechster, true))}${
        naechster.titel ? ` · ${escapeHtml(naechster.titel)}` : ""}</div>` : ""}
      <h2 class="ck-abschnitt">Geplant <span class="muted">(${kommend.length})</span></h2>
      ${kommend.length ? `<div class="ck-grid">${kommend.map((p) => karte(p, jetzt)).join("")}</div>`
        : `<p class="muted">Aktuell ist nichts Weiteres eingeplant.</p>`}
      ${online.length ? `
        <h2 class="ck-abschnitt">Bereits online <span class="muted">(${online.length})</span></h2>
        <div class="ck-grid">${zeigeOnline.map((p) => karte(p, jetzt)).join("")}</div>
        ${online.length > zeigeOnline.length ? `<button class="btn btn--ghost ck-mehr-btn" id="ckAlleOnline" type="button">Alle ${online.length} anzeigen</button>` : ""}` : ""}`;
  }

  function karte(p, jetzt) {
    const st = statusVon(p, jetzt);
    const cap = String(p.caption || "").trim();
    const auf = offen.has(p.id);
    const lang = cap.length > 140 || cap.split("\n").length > 3;
    const capHtml = cap ? `<div class="ck-caption${auf || !lang ? " is-offen" : ""}">${captionHtml(cap)}</div>
      ${lang ? `<button class="ck-caption-mehr" type="button" data-mehr="${escapeHtml(p.id)}">${auf ? "weniger" : "mehr"}</button>` : ""}` : "";
    return `
      <article class="card ck-karte">
        <div class="ck-bild">
          ${p.bild ? `<img src="${escapeHtml(p.bild)}" alt="" loading="lazy">` : `<div class="ck-bild-leer">${p.posttyp === "karussell" ? "🖼️" : "🎬"}</div>`}
          <span class="ck-datum">${escapeHtml(terminText(p, false))}</span>
        </div>
        <div class="ck-inhalt">
          <span class="ck-status ck-status--${st.klasse}">${st.text}</span>
          ${p.titel ? `<h3 class="ck-titel">${escapeHtml(p.titel)}</h3>` : ""}
          ${capHtml}
          ${p.ort ? `<p class="muted ck-ort">📍 ${escapeHtml(p.ort)}</p>` : ""}
          ${p.permalink ? `<a class="ck-link" href="${escapeHtml(p.permalink)}" target="_blank" rel="noopener">Auf Instagram ansehen ↗</a>` : ""}
        </div>
      </article>`;
  }
}

function statusVon(p, jetzt) {
  if (p.status === "veroeffentlicht") return { text: "✅ Online", klasse: "online" };
  if (p.status === "verpasst" || p.status === "fehler") return { text: "⏸ Verschoben — neuer Termin folgt", klasse: "pause" };
  if ((p.terminTs || 0) < jetzt) return p.weg === "hand" ? { text: "✅ Online", klasse: "online" } : { text: "⏳ Wird gerade veröffentlicht", klasse: "geplant" };
  return { text: "📅 Geplant · geht automatisch online", klasse: "geplant" };
}

function terminText(p, lang) {
  const d = p.terminTs ? new Date(p.terminTs) : null;
  if (!d || isNaN(d)) return p.termin || "Termin folgt";
  const uhr = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const datum = d.toLocaleDateString("de-DE", lang ? { weekday: "long", day: "numeric", month: "long" } : { day: "2-digit", month: "2-digit" });
  return lang ? `${datum} um ${uhr} Uhr` : `${WT[d.getDay()]}, ${datum} · ${uhr}`;
}

// Caption wie in Instagram: Zeilenumbrüche erhalten, Hashtags abgesetzt.
function captionHtml(text) {
  return escapeHtml(text)
    .replace(/(^|\s)(#[\p{L}\p{N}_]+)/gu, '$1<span class="ck-tag">$2</span>')
    .replace(/\n/g, "<br>");
}
