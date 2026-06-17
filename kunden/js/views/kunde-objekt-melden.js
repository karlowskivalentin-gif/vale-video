// Kunden-View: Immobilie / Objekt melden.
// Schreibt nach `objekte` und benachrichtigt den Admin per EmailJS.
import { objektMelden } from "../db.js";
import { sendAdminNeuesObjekt } from "../email.js";
import { OBJEKT_STATUS } from "../status.js";
import { escapeHtml } from "../util.js";

const OBJEKT_TYPEN = ["Wohnung", "Haus", "Gewerbe", "Grundstück"];

export function renderObjektMelden(container, ctx) {
  const user = ctx.user;

  container.innerHTML = `
    <h1 class="view-title">Objekt melden</h1>
    <p class="muted view-intro">
      Melde eine neue Immobilie für ein Video. Je mehr Eckdaten, desto besser –
      ein Foto- oder Exposé-Link (Google Drive / Dropbox) ist optional.
    </p>

    <section class="card card--pad form-card">
      <div class="notice notice--ok"   id="objOk"  hidden role="status"></div>
      <div class="notice notice--error" id="objErr" hidden role="alert"></div>

      <form id="objForm" novalidate>
        <div class="field">
          <label for="adresse">Adresse <span class="req">*</span></label>
          <input id="adresse" name="adresse" type="text" required
                 placeholder="Straße Hausnr., PLZ Ort" autocomplete="off" />
        </div>

        <div class="field">
          <label for="objektTyp">Objekttyp <span class="req">*</span></label>
          <select id="objektTyp" name="objektTyp" required>
            ${OBJEKT_TYPEN.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("")}
          </select>
        </div>

        <div class="field">
          <label for="beschreibung">Beschreibung / Eckdaten <span class="req">*</span></label>
          <textarea id="beschreibung" name="beschreibung" required
                    placeholder="Zimmer, Wohnfläche, Besonderheiten, gewünschter Fokus …"></textarea>
        </div>

        <div class="field">
          <label for="link">Link (optional)</label>
          <input id="link" name="link" type="url"
                 placeholder="https://drive.google.com/…  oder  https://www.dropbox.com/…" />
          <p class="field-hint muted">Fotos, Exposé o. Ä. – nur der Link, kein Upload.</p>
        </div>

        <button class="btn btn--accent btn--block" id="objSubmit" type="submit">
          <span class="btn-label">Objekt melden</span>
        </button>
      </form>
    </section>`;

  const form    = container.querySelector("#objForm");
  const okBox   = container.querySelector("#objOk");
  const errBox  = container.querySelector("#objErr");
  const submit  = container.querySelector("#objSubmit");
  const label   = submit.querySelector(".btn-label");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    okBox.hidden = true;
    errBox.hidden = true;

    const adresse      = form.adresse.value.trim();
    const objektTyp    = form.objektTyp.value;
    const beschreibung = form.beschreibung.value.trim();
    const link         = form.link.value.trim();

    if (!adresse || !objektTyp || !beschreibung) {
      errBox.textContent = "Bitte Adresse, Objekttyp und Beschreibung ausfüllen.";
      errBox.hidden = false;
      return;
    }

    submit.disabled = true;
    label.textContent = "Wird gemeldet …";

    try {
      await objektMelden({ adresse, objektTyp, beschreibung, link, gemeldetVon: user.email });
      // Admin-Mail fire-and-forget (blockiert die Meldung nicht).
      sendAdminNeuesObjekt({ adresse, objektTyp, beschreibung, link, gemeldetVon: user.email });

      form.reset();
      okBox.innerHTML = `Danke! Dein Objekt ist eingegangen (Status <strong>${escapeHtml(OBJEKT_STATUS.EINGEGANGEN)}</strong>).
        Du findest es ab sofort unter <a href="#/aufgaben">Aufgaben</a>.`;
      okBox.hidden = false;
      okBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (err) {
      console.error("Objekt-Meldung fehlgeschlagen:", err);
      errBox.textContent = "Speichern fehlgeschlagen. Bitte später erneut versuchen.";
      errBox.hidden = false;
    } finally {
      submit.disabled = false;
      label.textContent = "Objekt melden";
    }
  });
}
