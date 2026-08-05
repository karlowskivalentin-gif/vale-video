// Admin-View: Objekte (bei Gastro-Kunden: Filialen).
//   - Status setzen (Eingegangen | In Produktion | Erledigt)
//   - „Video aus Objekt anlegen" → Prefill im Edit-Formular (sessionStorage)
//   - Selbst anlegen: gleiche Collection wie die Kunden-Meldung, aber ohne
//     Admin-Mail (der Admin meldet an sich selbst) und ohne Exposé-OCR.
import { beobachteObjekte, objektMelden, setzeObjektStatus, loescheObjekt } from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { OBJEKT_STATUS, OBJEKT_STATUS_LISTE, objektTypenFuer } from "../status.js";
import { escapeHtml, formatDatum } from "../util.js";

export function renderAdminObjekte(container, opts = {}) {
  const kundeId = opts.kundeId || null;
  const user = opts.user || null;
  const istGastro = opts.kundenart === "gastro";
  const wortEinheit = istGastro ? "Filiale" : "Objekt";
  const typen = objektTypenFuer(opts.kundenart);

  container.innerHTML = `
    <div class="admin-head">
      <h1 class="view-title" style="margin:0">${istGastro ? "Filialen" : "Gemeldete Objekte"}</h1>
      <button class="btn btn--accent btn--sm" id="obNeu" type="button">+ ${wortEinheit} anlegen</button>
    </div>
    <p class="muted view-intro">${istGastro
      ? "Standorte des Kunden. Status setzen oder direkt ein Video anlegen."
      : "Vom Kunden gemeldete Immobilien. Status setzen oder direkt ein Video anlegen."}</p>

    <div id="obFormWrap" hidden>
      <section class="card card--pad form-card">
        <h2 class="section-title" style="margin:0 0 .7rem">${wortEinheit} anlegen</h2>
        <div class="notice notice--ok"    id="obFormOk"  hidden role="status"></div>
        <div class="notice notice--error" id="obFormErr" hidden role="alert"></div>
        <form id="obForm" novalidate>
          <div class="field">
            <label for="obAdresse">Adresse <span class="req">*</span></label>
            <input id="obAdresse" type="text" placeholder="Straße Hausnr., PLZ Ort" autocomplete="off" />
          </div>
          <div class="field">
            <label for="obTyp">${istGastro ? "Art der Filiale" : "Objekttyp"} <span class="req">*</span></label>
            <select id="obTyp">
              ${typen.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label for="obBeschreibung">Beschreibung / Eckdaten</label>
            <textarea id="obBeschreibung" placeholder="${istGastro
              ? "Ambiente, Besonderheiten, beste Drehzeiten …"
              : "Zimmer, Wohnfläche, Besonderheiten, gewünschter Fokus …"}"></textarea>
          </div>
          <div class="field">
            <label for="obLink">Link (optional)</label>
            <input id="obLink" type="url" placeholder="https://drive.google.com/… oder https://www.dropbox.com/…" />
          </div>
          <div class="action-btns">
            <button class="btn btn--accent btn--sm" id="obSave" type="submit">Anlegen</button>
            <button class="btn btn--ghost btn--sm" id="obCancel" type="button">Abbrechen</button>
          </div>
        </form>
      </section>
    </div>

    <div id="obList"><div class="card card--pad"><p class="muted">Wird geladen …</p></div></div>`;

  const obList = container.querySelector("#obList");
  wireAnlegen(container, { kundeId, user, wortEinheit });

  const unsub = beobachteObjekte(
    (objekte) => zeichne(obList, objekte, istGastro),
    (err) => {
      console.error(err);
      obList.innerHTML = `<div class="card card--pad"><p class="notice notice--error" style="margin:0">
        Konnte nicht laden. Ist die Firestore-Datenbank eingerichtet?</p></div>`;
    },
    kundeId
  );
  beiViewWechsel(unsub);
}

// Anlege-Formular (Admin): schreibt in `objekte` unter dem aktiven Kunden.
// gemeldetVon = Admin-E-Mail (Rules verlangen die eigene Adresse beim Create).
function wireAnlegen(container, { kundeId, user, wortEinheit }) {
  const wrap   = container.querySelector("#obFormWrap");
  const form   = container.querySelector("#obForm");
  const okB    = container.querySelector("#obFormOk");
  const errB   = container.querySelector("#obFormErr");
  const save   = container.querySelector("#obSave");

  container.querySelector("#obNeu").addEventListener("click", () => {
    wrap.hidden = !wrap.hidden;
    if (!wrap.hidden) container.querySelector("#obAdresse").focus();
  });
  container.querySelector("#obCancel").addEventListener("click", () => {
    wrap.hidden = true; form.reset(); okB.hidden = true; errB.hidden = true;
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    okB.hidden = true; errB.hidden = true;
    const adresse = container.querySelector("#obAdresse").value.trim();
    if (!adresse) { errB.textContent = "Bitte eine Adresse angeben."; errB.hidden = false; return; }
    if (!kundeId) { errB.textContent = "Kein aktiver Kunde gewählt."; errB.hidden = false; return; }
    save.disabled = true;
    try {
      await objektMelden({
        adresse,
        objektTyp:    container.querySelector("#obTyp").value,
        beschreibung: container.querySelector("#obBeschreibung").value.trim(),
        link:         container.querySelector("#obLink").value.trim(),
        gemeldetVon:  user && user.email,
        kundeId
      });
      form.reset();
      okB.textContent = `${wortEinheit} angelegt.`;
      okB.hidden = false;
    } catch (ex) {
      console.error(ex);
      errB.textContent = "Anlegen fehlgeschlagen. Bitte erneut versuchen.";
      errB.hidden = false;
    } finally {
      save.disabled = false;
    }
  });
}

function zeichne(el, objekte, istGastro) {
  if (!objekte.length) {
    el.innerHTML = `<div class="card card--pad empty-card">
      <div class="empty-emoji">${istGastro ? "📍" : "🏠"}</div>
      <p class="empty-title">${istGastro ? "Noch keine Filialen gemeldet" : "Noch keine Objekte gemeldet"}</p>
      <p class="muted">${istGastro ? "Sobald der Kunde eine Filiale meldet, erscheint sie hier." : "Sobald der Kunde ein Objekt meldet, erscheint es hier."}</p>
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
            <h2 class="ob-card-adresse">${istGastro ? "📍" : "🏠"} ${escapeHtml(o.adresse || "Ohne Adresse")}</h2>
            <select class="ob-status field-inline" aria-label="Status">${opts}</select>
          </div>
          <div class="ob-felder">
            <div class="ob-feld">
              <span class="ob-feld-label">${istGastro ? "Art der Filiale" : "Objekttyp"}</span>
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
