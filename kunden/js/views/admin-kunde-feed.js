// Admin-View: Kunden-Feed — was der AKTIVE Kunde sieht (Neuigkeiten) + was er
// gemeldet hat (Feedback). An den globalen Kunden-Umschalter gekoppelt: die
// View zeigt immer den gerade oben gewählten Kunden. Zwei Tabs. Nur Admin.
import {
  ladeKunde, beobachteBenachrichtigungenFuerKunde, loescheBenachrichtigungen,
  benachrichtigeKunde, beobachteFeedback, setzeFeedbackErledigt, loescheFeedback
} from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { escapeHtml, formatDatum } from "../util.js";

const LS_TAB = "vv_kundefeed_tab";

export function renderAdminKundeFeed(container, ctx) {
  const kundeId = ctx.kundeId || null;
  let aktiverTab = localStorage.getItem(LS_TAB) === "feedback" ? "feedback" : "news";

  if (!kundeId) {
    container.innerHTML = `
      <h1 class="view-title">Kunden-Feed</h1>
      <div class="card card--pad"><p class="muted" style="margin:0">
        Wähle oben über den Umschalter einen Kunden aus, um seine Neuigkeiten und sein Feedback zu sehen.</p></div>`;
    return;
  }

  container.innerHTML = `
    <div class="admin-head">
      <h1 class="view-title" style="margin:0">Kunden-Feed</h1>
      <span class="muted" id="kfKunde"></span>
    </div>
    <p class="muted view-intro">Genau das, was dieser Kunde in seinem Portal sieht. Neuigkeiten kannst du löschen oder selbst schreiben; Feedback kannst du als erledigt markieren.</p>
    <div class="fokus-tabs" role="tablist">
      <button class="fokus-tab" data-tab="news"     type="button" role="tab">📰 Neuigkeiten</button>
      <button class="fokus-tab" data-tab="feedback" type="button" role="tab">💬 Feedback</button>
    </div>
    <div id="kfBody"></div>`;

  const body    = container.querySelector("#kfBody");
  const kundeEl = container.querySelector("#kfKunde");
  const tabBtns = container.querySelectorAll(".fokus-tab");

  let kunde = null;
  let news = [];
  let feedback = [];
  let unsubNews = null, unsubFb = null;

  function markiereTab() {
    tabBtns.forEach((b) => b.classList.toggle("is-active", b.getAttribute("data-tab") === aktiverTab));
  }
  tabBtns.forEach((b) => b.addEventListener("click", () => {
    aktiverTab = b.getAttribute("data-tab");
    localStorage.setItem(LS_TAB, aktiverTab);
    markiereTab();
    zeichne();
  }));
  markiereTab();

  (async function init() {
    try { kunde = await ladeKunde(kundeId); } catch (_) { /* egal */ }
    kundeEl.textContent = kunde ? (kunde.name || kundeId) : kundeId;

    unsubNews = beobachteBenachrichtigungenFuerKunde(kunde || { emails: [] }, (liste) => {
      news = liste; if (aktiverTab === "news") zeichneNews();
    }, () => {});
    beiViewWechsel(unsubNews);

    unsubFb = beobachteFeedback(kundeId, (liste) => {
      feedback = liste.sort((a, b) => ((b.erstelltAm && b.erstelltAm.seconds) || 0) - ((a.erstelltAm && a.erstelltAm.seconds) || 0));
      if (aktiverTab === "feedback") zeichneFeedback();
    }, () => {});
    beiViewWechsel(unsubFb);

    zeichne();
  })();

  function zeichne() {
    if (aktiverTab === "feedback") zeichneFeedback(); else zeichneNews();
  }

  // --- Neuigkeiten (nach Gruppe dedupliziert) ------------------------
  function gruppiereNews() {
    const map = new Map();
    news.forEach((n) => {
      const key = n.gruppe || n.id;           // legacy ohne gruppe → einzeln
      let g = map.get(key);
      if (!g) { g = { key, text: n.text || "", art: n.art || "", ts: 0, ids: [] }; map.set(key, g); }
      g.ids.push(n.id);
      const ts = (n.erstelltAm && n.erstelltAm.seconds) || 0;
      if (ts > g.ts) { g.ts = ts; g.tsRoh = n.erstelltAm; }
    });
    return [...map.values()].sort((a, b) => b.ts - a.ts);
  }

  function zeichneNews() {
    const gruppen = gruppiereNews();
    body.innerHTML = `
      <section class="card card--pad" style="margin-bottom:1rem">
        <div class="field" style="margin:0 0 .6rem">
          <label for="kfNewsText">Neue Neuigkeit an den Kunden</label>
          <textarea id="kfNewsText" placeholder="z. B. Der Drehtermin wurde auf Freitag verschoben."></textarea>
        </div>
        <div class="notice notice--ok"    id="kfNewsOk"  hidden role="status"></div>
        <div class="notice notice--error" id="kfNewsErr" hidden role="alert"></div>
        <button class="btn btn--accent btn--sm" id="kfNewsSend" type="button">An Kunde senden</button>
      </section>
      ${gruppen.length
        ? `<div class="card row-list">${gruppen.map((g) => `
            <div class="pl-row" data-key="${escapeHtml(g.key)}">
              <div class="pl-main">
                <span class="row-name">${escapeHtml(g.text)}</span>
                <span class="row-sub muted">${escapeHtml(formatDatum(g.tsRoh, true))}${g.art ? " · " + escapeHtml(g.art) : ""}</span>
              </div>
              <button class="btn btn--ghost btn--sm kf-del" type="button" title="Bei allen Empfängern löschen">Löschen</button>
            </div>`).join("")}</div>`
        : `<div class="card card--pad"><p class="muted" style="margin:0">Dieser Kunde hat aktuell keine Neuigkeiten.</p></div>`}`;

    const txt  = body.querySelector("#kfNewsText");
    const okB  = body.querySelector("#kfNewsOk");
    const errB = body.querySelector("#kfNewsErr");
    const send = body.querySelector("#kfNewsSend");
    send.addEventListener("click", async () => {
      okB.hidden = true; errB.hidden = true;
      const t = txt.value.trim();
      if (!t) { errB.textContent = "Bitte einen Text eingeben."; errB.hidden = false; return; }
      send.disabled = true; send.textContent = "Wird gesendet …";
      try {
        await benachrichtigeKunde(kundeId, { text: t, art: "admin" });
        txt.value = "";
        okB.textContent = "Neuigkeit an den Kunden gesendet."; okB.hidden = false;
      } catch (e) {
        console.error(e); errB.textContent = "Senden fehlgeschlagen."; errB.hidden = false;
      } finally { send.disabled = false; send.textContent = "An Kunde senden"; }
    });

    body.querySelectorAll(".pl-row").forEach((row) => {
      const key = row.getAttribute("data-key");
      const g = gruppen.find((x) => x.key === key);
      row.querySelector(".kf-del").addEventListener("click", async () => {
        if (!confirm("Diese Neuigkeit beim Kunden entfernen?")) return;
        try { await loescheBenachrichtigungen(g.ids); }
        catch (e) { console.error(e); alert("Löschen fehlgeschlagen."); }
      });
    });
  }

  // --- Feedback ------------------------------------------------------
  function zeichneFeedback() {
    body.innerHTML = feedback.length
      ? `<div class="card row-list">${feedback.map((f) => `
          <div class="pl-row${f.erledigt ? " is-done" : ""}" data-id="${escapeHtml(f.id)}">
            <div class="pl-main">
              <span class="row-name">${escapeHtml(f.text || "")}</span>
              <span class="row-sub muted">${escapeHtml(f.seiteLabel || "")} · ${escapeHtml(String(f.gemeldetVon || "").split("@")[0])} · ${escapeHtml(formatDatum(f.erstelltAm, true))}</span>
            </div>
            <button class="btn btn--ghost btn--sm kf-done" type="button">${f.erledigt ? "Offen" : "Erledigt"}</button>
            <button class="btn btn--ghost btn--sm kf-fbdel" type="button" title="Löschen">✕</button>
          </div>`).join("")}</div>`
      : `<div class="card card--pad"><p class="muted" style="margin:0">Noch kein Feedback von diesem Kunden.</p></div>`;

    body.querySelectorAll(".pl-row").forEach((row) => {
      const id = row.getAttribute("data-id");
      const f = feedback.find((x) => x.id === id);
      row.querySelector(".kf-done").addEventListener("click", async (e) => {
        e.target.disabled = true;
        try { await setzeFeedbackErledigt(id, !f.erledigt); } catch (err) { console.error(err); e.target.disabled = false; }
      });
      row.querySelector(".kf-fbdel").addEventListener("click", async () => {
        if (!confirm("Dieses Feedback löschen?")) return;
        try { await loescheFeedback(id); } catch (err) { console.error(err); alert("Löschen fehlgeschlagen."); }
      });
    });
  }
}
