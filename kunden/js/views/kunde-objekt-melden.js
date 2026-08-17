// Kunden-View: Immobilie / Objekt melden — bei Gastro-Kunden: Filiale melden.
// Schreibt nach `objekte` und benachrichtigt den Admin per EmailJS. Dieselbe
// Collection/Mechanik für beide Kundenarten, nur Typen/Wording unterscheiden
// sich.
//
// ZWEI WEGE (nur Immobilien — bei Gastro gibt es kein Exposé):
//   1. Exposé hochladen (Standard): der Kunde legt die Originaldatei ab
//      (PDF/Word/Foto). Sie wandert in den Firebase Storage, im Objekt steht
//      der Verweis. Adresse/Typ/Eckdaten werden aus der Datei vorgeschlagen —
//      bei PDF/Word aus dem echten Text, bei Fotos per OCR. Kein Abtippen.
//   2. Formular ausfüllen: der bisherige Weg, unverändert, für alle Fälle
//      ohne Exposé.
// Die frühere „Exposé-Screenshot → Formular füllen"-Karte ist entfallen; Weg 1
// kann dasselbe und hebt zusätzlich die Originaldatei auf.
import { objektMelden } from "../db.js";
import { sendAdminNeuesObjekt } from "../email.js";
import { OBJEKT_STATUS, objektTypenFuer } from "../status.js";
import { escapeHtml, monatKey, monatsLabel, monatPlus } from "../util.js";
import { extrahiereText } from "../docparse.js";
import { speichereDatei, MAX_DATEI_GROSS, EXPOSE_TYPEN } from "../dateien.js";


// Rohen Exposé-Text → Feldvorschläge (Adresse / Typ / Eckdaten).
// Best-effort: alles ist danach vom Kunden editierbar. Getestet gegen echte
// Deussen-Exposés, die zwei Eigenheiten haben, an denen naive Muster scheitern:
//   - Angaben stehen als „Label Wert" ("Zimmer 2", "Wohnfläche ca. 54,70 m²"),
//     nicht als "2 Zimmer".
//   - „Hausgeld/Monat" steckt in jedem Wohnungs-Exposé — ein ungebundenes
//     Muster auf „haus" macht daraus fälschlich ein Haus.

/**
 * Adresse aus dem Exposé-Kopf. Anker ist die PLZ, davor steht die Straße —
 * das gilt in beiden Textformen, die hier ankommen:
 *   pdf.js  → EINE Zeile pro Seite: "… 267762 Birkenhof 7 40225 Düsseldorf …"
 *   Word    → eigene Zeilen:        "Birkenhof 7" / "40225 Düsseldorf"
 * Deshalb wird auf einen Fluss normalisiert statt auf Zeilen gebaut.
 *
 * Zwei Fallen, beide am echten Deussen-Exposé aufgelaufen:
 *  - Direkt vor der PLZ steht die Objektnummer („267762 Birkenhof 7 40225 …").
 *    Ein simples \d{5} schneidet daraus „67762" heraus → die Grenze prüft
 *    deshalb, dass links und rechts keine weitere Ziffer steht. Ohne Lookbehind
 *    geschrieben, das kennen ältere Safari-Versionen nicht.
 *  - Auf den Ort folgt „Deutschland" — der Ort ist deshalb bewusst EIN Wort.
 */
function findeAdresse(t) {
  const fluss = String(t).replace(/\s+/g, " ");
  const m = fluss.match(/(^|[^\d])(\d{5})(?!\d)\s+([A-ZÄÖÜ][A-Za-zäöüß.\-]+)/);
  if (!m) return "";
  const plzOrt = `${m[2]} ${m[3]}`;

  // Was unmittelbar vor der PLZ steht, endet üblicherweise auf „Straße Hausnr".
  const davor = fluss.slice(0, m.index + m[1].length).trim();
  const strasse = (davor.match(/([A-ZÄÖÜ][A-Za-zäöüß.\-]+(?:\s[A-ZÄÖÜ][A-Za-zäöüß.\-]+)?\s\d+\s*[a-z]?)$/) || [])[1];
  return [strasse && strasse.trim(), plzOrt].filter(Boolean).join(", ");
}

function findeTyp(t) {
  // 1. Die explizite Kategorie-Zeile ist die verlässlichste Quelle.
  const kat = t.match(/Kategorie\s+[^\n]*?(Wohnung|Haus|Grundst(?:ü|ue)ck|Gewerbe)/i);
  if (kat) {
    const gefunden = kat[1].toLowerCase();
    if (gefunden.startsWith("grundst")) return "Grundstück";
    return gefunden.charAt(0).toUpperCase() + gefunden.slice(1);
  }
  // 2. Schlüsselwörter — mit Wortgrenzen, damit „Hausgeld" kein Haus ergibt.
  const low = t.toLowerCase();
  if (/\bgrundst(ü|ue)ck\b/.test(low))                                   return "Grundstück";
  if (/\b(gewerbe|b(ü|ue)ro|ladenfl(ä|ae)che|halle|praxis)\b/.test(low)) return "Gewerbe";
  if (/\b(wohnung|eigentumswohnung|apartment|appartement)\b/.test(low)
      || /\d\s*-?\s*zimmer\s*-?\s*wohnung/.test(low))                    return "Wohnung";
  if (/\b(haus|villa|bungalow|reihenhaus|doppelhaus|stadthaus|einfamilienhaus)\b/.test(low)) return "Haus";
  return "";
}

// Zahl mit deutschem Dezimalkomma / Tausenderpunkt, in beiden Schreibrichtungen:
// „Zimmer 2" wie „2 Zimmer". Zwischen Label und Zahl darf Fülltext stehen
// („Wohnfläche ca.   54,70"), aber nur wenig — sonst greift man den Nachbarwert.
const FLAECHE = "m\\s*[²2]|qm|quadratmeter";   // pdf.js schreibt „m ²" mit Leerzeichen!

function findeWert(t, label, einheit) {
  const e = einheit ? `\\s*(?:${einheit})` : "";
  const nachLabel = t.match(new RegExp(`${label}[^\\d]{0,20}(\\d[\\d.,]*)${e}`, "i"));
  if (nachLabel) return nachLabel[1].replace(/[.,]$/, "");
  const vorLabel = t.match(new RegExp(`(\\d[\\d.,]*)${e}\\s*${label}`, "i"));
  return vorLabel ? vorLabel[1].replace(/[.,]$/, "") : "";
}

function parseExpose(text) {
  const t = String(text || "").replace(/\r/g, "");

  const adresse   = findeAdresse(t);
  const objektTyp = findeTyp(t);

  // Eckdaten für die Beschreibung einsammeln.
  const eck = [];
  // \b vor „Zimmer", damit „Anzahl Schlafzimmer 1" nicht die Zimmerzahl kapert.
  const zimmer  = findeWert(t, "\\bZimmer", "");
  const wohnfl  = findeWert(t, "Wohnfl(?:ä|ae)che", FLAECHE);
  const grundfl = findeWert(t, "Grundst(?:ü|ue)cksfl(?:ä|ae)che", FLAECHE);
  const baujahr = (t.match(/Baujahr\s*:?\s*(?:ca\.?\s*)?(\d{4})/i) || [])[1];
  const preis   = (t.match(/(?:Kaufpreis|Preis)\s*:?\s*([\d.,]+)\s*(?:€|EUR|Euro)/i)
                || t.match(/([\d.]{4,})\s*(?:€|EUR|Euro)/) || [])[1];
  // Gezielt statt „die nächsten 15 Zeichen" — sonst landet der Nachbarwert mit
  // in der Angabe („Etage 1. OG Anzahl Sc").
  const etage   = (t.match(/Etage\s*:?\s*(\d{1,2}\.?\s*(?:OG|UG|Stock|Etage)|EG|Erdgeschoss|Dachgeschoss|Souterrain)/i) || [])[1];

  if (zimmer)  eck.push(`${zimmer} Zimmer`);
  if (wohnfl)  eck.push(`${wohnfl} m² Wohnfläche`);
  if (grundfl) eck.push(`${grundfl} m² Grundstück`);
  if (etage)   eck.push(`Etage ${etage.replace(/\s+/g, " ").trim()}`);
  if (baujahr) eck.push(`Baujahr ${baujahr}`);
  if (preis)   eck.push(`Kaufpreis ${preis} €`);

  // Beim Exposé-Weg liegt die Originaldatei bei — dann reichen die Eckdaten.
  // Nur wenn gar nichts erkannt wurde, wird ein Textauszug angehängt.
  const rest = t.split("\n").map((s) => s.trim()).filter(Boolean).join(" ").slice(0, 400);
  const beschreibung = eck.length ? eck.join(" · ") : rest;

  return { adresse, objektTyp, beschreibung, textLaenge: t.trim().length };
}

function dateiGroesse(bytes) {
  const kb = (bytes || 0) / 1024;
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
}

export function renderObjektMelden(container, ctx) {
  const user = ctx.user;
  const kundeId = ctx.kundeId || null;   // eigener Mandant des Kunden
  const istGastro = ctx.kundenart === "gastro";

  const wortEinheit = istGastro ? "Filiale" : "Objekt";
  const typen = objektTypenFuer(ctx.kundenart);

  // Produktionsmonat: was diesen Monat gemeldet wird, produzieren wir im
  // Folgemonat. Denselben Default setzt objektMelden() in db.js.
  const produktionsMonat = monatPlus(monatKey(new Date()), 1);
  const produktionsLabel = monatsLabel(produktionsMonat);

  const typOptionen = (gewaehlt) => typen
    .map((t) => `<option value="${escapeHtml(t)}"${t === gewaehlt ? " selected" : ""}>${escapeHtml(t)}</option>`)
    .join("");

  container.innerHTML = `
    <h1 class="view-title">${wortEinheit} melden</h1>
    <p class="muted view-intro">
      ${istGastro
        ? "Melde eine Filiale / einen Standort — dann können wir dort Drehs planen. Je mehr Infos zu Ambiente und Besonderheiten, desto besser."
        : "Melde eine neue Immobilie für ein Video. Am schnellsten geht es mit dem Exposé — lad es einfach hoch, wir lesen die Eckdaten selbst heraus."}
    </p>
    <p class="notice objekt-monat-hinweis">
      📅 Was du jetzt meldest, produzieren wir im <strong>${escapeHtml(produktionsLabel)}</strong>.
    </p>

    <div class="notice notice--ok"    id="objOk"  hidden role="status"></div>
    <div class="notice notice--error" id="objErr" hidden role="alert"></div>

    ${istGastro ? "" : `
    <div class="melde-wege" role="tablist" aria-label="Wie möchtest du melden?">
      <button class="melde-weg is-aktiv" id="wegExpose" type="button" role="tab" aria-selected="true">
        📄 Exposé hochladen
      </button>
      <button class="melde-weg" id="wegFormular" type="button" role="tab" aria-selected="false">
        ✍️ Ohne Exposé — Formular
      </button>
    </div>

    <section class="card card--pad expose-card" id="exposeWeg">
      <div id="exposeStart">
        <h2 class="section-title" style="margin:0 0 .3rem">Exposé ablegen — fertig</h2>
        <p class="muted" style="margin:0 0 .7rem">
          PDF, Word oder Foto. Die Datei bleibt als Original beim Objekt, und wir schlagen dir
          Adresse, Typ und Eckdaten daraus vor. Max. ${MAX_DATEI_GROSS / 1024 / 1024} MB.
        </p>
        <div class="skript-drop" id="expDrop" tabindex="0" role="button" aria-label="Exposé ablegen oder auswählen">
          <span class="skript-drop-icon" aria-hidden="true">📄</span>
          <span class="skript-drop-text">Exposé hierher ziehen oder <span class="skript-drop-link">auswählen</span></span>
          <span class="muted skript-drop-hint">PDF · Word · JPG / PNG</span>
        </div>
        <input type="file" id="expFile" accept="${EXPOSE_TYPEN}" hidden />
      </div>

      <div id="expBusy" hidden>
        <p class="muted" style="margin:0 0 .5rem" id="expBusyText">Exposé wird gelesen …</p>
        <div class="ocr-progress"><div class="ocr-progress-bar" id="expProgressBar"></div></div>
      </div>

      <div id="expErgebnis" hidden>
        <div class="expose-datei">
          <span class="expose-datei-icon" aria-hidden="true">📎</span>
          <span class="expose-datei-name" id="expName"></span>
          <span class="expose-datei-groesse muted" id="expGroesse"></span>
          <button class="btn btn--ghost btn--sm" id="expEntfernen" type="button">Andere Datei</button>
        </div>

        <p class="muted" id="expHinweis" style="margin:.7rem 0 .4rem"></p>

        <div class="field">
          <label for="expAdresse">Adresse</label>
          <input id="expAdresse" type="text" placeholder="Straße Hausnr., PLZ Ort" autocomplete="off" />
          <p class="field-hint muted">Nicht erkannt? Kein Problem — wir ergänzen sie aus dem Exposé.</p>
        </div>
        <div class="field">
          <label for="expTyp">Objekttyp</label>
          <select id="expTyp">${typOptionen("")}</select>
        </div>
        <div class="field">
          <label for="expBeschreibung">Eckdaten / Anmerkung</label>
          <textarea id="expBeschreibung" placeholder="Was soll im Video besonders herauskommen?"></textarea>
        </div>

        <button class="btn btn--accent btn--block" id="expSubmit" type="button">
          <span class="btn-label">${wortEinheit} mit Exposé melden</span>
        </button>
      </div>
    </section>`}

    <section class="card card--pad form-card" id="formularWeg"${istGastro ? "" : " hidden"}>
      <form id="objForm" novalidate>
        <div class="field">
          <label for="adresse">Adresse <span class="req">*</span></label>
          <input id="adresse" name="adresse" type="text" required
                 placeholder="Straße Hausnr., PLZ Ort" autocomplete="off" />
        </div>

        <div class="field">
          <label for="objektTyp">${istGastro ? "Art der Filiale" : "Objekttyp"} <span class="req">*</span></label>
          <select id="objektTyp" name="objektTyp" required>
            ${typOptionen("")}
          </select>
        </div>

        <div class="field">
          <label for="beschreibung">Beschreibung / Eckdaten <span class="req">*</span></label>
          <textarea id="beschreibung" name="beschreibung" required
                    placeholder="${istGastro
                      ? "Ambiente, Besonderheiten, beste Drehzeiten, was gezeigt werden soll …"
                      : "Zimmer, Wohnfläche, Besonderheiten, gewünschter Fokus …"}"></textarea>
        </div>

        <div class="field">
          <label for="link">Link (optional)</label>
          <input id="link" name="link" type="url"
                 placeholder="https://drive.google.com/…  oder  https://www.dropbox.com/…" />
          <p class="field-hint muted">${istGastro ? "Fotos, Speisekarte o. Ä. – nur der Link, kein Upload." : "Fotos, weitere Unterlagen o. Ä. – nur der Link."}</p>
        </div>

        <button class="btn btn--accent btn--block" id="objSubmit" type="submit">
          <span class="btn-label">${wortEinheit} melden</span>
        </button>
      </form>
    </section>`;

  const form    = container.querySelector("#objForm");
  const okBox   = container.querySelector("#objOk");
  const errBox  = container.querySelector("#objErr");
  const submit  = container.querySelector("#objSubmit");
  const label   = submit.querySelector(".btn-label");

  const zeigeFehler = (text) => { errBox.textContent = text; errBox.hidden = false; okBox.hidden = true; };
  const zeigeErfolg = (html) => {
    okBox.innerHTML = html;
    okBox.hidden = false;
    errBox.hidden = true;
    okBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  const erfolgsText = () => `Danke! Deine ${istGastro ? "Filiale" : "Meldung"} ist eingegangen
    (Status <strong>${escapeHtml(OBJEKT_STATUS.EINGEGANGEN)}</strong>) und ist für die
    <strong>${escapeHtml(produktionsLabel)}</strong>-Produktion eingeplant.
    Du findest sie ab sofort unter <a href="#/aufgaben">Aufgaben</a>.`;

  if (!istGastro) initExposeWeg();

  // --- Weg 1: Exposé als Datei ----------------------------------------
  function initExposeWeg() {
    const tabExpose  = container.querySelector("#wegExpose");
    const tabFormular= container.querySelector("#wegFormular");
    const exposeWeg  = container.querySelector("#exposeWeg");
    const formularWeg= container.querySelector("#formularWeg");

    const start   = container.querySelector("#exposeStart");
    const drop    = container.querySelector("#expDrop");
    const input   = container.querySelector("#expFile");
    const busy    = container.querySelector("#expBusy");
    const busyText= container.querySelector("#expBusyText");
    const balken  = container.querySelector("#expProgressBar");
    const ergebnis= container.querySelector("#expErgebnis");
    const expName = container.querySelector("#expName");
    const expGroesse = container.querySelector("#expGroesse");
    const expHinweis = container.querySelector("#expHinweis");
    const expAdresse = container.querySelector("#expAdresse");
    const expTyp     = container.querySelector("#expTyp");
    const expBeschreibung = container.querySelector("#expBeschreibung");
    const expSubmit  = container.querySelector("#expSubmit");
    const expEntfernen = container.querySelector("#expEntfernen");

    let gewaehlteDatei = null;

    // Umschalter zwischen den beiden Wegen.
    const zeigeWeg = (welcher) => {
      const istExpose = welcher === "expose";
      tabExpose.classList.toggle("is-aktiv", istExpose);
      tabFormular.classList.toggle("is-aktiv", !istExpose);
      tabExpose.setAttribute("aria-selected", String(istExpose));
      tabFormular.setAttribute("aria-selected", String(!istExpose));
      exposeWeg.hidden = !istExpose;
      formularWeg.hidden = istExpose;
      okBox.hidden = true; errBox.hidden = true;
    };
    tabExpose.addEventListener("click", () => zeigeWeg("expose"));
    tabFormular.addEventListener("click", () => zeigeWeg("formular"));

    const zuruecksetzen = () => {
      gewaehlteDatei = null;
      input.value = "";
      ergebnis.hidden = true;
      busy.hidden = true;
      start.hidden = false;
      balken.style.width = "0%";
    };

    // Datei gewählt → Text lesen und Felder vorschlagen. Gespeichert wird sie
    // erst beim Melden (sonst hinterließe jeder Abbruch verwaiste Blöcke).
    const verarbeite = async (file) => {
      if (!file) return;
      okBox.hidden = true; errBox.hidden = true;
      if (file.size > MAX_DATEI_GROSS) {
        zeigeFehler(`„${file.name}" ist ${dateiGroesse(file.size)} — erlaubt sind bis zu ${MAX_DATEI_GROSS / 1024 / 1024} MB.`);
        return;
      }

      gewaehlteDatei = file;
      start.hidden = true;
      busy.hidden = false;
      busyText.textContent = "Exposé wird gelesen …";
      balken.style.width = "35%";

      let felder = { adresse: "", objektTyp: "", beschreibung: "", textLaenge: 0 };
      try {
        felder = parseExpose(await extrahiereText(file));
      } catch (e) {
        // Kein Beinbruch: die Datei wird trotzdem gemeldet, nur ohne Vorschläge.
        console.warn("Exposé konnte nicht ausgelesen werden:", e);
      }
      balken.style.width = "100%";

      expName.textContent = file.name || "Exposé";
      expGroesse.textContent = dateiGroesse(file.size);
      expAdresse.value = felder.adresse || "";
      expBeschreibung.value = felder.beschreibung || "";
      if (felder.objektTyp) expTyp.value = felder.objektTyp;

      const etwasErkannt = Boolean(felder.adresse || felder.objektTyp || felder.beschreibung);
      expHinweis.textContent = etwasErkannt
        ? "Aus dem Exposé gelesen — bitte kurz prüfen und bei Bedarf anpassen."
        : "Wir konnten nichts automatisch auslesen (oft bei gescannten PDFs). Trag ein, was du weißt — das Exposé selbst kommt ohnehin mit.";

      busy.hidden = true;
      ergebnis.hidden = false;
      ergebnis.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };

    expEntfernen.addEventListener("click", zuruecksetzen);

    drop.addEventListener("click", () => input.click());
    drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
    input.addEventListener("change", () => verarbeite(input.files && input.files[0]));
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("is-over"); }));
    ["dragleave", "dragend"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("is-over")));
    drop.addEventListener("drop", (e) => {
      e.preventDefault(); drop.classList.remove("is-over");
      verarbeite(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
    });

    // Melden: erst Datei in den Storage, dann das Objekt mit dem Verweis.
    expSubmit.addEventListener("click", async () => {
      if (!gewaehlteDatei) return;
      okBox.hidden = true; errBox.hidden = true;
      const btnLabel = expSubmit.querySelector(".btn-label");
      expSubmit.disabled = true;
      btnLabel.textContent = "Exposé wird gespeichert …";
      busy.hidden = false;
      busyText.textContent = "Exposé wird gespeichert …";
      balken.style.width = "0%";

      try {
        const expose = await speichereDatei(gewaehlteDatei, {
          kundeId,
          hochgeladenVon: user.email,
          onFortschritt: (p) => { balken.style.width = Math.round(p * 100) + "%"; }
        });

        const daten = {
          adresse:      expAdresse.value.trim(),
          objektTyp:    expTyp.value,
          beschreibung: expBeschreibung.value.trim(),
          link:         "",
          expose,
          gemeldetVon:  user.email,
          kundeId,
          produktionsMonat
        };
        await objektMelden(daten);
        // Mail-Hinweis: die Datei liegt im Portal, es gibt keine direkte URL.
        sendAdminNeuesObjekt({ ...daten, link: `Exposé „${expose.name}" liegt im Portal beim Objekt` });

        zuruecksetzen();
        zeigeErfolg(erfolgsText());
      } catch (err) {
        console.error("Exposé-Meldung fehlgeschlagen:", err);
        zeigeFehler(speicherFehlerText(err));
        busy.hidden = true;
      } finally {
        expSubmit.disabled = false;
        btnLabel.textContent = `${wortEinheit} mit Exposé melden`;
      }
    });
  }

  // Firestore-Fehlercodes in Klartext übersetzen — „permission-denied" hilft niemandem.
  function speicherFehlerText(err) {
    const code = String((err && err.code) || "");
    if (code.includes("permission-denied"))
      return "Das Speichern wurde abgelehnt. Bitte melde dich neu an oder gib uns kurz Bescheid.";
    if (code.includes("unavailable") || code.includes("deadline"))
      return "Die Verbindung war zu instabil. Bitte versuch es erneut — oder melde das Objekt über das Formular.";
    if (code.includes("resource-exhausted"))
      return "Der Speicher ist gerade am Limit. Bitte versuch es später erneut oder nutze das Formular.";
    return (err && err.message) || "Speichern fehlgeschlagen. Bitte später erneut versuchen.";
  }

  // --- Weg 2: klassisches Formular ------------------------------------
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    okBox.hidden = true;
    errBox.hidden = true;

    const adresse      = form.adresse.value.trim();
    const objektTyp    = form.objektTyp.value;
    const beschreibung = form.beschreibung.value.trim();
    const link         = form.link.value.trim();

    if (!adresse || !objektTyp || !beschreibung) {
      zeigeFehler(istGastro
        ? "Bitte Adresse, Art der Filiale und Beschreibung ausfüllen."
        : "Bitte Adresse, Objekttyp und Beschreibung ausfüllen.");
      return;
    }

    submit.disabled = true;
    label.textContent = "Wird gemeldet …";

    try {
      // produktionsMonat explizit mitgeben, damit der gespeicherte Wert exakt
      // dem entspricht, was oben im Hinweis steht (Randfall: Monatswechsel bei
      // lange offener Seite).
      await objektMelden({ adresse, objektTyp, beschreibung, link, gemeldetVon: user.email, kundeId, produktionsMonat });
      // Admin-Mail fire-and-forget (blockiert die Meldung nicht).
      sendAdminNeuesObjekt({ adresse, objektTyp, beschreibung, link, gemeldetVon: user.email });

      form.reset();
      zeigeErfolg(erfolgsText());
    } catch (err) {
      console.error("Objekt-Meldung fehlgeschlagen:", err);
      zeigeFehler("Speichern fehlgeschlagen. Bitte später erneut versuchen.");
    } finally {
      submit.disabled = false;
      label.textContent = `${wortEinheit} melden`;
    }
  });
}
