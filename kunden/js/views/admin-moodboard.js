// Admin-View: Moodboard (Admin-only) — persönliche Pinnwand mit Inspirations-
// YouTube-Kanälen als Haftnotizen. Pro Notiz: Kanal + „Was gefällt mir" +
// „Was ich nachahmen möchte", wählbare Notizfarbe, leichte Schieflage.
// Kein Kanal-Embed (YouTube bietet keins) → Initial-Kachel + Link nach draußen.
// Der Kunde sieht diesen Bereich NIE (Rules: /moodboard admin-only).
import { beobachteMoodboard, moodboardNotizAnlegen, aktualisiereMoodboardNotiz,
         loescheMoodboardNotiz, MOODBOARD_FARBEN } from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { escapeHtml } from "../util.js";

const FARB_LABEL = { gelb: "Gelb", rosa: "Rosa", blau: "Blau", gruen: "Grün", orange: "Orange" };

// Stabile Schieflage pro Notiz aus der Doc-ID (−2.5° … +2.5°), damit sie
// Snapshot-Re-Renders übersteht, ohne ein Feld zu belegen.
function neigung(id) {
  let s = 0;
  for (const c of String(id || "")) s += c.charCodeAt(0);
  return ((s % 11) - 5) * 0.5;
}

export function renderAdminMoodboard(container) {
  let notizen = [];
  let formOffen = false;
  const editOffen = new Set();   // Notizen im Bearbeiten-Modus (überleben Re-Render)

  container.innerHTML = `
    <div class="admin-head">
      <h1 class="view-title" style="margin:0">Moodboard</h1>
      <button class="btn btn--accent btn--sm" id="mbNeu" type="button">📌 Notiz anpinnen</button>
    </div>
    <p class="muted view-intro">Deine Pinnwand mit YouTube-Kanälen, die dich inspirieren — plus was dir an
      ihnen gefällt und was du dir abschauen willst. Unabhängig von allen Kunden, nur du siehst das.</p>
    <div class="card card--pad mb-form" id="mbForm" hidden></div>
    <div class="mb-board" id="mbBoard"><p class="muted">Lädt …</p></div>`;

  const board = container.querySelector("#mbBoard");
  const formBox = container.querySelector("#mbForm");

  // --- Formular-Bausteine (geteilt zwischen Anlegen und Inline-Edit) -------
  function farbChips(aktiv) {
    return `<div class="mb-farb-chips" role="radiogroup" aria-label="Notizfarbe">
      ${MOODBOARD_FARBEN.map((f) => `<button type="button"
        class="mb-farb-chip mb-farb-chip--${f}${f === aktiv ? " is-active" : ""}"
        data-farbe="${f}" title="${FARB_LABEL[f]}" aria-label="${FARB_LABEL[f]}"></button>`).join("")}
    </div>`;
  }

  function formFelder(n) {
    return `
      <div class="grid-2">
        <div class="field">
          <label>Kanal-Name <span class="req">*</span></label>
          <input type="text" class="mb-f-name" value="${escapeHtml(n.kanalName || "")}" placeholder="z. B. Colin and Samir" />
        </div>
        <div class="field">
          <label>Kanal-Link <span class="req">*</span></label>
          <input type="url" class="mb-f-url" value="${escapeHtml(n.kanalUrl || "")}" placeholder="youtube.com/@kanal" />
        </div>
      </div>
      <div class="field">
        <label>💛 Was gefällt mir <span class="req">*</span></label>
        <textarea class="mb-f-gefaellt" placeholder="Was macht diesen Kanal für dich besonders?" style="min-height:60px">${escapeHtml(n.gefaelltMir || "")}</textarea>
      </div>
      <div class="field">
        <label>🎯 Was ich nachahmen möchte <span class="req">*</span></label>
        <textarea class="mb-f-nachahmen" placeholder="Was willst du dir konkret abschauen?" style="min-height:60px">${escapeHtml(n.nachahmen || "")}</textarea>
      </div>
      <div class="field">
        <label>Notizfarbe</label>
        ${farbChips(n.farbe || "gelb")}
      </div>`;
  }

  // Farb-Chips in einem Formular-Kontext verdrahten; liefert die Auswahl.
  function verdrahteChips(scope) {
    scope.querySelectorAll(".mb-farb-chip").forEach((c) => c.addEventListener("click", () => {
      scope.querySelectorAll(".mb-farb-chip").forEach((x) => x.classList.toggle("is-active", x === c));
    }));
  }

  function liesFelder(scope) {
    const name = scope.querySelector(".mb-f-name").value.trim();
    let url = scope.querySelector(".mb-f-url").value.trim();
    if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
    const aktiverChip = scope.querySelector(".mb-farb-chip.is-active");
    return {
      kanalName:   name,
      kanalUrl:    url,
      gefaelltMir: scope.querySelector(".mb-f-gefaellt").value.trim(),
      nachahmen:   scope.querySelector(".mb-f-nachahmen").value.trim(),
      farbe:       (aktiverChip && aktiverChip.getAttribute("data-farbe")) || "gelb"
    };
  }

  // --- Neue Notiz (aufklappbares Formular) ---------------------------------
  container.querySelector("#mbNeu").addEventListener("click", () => {
    formOffen = !formOffen;
    formBox.hidden = !formOffen;
    if (!formOffen) { formBox.innerHTML = ""; return; }
    formBox.innerHTML = `
      <form id="mbAnlegen" novalidate>
        ${formFelder({})}
        <div class="action-btns">
          <button class="btn btn--accent btn--sm" type="submit">Anpinnen</button>
          <button class="btn btn--ghost btn--sm" id="mb-abbr" type="button">Abbrechen</button>
        </div>
      </form>`;
    verdrahteChips(formBox);
    formBox.querySelector("#mb-abbr").addEventListener("click", () => { formOffen = false; formBox.hidden = true; formBox.innerHTML = ""; });
    formBox.querySelector("#mbAnlegen").addEventListener("submit", async (e) => {
      e.preventDefault();
      const daten = liesFelder(formBox);
      if (!daten.kanalName || !daten.kanalUrl) return;
      try {
        await moodboardNotizAnlegen(daten);
        formOffen = false; formBox.hidden = true; formBox.innerHTML = "";
      } catch (err) { console.warn("Moodboard-Notiz anlegen fehlgeschlagen:", err); alert("Konnte nicht speichern."); }
    });
  });

  // --- Notiz-Rendering ------------------------------------------------------
  function notizHtml(n) {
    const farbe = MOODBOARD_FARBEN.includes(n.farbe) ? n.farbe : "gelb";
    const initiale = (n.kanalName || "?").trim().charAt(0).toUpperCase() || "?";
    const urlKurz = String(n.kanalUrl || "").replace(/^https?:\/\/(www\.)?/, "");

    if (editOffen.has(n.id)) {
      return `
        <section class="mb-note mb-note--${farbe} is-edit" data-id="${escapeHtml(n.id)}" style="--neigung:0deg">
          <form class="mb-edit-form" novalidate>
            ${formFelder(n)}
            <div class="action-btns">
              <button class="btn btn--accent btn--sm" type="submit">Speichern</button>
              <button class="btn btn--ghost btn--sm mb-edit-abbr" type="button">Abbrechen</button>
            </div>
          </form>
        </section>`;
    }

    return `
      <section class="mb-note mb-note--${farbe}" data-id="${escapeHtml(n.id)}" style="--neigung:${neigung(n.id)}deg">
        <div class="mb-note-kopf">
          <span class="mb-avatar">${escapeHtml(initiale)}</span>
          <div class="mb-note-titel">
            <strong>${escapeHtml(n.kanalName || "Ohne Name")}</strong>
            <a class="mb-note-link muted" href="${escapeHtml(n.kanalUrl || "#")}" target="_blank" rel="noopener"
               title="Kanal öffnen">${escapeHtml(urlKurz || "Kanal")} ↗</a>
          </div>
        </div>
        <div class="mb-note-abschnitt">
          <div class="mb-note-label">💛 Was gefällt mir</div>
          <p class="mb-note-text">${escapeHtml(n.gefaelltMir || "—")}</p>
        </div>
        <div class="mb-note-abschnitt">
          <div class="mb-note-label">🎯 Nachahmen</div>
          <p class="mb-note-text">${escapeHtml(n.nachahmen || "—")}</p>
        </div>
        <div class="mb-note-foot">
          <button class="btn btn--ghost btn--sm mb-edit" type="button">Bearbeiten</button>
          <button class="gd-del mb-del" type="button" title="Notiz abpinnen">✕</button>
        </div>
      </section>`;
  }

  function zeichne() {
    if (!notizen.length) {
      board.innerHTML = `<div class="card card--pad empty-card" style="grid-column:1/-1">
        <div class="empty-emoji">📌</div>
        <p class="empty-title">Noch keine Notizen angepinnt</p>
        <p class="muted">Pinn oben mit „📌 Notiz anpinnen" deinen ersten Inspirations-Kanal an.</p>
      </div>`;
      return;
    }
    board.innerHTML = notizen.map(notizHtml).join("");

    board.querySelectorAll(".mb-note").forEach((note) => {
      const id = note.getAttribute("data-id");
      const n = notizen.find((x) => x.id === id);
      if (!n) return;

      // Inline-Edit öffnen / abbrechen / speichern
      const editBtn = note.querySelector(".mb-edit");
      if (editBtn) editBtn.addEventListener("click", () => { editOffen.add(id); zeichne(); });

      const editForm = note.querySelector(".mb-edit-form");
      if (editForm) {
        verdrahteChips(editForm);
        editForm.querySelector(".mb-edit-abbr").addEventListener("click", () => { editOffen.delete(id); zeichne(); });
        editForm.addEventListener("submit", async (e) => {
          e.preventDefault();
          const daten = liesFelder(editForm);
          if (!daten.kanalName || !daten.kanalUrl) return;
          try { await aktualisiereMoodboardNotiz(id, daten); editOffen.delete(id); }
          catch (err) { console.warn("Moodboard-Notiz speichern fehlgeschlagen:", err); alert("Konnte nicht speichern."); }
        });
      }

      // Löschen mit 2-Klick-Bestätigung (Muster Pipeline/Inspiration)
      const del = note.querySelector(".mb-del");
      if (del) del.addEventListener("click", async () => {
        if (!del.classList.contains("is-bestaetigen")) {
          del.classList.add("is-bestaetigen"); del.textContent = "Löschen?";
          setTimeout(() => { if (del.isConnected) { del.classList.remove("is-bestaetigen"); del.textContent = "✕"; } }, 4000);
          return;
        }
        try { await loescheMoodboardNotiz(id); } catch (e) { console.warn(e); }
      });
    });
  }

  const unsub = beobachteMoodboard(
    (liste) => {
      notizen = liste;
      // Laufende Eingaben im Inline-Editor nicht durch Re-Render zerstören.
      if (board.contains(document.activeElement) && document.activeElement.closest(".mb-edit-form")) return;
      zeichne();
    },
    (err) => {
      console.warn("Moodboard laden fehlgeschlagen:", err);
      board.innerHTML = `<div class="card card--pad" style="grid-column:1/-1"><p class="notice notice--error" style="margin:0">
        Konnte nicht laden — sind die Firestore-Rules für „moodboard" veröffentlicht?</p></div>`;
    }
  );
  beiViewWechsel(unsub);
}
