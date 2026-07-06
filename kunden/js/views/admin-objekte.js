// Admin-View: Objekte. Alle vom Kunden gemeldeten Immobilien.
//   - Status setzen (Eingegangen | In Produktion | Erledigt)
//   - „Video aus Objekt anlegen" → Prefill im Edit-Formular (sessionStorage)
import { beobachteObjekte, setzeObjektStatus, loescheObjekt } from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { OBJEKT_STATUS, OBJEKT_STATUS_LISTE } from "../status.js";
import { escapeHtml, formatDatum } from "../util.js";

export function renderAdminObjekte(container) {
  container.innerHTML = `
    <div class="admin-head">
      <h1 class="view-title" style="margin:0">Gemeldete Objekte</h1>
    </div>
    <p class="muted view-intro">Vom Kunden gemeldete Immobilien. Status setzen oder direkt ein Video anlegen.</p>
    <div id="obList"><div class="card card--pad"><p class="muted">Wird geladen …</p></div></div>`;

  const obList = container.querySelector("#obList");

  const unsub = beobachteObjekte(
    (objekte) => zeichne(obList, objekte),
    (err) => {
      console.error(err);
      obList.innerHTML = `<div class="card card--pad"><p class="notice notice--error" style="margin:0">
        Konnte nicht laden. Ist die Firestore-Datenbank eingerichtet?</p></div>`;
    }
  );
  beiViewWechsel(unsub);
}

function zeichne(el, objekte) {
  if (!objekte.length) {
    el.innerHTML = `<div class="card card--pad empty-card">
      <div class="empty-emoji">🏠</div>
      <p class="empty-title">Noch keine Objekte gemeldet</p>
      <p class="muted">Sobald der Kunde ein Objekt meldet, erscheint es hier.</p>
    </div>`;
    return;
  }

  // Eine Karte pro Objekt — gleiche Feld-Optik wie das Melde-Formular des
  // Kunden (Adresse, Objekttyp, Beschreibung, Link), nur read-only.
  el.innerHTML = `<div class="ob-karten">
    ${objekte.map((o) => {
      const opts = OBJEKT_STATUS_LISTE
        .map((s) => `<option value="${escapeHtml(s)}"${s === o.status ? " selected" : ""}>${escapeHtml(s)}</option>`)
        .join("");
      return `
        <section class="card card--pad ob-card ob-row" data-id="${escapeHtml(o.id)}">
          <div class="ob-card-kopf">
            <h2 class="ob-card-adresse">🏠 ${escapeHtml(o.adresse || "Ohne Adresse")}</h2>
            <select class="ob-status field-inline" aria-label="Status">${opts}</select>
          </div>
          <div class="ob-felder">
            <div class="ob-feld">
              <span class="ob-feld-label">Objekttyp</span>
              <span class="ob-feld-wert">${escapeHtml(o.objektTyp || "—")}</span>
            </div>
            <div class="ob-feld">
              <span class="ob-feld-label">Gemeldet von</span>
              <span class="ob-feld-wert">${escapeHtml(kurz(o.gemeldetVon))}</span>
            </div>
            <div class="ob-feld">
              <span class="ob-feld-label">Eingegangen am</span>
              <span class="ob-feld-wert">${o.erstelltAm ? escapeHtml(formatDatum(o.erstelltAm)) : "—"}</span>
            </div>
            <div class="ob-feld ob-feld--voll">
              <span class="ob-feld-label">Beschreibung / Eckdaten</span>
              <div class="ob-feld-wert ob-feld-wert--text">${escapeHtml(o.beschreibung || "—")}</div>
            </div>
            <div class="ob-feld ob-feld--voll">
              <span class="ob-feld-label">Material-Link</span>
              ${o.link
                ? `<a class="ob-feld-wert ob-feld-link" href="${escapeHtml(o.link)}" target="_blank" rel="noopener">${escapeHtml(o.link)} ↗</a>`
                : `<span class="ob-feld-wert muted">— kein Link —</span>`}
            </div>
          </div>
          <div class="ob-card-fuss action-btns">
            <button class="btn btn--accent btn--sm ob-video" type="button">+ Video anlegen</button>
            <button class="btn btn--ghost btn--sm ob-del" type="button" aria-label="Löschen">Löschen</button>
          </div>
        </section>`;
    }).join("")}
  </div>`;

  el.querySelectorAll(".ob-row").forEach((row) => {
    const id = row.getAttribute("data-id");
    const obj = objekte.find((x) => x.id === id);
    const sel = row.querySelector(".ob-status");
    const btnVideo = row.querySelector(".ob-video");
    const btnDel = row.querySelector(".ob-del");

    sel.addEventListener("change", async () => {
      sel.disabled = true;
      try {
        await setzeObjektStatus(id, sel.value);
      } catch (e) {
        console.error(e);
        alert("Status konnte nicht gespeichert werden.");
      } finally {
        sel.disabled = false;
      }
    });

    btnVideo.addEventListener("click", () => {
      // Prefill für das Edit-Formular hinterlegen, dann zum Anlegen springen.
      sessionStorage.setItem("neuesVideoObjekt", id);
      location.hash = "/admin/video/neu";
    });

    btnDel.addEventListener("click", async () => {
      if (!confirm(`Objekt „${(obj && obj.adresse) || ""}" wirklich löschen? Das kann nicht rückgängig gemacht werden.`)) return;
      btnDel.disabled = true;
      try {
        await loescheObjekt(id);
      } catch (e) {
        console.error(e);
        alert("Löschen fehlgeschlagen.");
        btnDel.disabled = false;
      }
    });
  });
}

function kurz(email) {
  return String(email || "").split("@")[0] || "Kunde";
}
