// Kunden-View: Immobilie / Objekt melden.
// Schreibt nach `objekte` und benachrichtigt den Admin per EmailJS.
import { objektMelden } from "../db.js";
import { sendAdminNeuesObjekt } from "../email.js";
import { OBJEKT_STATUS } from "../status.js";
import { escapeHtml } from "../util.js";
import { ocrBild } from "../docparse.js";

const OBJEKT_TYPEN = ["Wohnung", "Haus", "Gewerbe", "Grundstück"];

// Rohen OCR-Text → Formularvorschläge (Adresse / Typ / Beschreibung).
// Best-effort: alles ist danach vom Kunden editierbar.
function parseExpose(text) {
  const t = String(text || "").replace(/\r/g, "");
  const low = t.toLowerCase();

  // Adresse: Straßenzeile + PLZ/Ort zusammensetzen, wenn gefunden.
  const strasse = (t.match(/([A-ZÄÖÜ][a-zäöüßA-Za-z.\- ]*(?:stra(?:ß|ss)e|str\.|weg|platz|allee|ring|gasse|damm|ufer)\s*\d+[a-z]?)/) || [])[1];
  const plzOrt  = (t.match(/(\d{5})\s+([A-ZÄÖÜ][A-Za-zäöüß.\- ]{1,40})/) || []);
  const adresse = [strasse && strasse.trim(), plzOrt[1] ? `${plzOrt[1]} ${String(plzOrt[2]).trim()}` : ""].filter(Boolean).join(", ");

  // Objekttyp: Schlüsselwörter → einer der vier erlaubten Typen.
  let objektTyp = "";
  if (/grundst(ü|ue)ck/.test(low)) objektTyp = "Grundstück";
  else if (/(gewerbe|b(ü|ue)ro|laden|halle|praxis)/.test(low)) objektTyp = "Gewerbe";
  else if (/(haus|villa|bungalow|reihenhaus|doppelhaus|stadthaus)/.test(low)) objektTyp = "Haus";
  else if (/(wohnung|etage|apartment|appartement)/.test(low)) objektTyp = "Wohnung";

  // Eckdaten für die Beschreibung einsammeln.
  const eck = [];
  const zimmer = t.match(/(\d+(?:[.,]\d+)?)\s*Zimmer/i);      if (zimmer) eck.push(`${zimmer[1]} Zimmer`);
  const flaeche = t.match(/(\d[\d.]*)\s*(?:m²|m2|qm|quadratmeter)/i); if (flaeche) eck.push(`${flaeche[1]} m² Wohnfläche`);
  const grund = t.match(/(\d[\d.]*)\s*(?:m²|m2|qm)\s*grundst/i); if (grund) eck.push(`${grund[1]} m² Grundstück`);
  const baujahr = t.match(/Baujahr\s*:?[\s]*(\d{4})/i);        if (baujahr) eck.push(`Baujahr ${baujahr[1]}`);
  const preis = t.match(/(?:Kaufpreis|Preis)\s*:?[\s]*([\d.]+)\s*(?:€|EUR|Euro)/i) || t.match(/([\d.]{4,})\s*(?:€|EUR|Euro)/);
  if (preis) eck.push(`Kaufpreis ${preis[1]} €`);

  const rest = t.split("\n").map((s) => s.trim()).filter(Boolean).join(" ").slice(0, 600);
  const beschreibung = [eck.join(" · "), rest].filter(Boolean).join("\n\n");

  return { adresse, objektTyp, beschreibung };
}

export function renderObjektMelden(container, ctx) {
  const user = ctx.user;
  const kundeId = ctx.kundeId || null;   // eigener Mandant des Kunden

  container.innerHTML = `
    <h1 class="view-title">Objekt melden</h1>
    <p class="muted view-intro">
      Melde eine neue Immobilie für ein Video. Je mehr Eckdaten, desto besser –
      ein Foto- oder Exposé-Link (Google Drive / Dropbox) ist optional.
    </p>

    <section class="card card--pad ocr-card">
      <h2 class="section-title" style="margin:0 0 .3rem">🖼️ Exposé-Screenshot? Formular automatisch füllen</h2>
      <p class="muted" style="margin:0 0 .7rem">Lade einen Screenshot/Foto vom Exposé hoch — wir lesen Adresse, Typ und Eckdaten automatisch aus. Du kannst danach alles anpassen.</p>
      <div class="skript-drop" id="ocrDrop" tabindex="0" role="button" aria-label="Exposé-Bild ablegen oder auswählen">
        <span class="skript-drop-icon" aria-hidden="true">🖼️</span>
        <span class="skript-drop-text">Bild hierher ziehen oder <span class="skript-drop-link">auswählen</span></span>
        <span class="muted skript-drop-hint">PNG / JPG · läuft komplett offline im Browser</span>
      </div>
      <input type="file" id="ocrFile" accept="image/*" hidden />
      <div class="ocr-progress" id="ocrProgress" hidden><div class="ocr-progress-bar" id="ocrProgressBar"></div></div>
      <div class="notice notice--ok"    id="ocrOk"  hidden role="status"></div>
      <div class="notice notice--error" id="ocrErr" hidden role="alert"></div>
    </section>

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

  initOcr();

  // --- Exposé-OCR: Bild → Formular vorbefüllen ------------------------
  function initOcr() {
    const drop     = container.querySelector("#ocrDrop");
    const input    = container.querySelector("#ocrFile");
    const prog     = container.querySelector("#ocrProgress");
    const progBar  = container.querySelector("#ocrProgressBar");
    const ocrOk    = container.querySelector("#ocrOk");
    const ocrErr   = container.querySelector("#ocrErr");
    if (!drop || !input) return;

    const verarbeite = async (file) => {
      if (!file) return;
      ocrOk.hidden = true; ocrErr.hidden = true;
      if (!/^image\//.test(file.type)) { ocrErr.textContent = "Bitte ein Bild (PNG/JPG)."; ocrErr.hidden = false; return; }
      prog.hidden = false; progBar.style.width = "5%";
      drop.classList.add("is-busy");
      try {
        const text = await ocrBild(file, (p) => { progBar.style.width = Math.round(5 + p * 95) + "%"; });
        const felder = parseExpose(text);
        if (felder.adresse)      form.adresse.value = felder.adresse;
        if (felder.objektTyp)    form.objektTyp.value = felder.objektTyp;
        if (felder.beschreibung) form.beschreibung.value = felder.beschreibung;
        ocrOk.textContent = "Fertig! Bitte prüfe die ausgefüllten Felder und passe sie an.";
        ocrOk.hidden = false;
        form.adresse.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch (e) {
        console.error(e);
        ocrErr.textContent = "Text konnte nicht erkannt werden. Bitte fülle das Formular manuell aus.";
        ocrErr.hidden = false;
      } finally {
        drop.classList.remove("is-busy");
        setTimeout(() => { prog.hidden = true; progBar.style.width = "0%"; }, 600);
        input.value = "";
      }
    };

    drop.addEventListener("click", () => input.click());
    drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
    input.addEventListener("change", () => verarbeite(input.files && input.files[0]));
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("is-over"); }));
    ["dragleave", "dragend"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("is-over")));
    drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("is-over"); verarbeite(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]); });
  }

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
      await objektMelden({ adresse, objektTyp, beschreibung, link, gemeldetVon: user.email, kundeId });
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
