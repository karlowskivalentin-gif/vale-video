// Admin-View: Kunden (Mandanten-Verwaltung).
//   - Liste aller Kundenprofile (Name + Login-E-Mails)
//   - Neu anlegen / bearbeiten (Name + E-Mail-Liste)  → kundeSpeichern (ein Batch,
//     hält kunden/{id} und kundenmitglieder/{email} synchron)
//   - Einmaliger Migrations-Button: ordnet den Altbestand dem Kunden „deussen" zu.
// Nur Admin (siehe router.js: rolle "admin").
import { beobachteKunden, kundeSpeichern, migriereAltbestand } from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { KUNDE_EMAILS } from "../roles.js";
import { setzeAktiv } from "../kunde-context.js";
import { sendeKundenZugang } from "../auth.js";
import { escapeHtml } from "../util.js";

// Verschickt Firebase-Anmelde-Links an eine Liste von E-Mails. Gibt
// { ok, fehler } zurück (Anzahl erfolgreich / fehlgeschlagen). Fire-and-report.
async function sendeZugaenge(emails) {
  const res = await Promise.allSettled((emails || []).map((e) => sendeKundenZugang(e)));
  const ok = res.filter((r) => r.status === "fulfilled").length;
  return { ok, fehler: res.length - ok };
}

// Name → Doc-ID (Slug): kleinbuchstaben, nur a-z0-9, Rest zu „-".
function slug(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")   // restliche Akzente/Diakritika entfernen
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "kunde";
}

export function renderAdminKunden(container) {
  container.innerHTML = `
    <div class="admin-head">
      <h1 class="view-title" style="margin:0">Kunden</h1>
      <button class="btn btn--accent btn--sm" id="kdNeu" type="button">+ Neuer Kunde</button>
    </div>
    <p class="muted view-intro">Kundenprofile (Mandanten). Jeder Kunde hat eine eigene Pipeline, Mindmaps, Objekte, Pläne und Termine. Über den Umschalter oben wechselst du zwischen ihnen.</p>

    <div class="kd-form-wrap" id="kdFormWrap" hidden>
      <section class="card card--pad">
        <h2 class="kd-form-titel" id="kdFormTitel">Neuer Kunde</h2>
        <p class="muted" style="margin:.1rem 0 .7rem">Neue Login-E-Mails bekommen beim Speichern automatisch einen Anmelde-Link (Firebase). Der Kunde klickt, ist eingeloggt und legt im Portal sein eigenes Passwort fest.</p>
        <div class="notice notice--error" id="kdErr" hidden role="alert"></div>
        <div class="notice notice--ok"    id="kdOk"  hidden role="status"></div>
        <form id="kdForm" novalidate>
          <div class="field">
            <label for="kdName">Name</label>
            <input id="kdName" type="text" maxlength="60" placeholder="z. B. Müller Immobilien" autocomplete="off" />
          </div>
          <div class="field">
            <label for="kdEmails">Login-E-Mails <span class="muted">(eine pro Zeile — diese Adressen bekommen Kundenzugang)</span></label>
            <textarea id="kdEmails" rows="4" placeholder="max@mueller-immobilien.de&#10;info@mueller-immobilien.de"></textarea>
          </div>
          <div class="action-btns">
            <button class="btn btn--accent btn--sm" id="kdSave" type="submit">Speichern</button>
            <button class="btn btn--ghost btn--sm" id="kdCancel" type="button">Abbrechen</button>
          </div>
        </form>
      </section>
    </div>

    <div id="kdList"><div class="card card--pad"><p class="muted">Wird geladen …</p></div></div>

    <section class="card card--pad kd-wartung">
      <h2 class="kd-form-titel">Wartung</h2>
      <p class="muted" style="margin:.2rem 0 .7rem">Einmalig: ordnet allen bestehenden Videos, Mindmaps, Objekten, Plänen und Terminen (ohne Kundenzuordnung) dem Kunden <strong>Deussen</strong> zu. Mehrfaches Ausführen ist unschädlich.</p>
      <div class="notice notice--ok" id="kdMigOk" hidden role="status"></div>
      <button class="btn btn--ghost btn--sm" id="kdMig" type="button">Altbestand zu „Deussen" migrieren</button>
    </section>`;

  const listEl   = container.querySelector("#kdList");
  const formWrap = container.querySelector("#kdFormWrap");
  const form     = container.querySelector("#kdForm");
  const titelEl  = container.querySelector("#kdFormTitel");
  const nameEl   = container.querySelector("#kdName");
  const emailsEl = container.querySelector("#kdEmails");
  const errEl    = container.querySelector("#kdErr");
  const okEl     = container.querySelector("#kdOk");
  const saveBtn  = container.querySelector("#kdSave");

  // Aktueller Formular-Zustand: null = Neuanlage; sonst { id, emails } für Edit.
  let bearbeite = null;
  let kunden = [];

  function zeigeForm(kunde) {
    bearbeite = kunde || null;
    titelEl.textContent = kunde ? `Kunde bearbeiten: ${kunde.name || kunde.id}` : "Neuer Kunde";
    nameEl.value   = kunde ? (kunde.name || "") : "";
    emailsEl.value = kunde && Array.isArray(kunde.emails) ? kunde.emails.join("\n") : "";
    errEl.hidden = true;
    okEl.hidden = true;
    formWrap.hidden = false;
    nameEl.focus();
  }
  function schliesseForm() {
    formWrap.hidden = true;
    bearbeite = null;
    form.reset();
    errEl.hidden = true;
    okEl.hidden = true;
  }

  container.querySelector("#kdNeu").addEventListener("click", () => zeigeForm(null));
  container.querySelector("#kdCancel").addEventListener("click", schliesseForm);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.hidden = true; okEl.hidden = true;
    const name = nameEl.value.trim();
    const emails = emailsEl.value.split(/[\n,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!name) { errEl.textContent = "Bitte einen Namen angeben."; errEl.hidden = false; nameEl.focus(); return; }

    const id = bearbeite ? bearbeite.id : slug(name);
    // Bei Neuanlage: ID-Kollision vermeiden.
    if (!bearbeite && kunden.some((k) => k.id === id)) {
      errEl.textContent = `Ein Kunde mit ähnlichem Namen existiert bereits (ID „${id}"). Bitte anders benennen.`;
      errEl.hidden = false; return;
    }

    // Neu hinzugekommene Login-E-Mails → bekommen automatisch einen Anmelde-Link.
    const altEmails = bearbeite ? (bearbeite.emails || []).map((x) => x.toLowerCase()) : [];
    const neueEmails = emails.filter((mail) => !altEmails.includes(mail));

    saveBtn.disabled = true;
    try {
      await kundeSpeichern({ id, name, emails, altEmails, istNeu: !bearbeite });

      let hinweis = bearbeite ? "Änderungen gespeichert." : "Kunde angelegt.";
      if (neueEmails.length) {
        const { ok, fehler } = await sendeZugaenge(neueEmails);
        hinweis += ` Anmelde-Link an ${ok} Adresse${ok === 1 ? "" : "n"} verschickt`;
        hinweis += fehler ? ` (${fehler} fehlgeschlagen — bitte Adresse prüfen).` : ".";
      }
      okEl.textContent = hinweis;
      okEl.hidden = false;

      if (!bearbeite) setzeAktiv(id);   // frisch angelegten Kunden gleich aktiv schalten
      // Formular in „Bearbeiten"-Modus des soeben gespeicherten Kunden versetzen,
      // damit ein erneutes Speichern kein Duplikat anlegt.
      bearbeite = { id, name, emails };
      titelEl.textContent = `Kunde bearbeiten: ${name}`;
    } catch (ex) {
      console.error(ex);
      errEl.textContent = "Speichern fehlgeschlagen. Bitte erneut versuchen.";
      errEl.hidden = false;
    } finally {
      saveBtn.disabled = false;
    }
  });

  // Migration.
  const migBtn = container.querySelector("#kdMig");
  const migOk  = container.querySelector("#kdMigOk");
  migBtn.addEventListener("click", async () => {
    if (!confirm("Altbestand jetzt dem Kunden Deussen zuordnen? Das ist idempotent (mehrfach ausführbar).")) return;
    migBtn.disabled = true; migBtn.textContent = "Migriere …";
    try {
      const bericht = await migriereAltbestand(KUNDE_EMAILS);
      const zeilen = Object.entries(bericht).map(([k, n]) => `${k}: ${n}`).join(" · ");
      migOk.textContent = `Fertig. Zugeordnet — ${zeilen}.`;
      migOk.hidden = false;
    } catch (ex) {
      console.error(ex);
      alert("Migration fehlgeschlagen: " + (ex && ex.message ? ex.message : ex));
    } finally {
      migBtn.disabled = false; migBtn.textContent = "Altbestand zu Deussen migrieren";
    }
  });

  // Anmelde-Links (erneut) an alle E-Mails eines Kunden senden.
  async function resendZugang(kunde, btn) {
    const mails = Array.isArray(kunde.emails) ? kunde.emails : [];
    if (!mails.length) { alert("Dieser Kunde hat noch keine Login-E-Mails."); return; }
    if (!confirm(`Anmelde-Link an ${mails.length} Adresse(n) von „${kunde.name || kunde.id}" senden?`)) return;
    btn.disabled = true; const alt = btn.textContent; btn.textContent = "Sende …";
    try {
      const { ok, fehler } = await sendeZugaenge(mails);
      alert(`Anmelde-Link an ${ok} Adresse(n) verschickt${fehler ? ` (${fehler} fehlgeschlagen)` : ""}.`);
    } catch (ex) {
      console.error(ex); alert("Versand fehlgeschlagen.");
    } finally {
      btn.disabled = false; btn.textContent = alt;
    }
  }

  const unsub = beobachteKunden(
    (liste) => { kunden = liste; zeichne(listEl, liste, zeigeForm, resendZugang); },
    (err) => {
      console.error(err);
      listEl.innerHTML = `<div class="card card--pad"><p class="notice notice--error" style="margin:0">
        Konnte Kunden nicht laden.</p></div>`;
    }
  );
  beiViewWechsel(unsub);
}

function zeichne(el, kunden, zeigeForm, resendZugang) {
  if (!kunden.length) {
    el.innerHTML = `<div class="card card--pad empty-card">
      <div class="empty-emoji">🧑‍💼</div>
      <p class="empty-title">Noch keine Kunden</p>
      <p class="muted">Lege deinen ersten Kunden an — oder migriere unten den Altbestand zu „Deussen".</p>
    </div>`;
    return;
  }

  el.innerHTML = `<div class="card row-list">
    ${kunden.map((k) => {
      const anz = Array.isArray(k.emails) ? k.emails.length : 0;
      return `
        <div class="pl-row" data-id="${escapeHtml(k.id)}">
          <div class="pl-main">
            <span class="row-name">${escapeHtml(k.name || k.id)}</span>
            <span class="row-sub muted">${anz} Login${anz === 1 ? "" : "s"}${anz ? " · " + escapeHtml((k.emails || []).join(", ")) : ""}</span>
          </div>
          <button class="btn btn--ghost btn--sm kd-send" type="button" title="Anmelde-Link (erneut) senden">Zugang senden</button>
          <button class="btn btn--ghost btn--sm kd-edit" type="button">Bearbeiten</button>
        </div>`;
    }).join("")}
  </div>`;

  el.querySelectorAll(".pl-row").forEach((row) => {
    const id = row.getAttribute("data-id");
    const kunde = kunden.find((x) => x.id === id);
    row.querySelector(".kd-edit").addEventListener("click", () => zeigeForm(kunde));
    row.querySelector(".kd-send").addEventListener("click", (ev) => resendZugang(kunde, ev.currentTarget));
  });
}
