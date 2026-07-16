// =====================================================================
// Schwebende Mini-Feedback-Box (nur Kunde). Ein Singleton an document.body,
// das über alle Seiten hinweg bestehen bleibt — frei verschiebbar (Position in
// localStorage), beliebig viele Einträge. Jeder Eintrag speichert die Seite/
// Route, auf der der Kunde war; der Admin sieht das im Kunden-Feed.
//
// mountFeedbackWidget({user,kundeId}) ist idempotent: der Router ruft es bei
// jedem Routenwechsel (Rolle Kunde) → aktualisiert nur den Seiten-Kontext.
// unmountFeedbackWidget() entfernt es (Admin/Kollaborator/Logout).
// =====================================================================
import { feedbackAnlegen, beobachteFeedback, benachrichtigeAdmin } from "./db.js";
import { escapeHtml, formatDatum } from "./util.js";

const LS_POS = "vv_feedback_pos";
const DRAG_SCHWELLE = 4;

// Route → lesbarer Seitenname (für den Admin).
const SEITEN = {
  "/aufgaben": "Aufgaben", "/objekt-melden": "Objekt melden", "/kalender": "Kalender", "/video": "Video"
};
function seiteLabelVon(hash) {
  const p = String(hash || "").replace(/^#/, "");
  if (p.startsWith("/video/")) return "Video";
  return SEITEN[p] || p || "Portal";
}

let el = null;              // Singleton-Element
let ctx = { user: null, kundeId: null };
let unsub = null;          // Firestore-Abo (nur bei kundeId-Wechsel neu)
let aboKundeId = null;
let meine = [];            // eigene Feedback-Einträge

export function mountFeedbackWidget(neu) {
  ctx.user = neu.user;
  ctx.kundeId = neu.kundeId || null;
  if (!el) bau();
  else aktualisiereListe();   // Kontext (Seite) wird beim Senden frisch gelesen

  // Abo nur (neu) aufbauen, wenn sich der Kunde geändert hat.
  if (aboKundeId !== ctx.kundeId) {
    if (unsub) { try { unsub(); } catch (_) { /* egal */ } unsub = null; }
    aboKundeId = ctx.kundeId;
    if (ctx.kundeId) {
      unsub = beobachteFeedback(ctx.kundeId, (liste) => {
        const mail = String(ctx.user && ctx.user.email || "").toLowerCase();
        meine = liste
          .filter((f) => String(f.gemeldetVon || "").toLowerCase() === mail)
          .sort((a, b) => ((b.erstelltAm && b.erstelltAm.seconds) || 0) - ((a.erstelltAm && a.erstelltAm.seconds) || 0));
        aktualisiereListe();
      }, () => {});
    }
  }
}

export function unmountFeedbackWidget() {
  if (unsub) { try { unsub(); } catch (_) { /* egal */ } unsub = null; }
  aboKundeId = null;
  if (el) { el.remove(); el = null; }
}

function bau() {
  el = document.createElement("div");
  el.className = "fb-widget";
  el.innerHTML = `
    <button class="fb-bubble" type="button" title="Feedback geben" aria-label="Feedback geben">💬</button>
    <div class="fb-panel" hidden>
      <div class="fb-panel-head">
        <span class="fb-panel-titel">Feedback</span>
        <button class="fb-close" type="button" aria-label="Schließen">✕</button>
      </div>
      <p class="fb-hint muted">Schreib uns, was dir auffällt — auf jeder Seite.</p>
      <textarea class="fb-text" placeholder="Dein Feedback …" rows="3"></textarea>
      <div class="notice notice--ok fb-ok" hidden role="status"></div>
      <div class="notice notice--error fb-err" hidden role="alert"></div>
      <button class="fb-send btn btn--accent btn--sm" type="button">Feedback senden</button>
      <div class="fb-liste"></div>
    </div>`;
  document.body.appendChild(el);

  // Position wiederherstellen.
  try {
    const pos = JSON.parse(localStorage.getItem(LS_POS) || "null");
    if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
      el.style.left = pos.left + "px";
      el.style.top  = pos.top + "px";
      el.style.right = "auto";
      el.style.bottom = "auto";
    }
  } catch (_) { /* Default: unten rechts via CSS */ }

  const bubble = el.querySelector(".fb-bubble");
  const panel  = el.querySelector(".fb-panel");
  const close  = el.querySelector(".fb-close");
  const send   = el.querySelector(".fb-send");
  const text   = el.querySelector(".fb-text");
  const okB    = el.querySelector(".fb-ok");
  const errB   = el.querySelector(".fb-err");

  // --- Drag (Bubble = Griff); Klick ohne Bewegung öffnet/schließt --------
  let drag = null;
  bubble.addEventListener("pointerdown", (e) => {
    const r = el.getBoundingClientRect();
    drag = { startX: e.clientX, startY: e.clientY, offX: e.clientX - r.left, offY: e.clientY - r.top, moved: false };
    bubble.setPointerCapture(e.pointerId);
  });
  bubble.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (Math.abs(e.clientX - drag.startX) > DRAG_SCHWELLE || Math.abs(e.clientY - drag.startY) > DRAG_SCHWELLE) drag.moved = true;
    if (!drag.moved) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = Math.min(Math.max(0, e.clientX - drag.offX), window.innerWidth - w);
    const top  = Math.min(Math.max(0, e.clientY - drag.offY), window.innerHeight - h);
    el.style.left = left + "px"; el.style.top = top + "px";
    el.style.right = "auto"; el.style.bottom = "auto";
  });
  bubble.addEventListener("pointerup", (e) => {
    if (!drag) return;
    const bewegt = drag.moved;
    if (bewegt) {
      const r = el.getBoundingClientRect();
      try { localStorage.setItem(LS_POS, JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top) })); } catch (_) { /* egal */ }
    } else {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) text.focus();
    }
    try { bubble.releasePointerCapture(e.pointerId); } catch (_) { /* egal */ }
    drag = null;
  });

  close.addEventListener("click", () => { panel.hidden = true; });

  send.addEventListener("click", async () => {
    okB.hidden = true; errB.hidden = true;
    const txt = text.value.trim();
    if (!txt) { errB.textContent = "Bitte etwas eingeben."; errB.hidden = false; text.focus(); return; }
    if (!ctx.kundeId) { errB.textContent = "Konnte dich keinem Kunden zuordnen."; errB.hidden = false; return; }
    send.disabled = true; send.textContent = "Wird gesendet …";
    const seite = location.hash || "";
    try {
      await feedbackAnlegen({
        kundeId: ctx.kundeId, gemeldetVon: ctx.user.email, text: txt,
        seite, seiteLabel: seiteLabelVon(seite)
      });
      benachrichtigeAdmin({
        von: ctx.user.email,
        text: `💡 Feedback von ${String(ctx.user.email).split("@")[0]} (${seiteLabelVon(seite)}): ${txt.length > 80 ? txt.slice(0, 79) + "…" : txt}`
      }).catch(() => {});
      text.value = "";
      okB.textContent = "Danke für dein Feedback!"; okB.hidden = false;
    } catch (e) {
      console.error(e);
      errB.textContent = "Senden fehlgeschlagen. Bitte erneut versuchen."; errB.hidden = false;
    } finally {
      send.disabled = false; send.textContent = "Feedback senden";
    }
  });

  aktualisiereListe();
}

function aktualisiereListe() {
  if (!el) return;
  const liste = el.querySelector(".fb-liste");
  if (!liste) return;
  liste.innerHTML = meine.length
    ? `<div class="fb-liste-head muted">Deine bisherigen Rückmeldungen:</div>` + meine.slice(0, 20).map((f) => `
        <div class="fb-liste-item${f.erledigt ? " is-done" : ""}">
          <div class="fb-liste-text">${escapeHtml(f.text || "")}</div>
          <div class="fb-liste-meta muted">${escapeHtml(f.seiteLabel || "")} · ${escapeHtml(formatDatum(f.erstelltAm, true))}${f.erledigt ? " · ✅ erledigt" : ""}</div>
        </div>`).join("")
    : "";
}
