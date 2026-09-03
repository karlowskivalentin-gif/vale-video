// Admin-View: Fonts (Admin-only) — Valentins Go-To-Schriften für Videos.
//   - Jede Karte zeigt die Schrift IN der Schrift (Probetext + Zeichensatz),
//     damit man sieht statt zu raten.
//   - „Name kopieren“ liefert den exakten Familiennamen für DaVinci/Premiere —
//     der eigentliche Grund für diesen Bereich: den Namen nie wieder vergessen.
//   - Zwei Quellen: Google (Stylesheet wird nachgeladen) und lokal installiert
//     (nur der Name; die Vorschau klappt dann nur auf Rechnern, wo sie liegt —
//     PC und MacBook können sich unterscheiden, deshalb das Verfügbar-Badge).
//   - Angeheftete Schriften stehen oben in der Go-To-Sektion.
// Der Kunde sieht diesen Bereich NIE (Rules: /fonts admin-only).
import { beobachteFonts, fontAnlegen, aktualisiereFont, loescheFont, FONT_ZWECKE } from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { escapeHtml } from "../util.js";
import { ladeGoogleFont, raeumeGoogleFonts, istInstalliert, familienStack,
         slugify, warteAufFont } from "../fontprobe.js";

const ZWECK_LABEL = {
  titel:      "Titel",
  bauchbinde: "Bauchbinde",
  untertitel: "Untertitel",
  logo:       "Logo",
  flaeche:    "Fließtext",
  akzent:     "Akzent"
};
const QUELLE_LABEL = { google: "Google", lokal: "Lokal" };
const ZEICHENSATZ = "ABCDEFGHIJKLM abcdefghijklm 0123456789 ÄÖÜ ß & % € – „“";
const PROBE_STANDARD = "Immobilien in Bewegung";
const GROESSE_STANDARD = 44;

// Werkbank-Einstellungen überleben den Seitenwechsel, sind aber reine
// Bequemlichkeit — geht localStorage nicht (Privatfenster), zählt der Standard.
const SPEICHER = { probe: "vv_fonts_probe", groesse: "vv_fonts_groesse",
                   dunkel: "vv_fonts_dunkel", versal: "vv_fonts_versal" };

function lies(schluessel, fallback) {
  try { const v = localStorage.getItem(schluessel); return v === null ? fallback : v; }
  catch (_) { return fallback; }
}
function schreib(schluessel, wert) {
  try { localStorage.setItem(schluessel, String(wert)); } catch (_) { /* egal */ }
}

export function renderAdminFonts(container) {
  let fonts = [];
  let filter = "alle";              // "alle" | "angeheftet" | <zweck>
  let formOffen = false;
  const editOffen = new Set();      // Karten im Bearbeiten-Modus (überleben Re-Render)

  let probetext = lies(SPEICHER.probe, PROBE_STANDARD);
  let groesse   = Number(lies(SPEICHER.groesse, GROESSE_STANDARD)) || GROESSE_STANDARD;
  let dunkel    = lies(SPEICHER.dunkel, "0") === "1";
  let versal    = lies(SPEICHER.versal, "0") === "1";

  container.innerHTML = `
    <div class="admin-head">
      <h1 class="view-title" style="margin:0">Fonts</h1>
      <button class="btn btn--accent btn--sm" id="ftNeu" type="button">+ Schrift</button>
    </div>
    <p class="muted view-intro">Deine Go-To-Schriften für Videos — mit echter Vorschau, damit du siehst statt zu
      raten, und mit dem exakten Namen zum Kopieren für DaVinci. Nur du siehst das.</p>

    <div class="card card--pad ft-werkbank">
      <div class="ft-werk-feld ft-werk-feld--breit">
        <label for="ft-probe">Probetext</label>
        <input id="ft-probe" type="text" value="${escapeHtml(probetext)}" placeholder="Was soll in der Schrift stehen?" />
      </div>
      <div class="ft-werk-feld">
        <label for="ft-groesse">Größe <span class="ft-werk-wert" id="ftGroesseWert">${groesse} px</span></label>
        <input id="ft-groesse" type="range" min="16" max="120" step="2" value="${groesse}" />
      </div>
      <div class="ft-werk-schalter">
        <button class="btn btn--ghost btn--sm" id="ftDunkel" type="button" aria-pressed="${dunkel}">🌙 Dunkel</button>
        <button class="btn btn--ghost btn--sm" id="ftVersal" type="button" aria-pressed="${versal}">AA Versalien</button>
      </div>
    </div>

    <div class="ft-chips" id="ftChips">
      <button class="ft-chip is-active" data-f="alle" type="button">Alle</button>
      <button class="ft-chip" data-f="angeheftet" type="button">📌 Go-To</button>
      ${FONT_ZWECKE.map((z) => `<button class="ft-chip" data-f="${z}" type="button">${ZWECK_LABEL[z]}</button>`).join("")}
    </div>

    <div class="card card--pad ft-form" id="ftForm" hidden></div>
    <div class="ft-liste" id="ftListe"><p class="muted">Lädt …</p></div>`;

  const liste   = container.querySelector("#ftListe");
  const formBox = container.querySelector("#ftForm");

  // --- Werkbank ------------------------------------------------------------
  // Größe, Dunkel und Versalien laufen über CSS — kein Re-Render nötig.
  // Der Probetext ist echter Textinhalt und wird gezielt nachgetragen.
  function wendeWerkbankAn() {
    liste.style.setProperty("--ft-groesse", groesse + "px");
    liste.classList.toggle("is-dunkel", dunkel);
    liste.classList.toggle("is-versal", versal);
  }

  function setzeProbetexte() {
    // Karten mit eigenem Probetext behalten ihren — der ist bewusst gesetzt.
    liste.querySelectorAll(".ft-probe:not([data-eigen])").forEach((el) => {
      el.textContent = probetext || PROBE_STANDARD;
    });
  }

  const probeInput = container.querySelector("#ft-probe");
  probeInput.addEventListener("input", () => {
    probetext = probeInput.value;
    schreib(SPEICHER.probe, probetext);
    setzeProbetexte();
  });

  const groesseInput = container.querySelector("#ft-groesse");
  const groesseWert  = container.querySelector("#ftGroesseWert");
  groesseInput.addEventListener("input", () => {
    groesse = Number(groesseInput.value) || GROESSE_STANDARD;
    groesseWert.textContent = groesse + " px";
    schreib(SPEICHER.groesse, groesse);
    wendeWerkbankAn();
  });

  const dunkelBtn = container.querySelector("#ftDunkel");
  dunkelBtn.classList.toggle("is-active", dunkel);
  dunkelBtn.addEventListener("click", () => {
    dunkel = !dunkel;
    dunkelBtn.setAttribute("aria-pressed", String(dunkel));
    dunkelBtn.classList.toggle("is-active", dunkel);
    schreib(SPEICHER.dunkel, dunkel ? "1" : "0");
    wendeWerkbankAn();
  });

  const versalBtn = container.querySelector("#ftVersal");
  versalBtn.classList.toggle("is-active", versal);
  versalBtn.addEventListener("click", () => {
    versal = !versal;
    versalBtn.setAttribute("aria-pressed", String(versal));
    versalBtn.classList.toggle("is-active", versal);
    schreib(SPEICHER.versal, versal ? "1" : "0");
    wendeWerkbankAn();
  });

  // --- Filter-Chips ---------------------------------------------------------
  container.querySelectorAll(".ft-chip").forEach((c) => c.addEventListener("click", () => {
    filter = c.getAttribute("data-f");
    container.querySelectorAll(".ft-chip").forEach((x) => x.classList.toggle("is-active", x === c));
    zeichne();
  }));

  // --- Formular-Bausteine (geteilt zwischen Anlegen und Inline-Edit) --------
  function zweckChips(aktive) {
    const gesetzt = new Set(Array.isArray(aktive) ? aktive : []);
    return `<div class="ft-zweck-chips">
      ${FONT_ZWECKE.map((z) => `<button type="button"
        class="ft-zweck-chip${gesetzt.has(z) ? " is-active" : ""}" data-zweck="${z}"
        aria-pressed="${gesetzt.has(z)}">${ZWECK_LABEL[z]}</button>`).join("")}
    </div>`;
  }

  function formFelder(f) {
    const quelle = f.quelle === "google" ? "google" : "lokal";
    return `
      <div class="grid-2">
        <div class="field">
          <label>Name <span class="req">*</span></label>
          <input type="text" class="ft-f-name" value="${escapeHtml(f.name || "")}" placeholder="z. B. Bebas Neue" />
        </div>
        <div class="field">
          <label>Exakter Schriftname</label>
          <input type="text" class="ft-f-familie" value="${escapeHtml(f.familie || "")}" placeholder="leer = wie der Name" />
          <p class="muted field-hint">Genau so, wie die Schrift in DaVinci/Premiere in der Liste steht.</p>
        </div>
      </div>
      <div class="grid-2">
        <div class="field">
          <label>Woher</label>
          <div class="ft-quelle-chips">
            <button type="button" class="ft-quelle-chip${quelle === "lokal" ? " is-active" : ""}" data-quelle="lokal">Lokal installiert</button>
            <button type="button" class="ft-quelle-chip${quelle === "google" ? " is-active" : ""}" data-quelle="google">Google Fonts</button>
          </div>
        </div>
        <div class="field ft-f-gewichte-feld"${quelle === "google" ? "" : " hidden"}>
          <label>Schnitte (Google)</label>
          <input type="text" class="ft-f-gewichte" value="${escapeHtml(f.gewichte || "")}" placeholder="400;700" />
          <p class="muted field-hint">Strichstärken, mit Semikolon getrennt. Leer = 400;700.</p>
        </div>
      </div>
      <div class="field">
        <label>Wofür</label>
        ${zweckChips(f.zwecke)}
      </div>
      <div class="field">
        <label>Notiz</label>
        <textarea class="ft-f-notiz" placeholder="Worauf achten? Wo hat sie gut funktioniert?" style="min-height:60px">${escapeHtml(f.notiz || "")}</textarea>
      </div>
      <div class="grid-2">
        <div class="field">
          <label>Bezugsquelle</label>
          <input type="url" class="ft-f-link" value="${escapeHtml(f.link || "")}" placeholder="fonts.google.com/… oder Kaufseite" />
        </div>
        <div class="field">
          <label>Eigener Probetext</label>
          <input type="text" class="ft-f-probetext" value="${escapeHtml(f.probetext || "")}" placeholder="leer = der Probetext von oben" />
        </div>
      </div>`;
  }

  // Quelle-Umschalter und Zweck-Chips in einem Formular-Kontext verdrahten.
  function verdrahteChips(scope) {
    scope.querySelectorAll(".ft-quelle-chip").forEach((c) => c.addEventListener("click", () => {
      scope.querySelectorAll(".ft-quelle-chip").forEach((x) => x.classList.toggle("is-active", x === c));
      const gewichteFeld = scope.querySelector(".ft-f-gewichte-feld");
      if (gewichteFeld) gewichteFeld.hidden = c.getAttribute("data-quelle") !== "google";
    }));
    scope.querySelectorAll(".ft-zweck-chip").forEach((c) => c.addEventListener("click", () => {
      const an = !c.classList.contains("is-active");
      c.classList.toggle("is-active", an);
      c.setAttribute("aria-pressed", String(an));
    }));
  }

  function liesFelder(scope) {
    const name = scope.querySelector(".ft-f-name").value.trim();
    let link = scope.querySelector(".ft-f-link").value.trim();
    if (link && !/^https?:\/\//i.test(link)) link = "https://" + link;
    const quelleChip = scope.querySelector(".ft-quelle-chip.is-active");
    return {
      name,
      familie:   scope.querySelector(".ft-f-familie").value.trim() || name,
      quelle:    (quelleChip && quelleChip.getAttribute("data-quelle")) || "lokal",
      gewichte:  scope.querySelector(".ft-f-gewichte").value.trim(),
      zwecke:    [...scope.querySelectorAll(".ft-zweck-chip.is-active")].map((c) => c.getAttribute("data-zweck")),
      notiz:     scope.querySelector(".ft-f-notiz").value.trim(),
      link,
      probetext: scope.querySelector(".ft-f-probetext").value.trim()
    };
  }

  // --- Neue Schrift (aufklappbares Formular) -------------------------------
  container.querySelector("#ftNeu").addEventListener("click", () => {
    formOffen = !formOffen;
    formBox.hidden = !formOffen;
    if (!formOffen) { formBox.innerHTML = ""; return; }
    formBox.innerHTML = `
      <form id="ftAnlegen" novalidate>
        ${formFelder({})}
        <div class="action-btns">
          <button class="btn btn--accent btn--sm" type="submit">Anlegen</button>
          <button class="btn btn--ghost btn--sm" id="ft-abbr" type="button">Abbrechen</button>
        </div>
      </form>`;
    verdrahteChips(formBox);
    formBox.querySelector("#ft-abbr").addEventListener("click", () => {
      formOffen = false; formBox.hidden = true; formBox.innerHTML = "";
    });
    formBox.querySelector("#ftAnlegen").addEventListener("submit", async (e) => {
      e.preventDefault();
      const daten = liesFelder(formBox);
      if (!daten.name) return;
      try {
        await fontAnlegen(daten);
        formOffen = false; formBox.hidden = true; formBox.innerHTML = "";
      } catch (err) { console.warn("Schrift anlegen fehlgeschlagen:", err); alert("Konnte nicht speichern."); }
    });
  });

  // --- Karten-Rendering -----------------------------------------------------
  function karteHtml(f) {
    const familie = f.familie || f.name || "";
    const stack   = familienStack(familie);
    const quelle  = f.quelle === "google" ? "google" : "lokal";
    const zwecke  = Array.isArray(f.zwecke) ? f.zwecke.filter((z) => ZWECK_LABEL[z]) : [];
    const eigen   = (f.probetext || "").trim();

    if (editOffen.has(f.id)) {
      return `
        <article class="card card--pad ft-karte is-edit" data-id="${escapeHtml(f.id)}">
          <form class="ft-edit-form" novalidate>
            ${formFelder(f)}
            <div class="action-btns">
              <button class="btn btn--accent btn--sm" type="submit">Speichern</button>
              <button class="btn btn--ghost btn--sm ft-edit-abbr" type="button">Abbrechen</button>
            </div>
          </form>
        </article>`;
    }

    return `
      <article class="card ft-karte" data-id="${escapeHtml(f.id)}" data-familie="${escapeHtml(familie)}" data-quelle="${quelle}">
        <div class="ft-kopf">
          <div class="ft-kopf-text">
            <h3 class="ft-name">${escapeHtml(f.name || "Ohne Namen")}</h3>
            <div class="ft-badges">
              <span class="pill pill--neutral">${QUELLE_LABEL[quelle]}</span>
              <span class="pill pill--neutral ft-verfuegbar">prüfe …</span>
            </div>
          </div>
          <button class="ft-pin${f.angeheftet ? " is-an" : ""}" type="button" aria-pressed="${!!f.angeheftet}"
            title="${f.angeheftet ? "Von Go-To lösen" : "Als Go-To anheften"}">📌</button>
        </div>

        <div class="ft-probe-flaeche">
          <div class="ft-probe" style="font-family:${escapeHtml(stack)}"${eigen ? ` data-eigen="1"` : ""}>${escapeHtml(eigen || probetext || PROBE_STANDARD)}</div>
          <div class="ft-zeichen" style="font-family:${escapeHtml(stack)}">${escapeHtml(ZEICHENSATZ)}</div>
        </div>

        ${zwecke.length ? `<div class="ft-zwecke">${zwecke.map((z) => `<span class="pill pill--aktion">${ZWECK_LABEL[z]}</span>`).join("")}</div>` : ""}
        ${f.notiz ? `<p class="ft-notiz">${escapeHtml(f.notiz)}</p>` : ""}

        <div class="ft-fuss">
          <button class="btn btn--ghost btn--sm ft-copy" type="button">Name kopieren</button>
          ${f.link ? `<a class="btn btn--ghost btn--sm" href="${escapeHtml(f.link)}" target="_blank" rel="noopener">Quelle ↗</a>` : ""}
          <button class="btn btn--ghost btn--sm ft-edit" type="button">Bearbeiten</button>
          <button class="gd-del ft-del" type="button" title="Schrift löschen">✕</button>
        </div>
      </article>`;
  }

  function sektionHtml(titel, eintraege) {
    if (!eintraege.length) return "";
    return `
      <section class="ft-sektion">
        <h2 class="ft-sektion-titel">${titel} <span class="muted">(${eintraege.length})</span></h2>
        <div class="ft-grid">${eintraege.map(karteHtml).join("")}</div>
      </section>`;
  }

  // Google-Schriften der aktuellen Auswahl nachladen, den Rest aus dem <head>
  // werfen — und danach die Verfügbar-Badges nachziehen.
  async function ladeUndPruefe(sichtbar) {
    const slugs = [];
    const laden = [];
    const google = [];
    sichtbar.forEach((f) => {
      if (f.quelle !== "google") return;
      const familie = f.familie || f.name;
      if (!familie) return;
      slugs.push(slugify(familie));
      google.push(familie);
      laden.push(ladeGoogleFont(familie, f.gewichte));
    });
    raeumeGoogleFonts(slugs);

    // Reihenfolge zählt: erst müssen die Stylesheets im Dokument sein,
    // dann kann auf die einzelnen Schriften gewartet und gemessen werden.
    await Promise.all(laden);
    await Promise.all(google.map((familie) => warteAufFont(familie)));
    setzeVerfuegbarkeit();
  }

  // Zeigt pro Karte an, ob die Vorschau WIRKLICH diese Schrift zeigt oder eine
  // Ersatzschrift. Wichtig, weil eine lokal installierte Schrift auf dem einen
  // Rechner da ist und auf dem anderen fehlt.
  function setzeVerfuegbarkeit() {
    liste.querySelectorAll(".ft-karte[data-familie]").forEach((karte) => {
      const badge = karte.querySelector(".ft-verfuegbar");
      if (!badge) return;
      const da     = istInstalliert(karte.getAttribute("data-familie"));
      const google = karte.getAttribute("data-quelle") === "google";
      badge.classList.remove("pill--neutral", "pill--ok", "pill--rot");
      badge.classList.add(da ? "pill--ok" : "pill--rot");
      badge.textContent = da
        ? (google ? "geladen" : "auf diesem Rechner")
        : (google ? "lädt nicht" : "hier nicht installiert");
      badge.title = da
        ? "Die Vorschau zeigt wirklich diese Schrift."
        : (google
            ? "Google kennt diese Familie nicht — Schreibweise prüfen."
            : "Auf diesem Rechner nicht installiert — die Vorschau zeigt eine Ersatzschrift. Auf dem anderen Rechner kann das anders sein.");
    });
  }

  function zeichne() {
    const passt = (f) => {
      if (filter === "alle") return true;
      if (filter === "angeheftet") return !!f.angeheftet;
      return Array.isArray(f.zwecke) && f.zwecke.includes(filter);
    };
    const sichtbar = fonts.filter(passt);

    if (!sichtbar.length) {
      liste.innerHTML = `<div class="card card--pad empty-card">
        <div class="empty-emoji">🔤</div>
        <p class="empty-title">${fonts.length ? "Nichts in dieser Auswahl" : "Noch keine Schriften angeheftet"}</p>
        <p class="muted">${fonts.length
          ? "Wähl oben eine andere Kategorie."
          : "Leg oben mit „+ Schrift“ deine erste Go-To-Schrift an — Google-Font oder eine, die du installiert hast."}</p>
      </div>`;
      wendeWerkbankAn();
      return;
    }

    const angeheftet = sichtbar.filter((f) => f.angeheftet);
    const rest       = sichtbar.filter((f) => !f.angeheftet);
    liste.innerHTML = filter === "angeheftet"
      ? sektionHtml("📌 Go-To", angeheftet)
      : sektionHtml("📌 Go-To", angeheftet) + sektionHtml("Weitere", rest);

    wendeWerkbankAn();
    verdrahteKarten();
    ladeUndPruefe(sichtbar);
  }

  function verdrahteKarten() {
    liste.querySelectorAll(".ft-karte").forEach((karte) => {
      const id = karte.getAttribute("data-id");
      const f  = fonts.find((x) => x.id === id);
      if (!f) return;

      // Anheften / lösen
      const pin = karte.querySelector(".ft-pin");
      if (pin) pin.addEventListener("click", async () => {
        try { await aktualisiereFont(id, { angeheftet: !f.angeheftet }); }
        catch (e) { console.warn("Anheften fehlgeschlagen:", e); }
      });

      // Exakten Schriftnamen in die Zwischenablage — der Kern des Bereichs.
      const copy = karte.querySelector(".ft-copy");
      if (copy) copy.addEventListener("click", async () => {
        const familie = f.familie || f.name || "";
        const alt = copy.textContent;
        try {
          await navigator.clipboard.writeText(familie);
          copy.textContent = "Kopiert ✓";
        } catch (e) {
          console.warn("Kopieren fehlgeschlagen:", e);
          copy.textContent = familie;
        }
        setTimeout(() => { if (copy.isConnected) copy.textContent = alt; }, 1800);
      });

      // Inline-Edit öffnen / abbrechen / speichern
      const editBtn = karte.querySelector(".ft-edit");
      if (editBtn) editBtn.addEventListener("click", () => { editOffen.add(id); zeichne(); });

      const editForm = karte.querySelector(".ft-edit-form");
      if (editForm) {
        verdrahteChips(editForm);
        editForm.querySelector(".ft-edit-abbr").addEventListener("click", () => { editOffen.delete(id); zeichne(); });
        editForm.addEventListener("submit", async (e) => {
          e.preventDefault();
          const daten = liesFelder(editForm);
          if (!daten.name) return;
          try { await aktualisiereFont(id, daten); editOffen.delete(id); }
          catch (err) { console.warn("Schrift speichern fehlgeschlagen:", err); alert("Konnte nicht speichern."); }
        });
      }

      // Löschen mit 2-Klick-Bestätigung (Muster Moodboard/Inspiration)
      const del = karte.querySelector(".ft-del");
      if (del) del.addEventListener("click", async () => {
        if (!del.classList.contains("is-bestaetigen")) {
          del.classList.add("is-bestaetigen"); del.textContent = "Löschen?";
          setTimeout(() => { if (del.isConnected) { del.classList.remove("is-bestaetigen"); del.textContent = "✕"; } }, 4000);
          return;
        }
        try { await loescheFont(id); } catch (e) { console.warn(e); }
      });
    });
  }

  const unsub = beobachteFonts(
    (neue) => {
      fonts = neue;
      // Laufende Eingaben im Inline-Editor nicht durch Re-Render zerstören.
      if (liste.contains(document.activeElement) && document.activeElement.closest(".ft-edit-form")) return;
      zeichne();
    },
    (err) => {
      console.warn("Fonts laden fehlgeschlagen:", err);
      liste.innerHTML = `<div class="card card--pad"><p class="notice notice--error" style="margin:0">
        Konnte nicht laden — sind die Firestore-Rules für „fonts“ veröffentlicht?</p></div>`;
    }
  );
  beiViewWechsel(unsub);
  beiViewWechsel(() => raeumeGoogleFonts());
}
