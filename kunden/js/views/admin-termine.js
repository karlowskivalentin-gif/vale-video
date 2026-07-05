// Admin-View: Termine. Manuelle, frei stehende Kalender-Einträge (ohne
// Pipeline-Video). Admin legt an / bearbeitet / löscht; der Kunde sieht sie
// nur im Kalender (read-only) und kann sie per .ics exportieren.
//
// Felder: kategorie, bezeichnung*, datum*, uhrzeitVon, uhrzeitBis, ort, notiz.
import {
  beobachteTermine, terminAnlegen, aktualisiereTermin, loescheTermin
} from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { escapeHtml, formatDatum, tsZuDateInput, dateInputZuDate } from "../util.js";

const KATEGORIEN = [
  { val: "besprechung",       label: "💬 Besprechung" },
  { val: "drehtermin",        label: "🎬 Drehtermin" },
  { val: "veroeffentlichung", label: "📣 Veröffentlichung" }
];
const KAT_LABEL = {
  besprechung: "💬 Besprechung", drehtermin: "🎬 Drehtermin", veroeffentlichung: "📣 Veröffentlichung"
};

export function renderAdminTermine(container) {
  const katOpts = KATEGORIEN
    .map((k) => `<option value="${k.val}">${escapeHtml(k.label)}</option>`).join("");

  container.innerHTML = `
    <div class="admin-head">
      <h1 class="view-title" style="margin:0">Termine</h1>
    </div>
    <p class="muted view-intro">Manuelle Kalender-Einträge (Besprechungen, Dreh- und Veröffentlichungstermine).
      Sie erscheinen farbcodiert im Kalender – auch beim Kunden.</p>

    <section class="card card--pad form-card">
      <div class="notice notice--ok"    id="tmOk"  hidden role="status"></div>
      <div class="notice notice--error" id="tmErr" hidden role="alert"></div>

      <form id="tmForm" novalidate>
        <div class="grid-2">
          <div class="field">
            <label for="t-kategorie">Kategorie</label>
            <select id="t-kategorie">${katOpts}</select>
          </div>
          <div class="field">
            <label for="t-datum">Datum <span class="req">*</span></label>
            <input id="t-datum" type="date" required />
          </div>
        </div>

        <div class="field">
          <label for="t-bezeichnung">Bezeichnung <span class="req">*</span></label>
          <input id="t-bezeichnung" type="text" placeholder="z. B. Drehtag Musterstraße 1" required />
        </div>

        <div class="grid-2">
          <div class="field">
            <label for="t-von">Uhrzeit von</label>
            <input id="t-von" type="time" />
          </div>
          <div class="field">
            <label for="t-bis">Uhrzeit bis</label>
            <input id="t-bis" type="time" />
          </div>
        </div>

        <div class="field">
          <label for="t-ort">Ort</label>
          <input id="t-ort" type="text" placeholder="z. B. Musterstraße 1, Düsseldorf" />
        </div>

        <div class="field">
          <label for="t-notiz">Notiz</label>
          <textarea id="t-notiz" placeholder="Optionale Details …"></textarea>
        </div>

        <div class="action-btns" style="margin-top:1rem">
          <button class="btn btn--accent" id="tmSave" type="submit">Termin anlegen</button>
          <button class="btn btn--ghost" id="tmCancel" type="button" hidden>Abbrechen</button>
        </div>
      </form>
    </section>

    <h2 class="section-title" style="margin-top:1.75rem">Alle Termine</h2>
    <div id="tmList"><div class="card card--pad"><p class="muted">Wird geladen …</p></div></div>`;

  const form    = container.querySelector("#tmForm");
  const okBox   = container.querySelector("#tmOk");
  const errBox  = container.querySelector("#tmErr");
  const save    = container.querySelector("#tmSave");
  const cancel  = container.querySelector("#tmCancel");
  const listEl  = container.querySelector("#tmList");

  const f = {
    kategorie:   container.querySelector("#t-kategorie"),
    datum:       container.querySelector("#t-datum"),
    bezeichnung: container.querySelector("#t-bezeichnung"),
    von:         container.querySelector("#t-von"),
    bis:         container.querySelector("#t-bis"),
    ort:         container.querySelector("#t-ort"),
    notiz:       container.querySelector("#t-notiz")
  };

  let editId = null;          // null = Anlegen, sonst Bearbeiten
  let aktuelle = [];          // letzte Termin-Liste (für Edit-Prefill)

  function formLeeren() {
    editId = null;
    form.reset();
    save.textContent = "Termin anlegen";
    cancel.hidden = true;
  }

  function fuelleForm(t) {
    editId = t.id;
    f.kategorie.value   = t.kategorie || "besprechung";
    f.datum.value       = tsZuDateInput(t.datum);
    f.bezeichnung.value = t.bezeichnung || "";
    f.von.value         = t.uhrzeitVon || "";
    f.bis.value         = t.uhrzeitBis || "";
    f.ort.value         = t.ort || "";
    f.notiz.value       = t.notiz || "";
    save.textContent = "Aktualisieren";
    cancel.hidden = false;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  cancel.addEventListener("click", () => { formLeeren(); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    okBox.hidden = true; errBox.hidden = true;

    const daten = {
      kategorie:   f.kategorie.value,
      bezeichnung: f.bezeichnung.value.trim(),
      datum:       dateInputZuDate(f.datum.value),
      uhrzeitVon:  f.von.value,
      uhrzeitBis:  f.bis.value,
      ort:         f.ort.value.trim(),
      notiz:       f.notiz.value.trim()
    };

    if (!daten.bezeichnung) { errBox.textContent = "Bitte eine Bezeichnung eingeben."; errBox.hidden = false; return; }
    if (!daten.datum)       { errBox.textContent = "Bitte ein Datum wählen."; errBox.hidden = false; return; }
    if (daten.uhrzeitVon && daten.uhrzeitBis && daten.uhrzeitBis < daten.uhrzeitVon) {
      errBox.textContent = "„Uhrzeit bis“ liegt vor „Uhrzeit von“."; errBox.hidden = false; return;
    }

    save.disabled = true;
    const orig = save.textContent;
    save.textContent = editId ? "Wird gespeichert …" : "Wird angelegt …";
    try {
      if (editId) await aktualisiereTermin(editId, daten);
      else        await terminAnlegen(daten);
      formLeeren();
      okBox.textContent = "Gespeichert.";
      okBox.hidden = false;
      okBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (err) {
      console.error(err);
      errBox.textContent = "Speichern fehlgeschlagen.";
      errBox.hidden = false;
      save.disabled = false;
      save.textContent = orig;
    } finally {
      save.disabled = false;
    }
  });

  const unsub = beobachteTermine(
    (liste) => { aktuelle = liste; zeichneListe(listEl, liste); },
    (err) => {
      console.error(err);
      listEl.innerHTML = `<div class="card card--pad"><p class="notice notice--error" style="margin:0">
        Konnte nicht laden. Sind die Firestore-Rules für „termine" deployed?</p></div>`;
    }
  );
  beiViewWechsel(unsub);

  // Edit/Delete via Event-Delegation (Liste wird bei jedem Snapshot neu gebaut).
  listEl.addEventListener("click", async (e) => {
    const row = e.target.closest(".tm-row");
    if (!row) return;
    const id = row.getAttribute("data-id");

    if (e.target.closest(".tm-edit")) {
      const t = aktuelle.find((x) => x.id === id);
      if (t) fuelleForm(t);
      return;
    }
    if (e.target.closest(".tm-del")) {
      const t = aktuelle.find((x) => x.id === id);
      if (!confirm(`Termin „${(t && t.bezeichnung) || ""}" wirklich löschen?`)) return;
      const btn = e.target.closest(".tm-del");
      btn.disabled = true;
      try {
        await loescheTermin(id);
        if (editId === id) formLeeren();
      } catch (err) {
        console.error(err);
        alert("Löschen fehlgeschlagen.");
        btn.disabled = false;
      }
    }
  });
}

function zeichneListe(el, termine) {
  if (!termine.length) {
    el.innerHTML = `<div class="card card--pad empty-card">
      <div class="empty-emoji">📅</div>
      <p class="empty-title">Noch keine Termine</p>
      <p class="muted">Lege oben den ersten Termin an – er erscheint sofort im Kalender.</p>
    </div>`;
    return;
  }

  el.innerHTML = `<div class="card row-list">
    ${termine.map((t) => {
      const kat = KAT_LABEL[t.kategorie] || "Termin";
      const cls = t.kategorie === "drehtermin" ? "dreh" : (t.kategorie || "besprechung");
      const zeit = t.uhrzeitVon
        ? `${escapeHtml(t.uhrzeitVon)}${t.uhrzeitBis ? "–" + escapeHtml(t.uhrzeitBis) : ""} Uhr`
        : "ganztägig";
      return `
        <div class="tm-row" data-id="${escapeHtml(t.id)}">
          <div class="tm-main">
            <span class="row-name">
              <span class="tm-kat tm-kat--${cls}">${escapeHtml(kat)}</span>
              ${escapeHtml(t.bezeichnung || "Ohne Bezeichnung")}
            </span>
            <span class="row-sub muted">
              ${escapeHtml(formatDatum(t.datum))} · ${zeit}${t.ort ? " · " + escapeHtml(t.ort) : ""}
            </span>
            ${t.notiz ? `<p class="ob-beschr">${escapeHtml(t.notiz)}</p>` : ""}
          </div>
          <div class="ob-aktionen">
            <button class="btn btn--ghost btn--sm tm-edit" type="button">Bearbeiten</button>
            <button class="btn btn--ghost btn--sm tm-del" type="button" aria-label="Löschen">Löschen</button>
          </div>
        </div>`;
    }).join("")}
  </div>`;
}
