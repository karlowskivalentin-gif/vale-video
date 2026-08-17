// Admin-View: Objekte (bei Gastro-Kunden: Filialen).
//   - Nach Produktionsmonat gruppiert (gemeldet im Juli → Produktion im August),
//     auf-/zuklappbare Monats-Sektionen wie in der Video-Pipeline.
//   - Status setzen (Eingegangen | In Produktion | Erledigt)
//   - Bearbeiten (Adresse, Typ, Beschreibung, Link, Produktionsmonat)
//   - „Video aus Objekt anlegen" → Prefill im Edit-Formular (sessionStorage);
//     das Video erbt dort den Produktionsmonat des Objekts.
//   - Selbst anlegen: gleiche Collection wie die Kunden-Meldung, aber ohne
//     Admin-Mail (der Admin meldet an sich selbst) und ohne Exposé-OCR.
import { beobachteObjekte, objektMelden, setzeObjektStatus, loescheObjekt, aktualisiereObjekt } from "../db.js";
import { ladeDatei, loescheDateiKomplett } from "../dateien.js";
import { zeigeDateiInline } from "../docparse.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { OBJEKT_STATUS_LISTE, objektTypenFuer, objektMeldeMonat, objektProduktionsMonat } from "../status.js";
import { escapeHtml, formatDatum, monatKey, monatsLabel, monatPlus } from "../util.js";

export function renderAdminObjekte(container, opts = {}) {
  const kundeId = opts.kundeId || null;
  const user = opts.user || null;
  const istGastro = opts.kundenart === "gastro";
  const wortEinheit = istGastro ? "Filiale" : "Objekt";
  const typen = objektTypenFuer(opts.kundenart);

  const aktuellerMonat = monatKey(new Date());
  const naechsterMonat = monatPlus(aktuellerMonat, 1);

  container.innerHTML = `
    <div class="admin-head">
      <h1 class="view-title" style="margin:0">${istGastro ? "Filialen" : "Gemeldete Objekte"}</h1>
      <button class="btn btn--accent btn--sm" id="obNeu" type="button">+ ${wortEinheit} anlegen</button>
    </div>
    <p class="muted view-intro">${istGastro
      ? "Standorte des Kunden, sortiert nach Produktionsmonat. Was diesen Monat dazukommt, drehen wir im Folgemonat."
      : "Vom Kunden gemeldete Immobilien, sortiert nach Produktionsmonat. Was diesen Monat gemeldet wird, produzieren wir im Folgemonat."}</p>

    <div id="obFormWrap" hidden>
      <section class="card card--pad form-card">
        <h2 class="section-title" style="margin:0 0 .7rem">${wortEinheit} anlegen</h2>
        <div class="notice notice--ok"    id="obFormOk"  hidden role="status"></div>
        <div class="notice notice--error" id="obFormErr" hidden role="alert"></div>
        <form id="obForm" novalidate>
          ${felderHtml("ob", {}, typen, istGastro, naechsterMonat)}
          <div class="action-btns">
            <button class="btn btn--accent btn--sm" id="obSave" type="submit">Anlegen</button>
            <button class="btn btn--ghost btn--sm" id="obCancel" type="button">Abbrechen</button>
          </div>
        </form>
      </section>
    </div>

    <div id="obList"><div class="card card--pad"><p class="muted">Wird geladen …</p></div></div>`;

  const obList = container.querySelector("#obList");

  // View-State überlebt die Snapshot-Re-Renders (Monats-Sektionen auf/zu,
  // offene Inline-Editoren).
  const ctx = {
    istGastro, typen, wortEinheit,
    offeneMonate: new Set([aktuellerMonat, naechsterMonat]),
    offenEdit: new Set(),
    render: null
  };

  let objekte = [];
  const render = () => zeichne(obList, objekte, ctx);
  ctx.render = render;

  wireAnlegen(container, { kundeId, user, wortEinheit });

  const unsub = beobachteObjekte(
    (liste) => { objekte = liste; render(); },
    (err) => {
      console.error(err);
      obList.innerHTML = `<div class="card card--pad"><p class="notice notice--error" style="margin:0">
        Konnte nicht laden. Ist die Firestore-Datenbank eingerichtet?</p></div>`;
    },
    kundeId
  );
  beiViewWechsel(unsub);
}

// --- Geteilte Formularfelder (Anlegen + Inline-Bearbeiten) -------------
// Ein Markup für beide Wege, damit sie nicht auseinanderlaufen. `praefix`
// macht die IDs eindeutig ("ob" für das Anlege-Formular, "obe-<id>" je Karte).
function felderHtml(praefix, werte, typen, istGastro, monat) {
  const v = werte || {};
  const typListe = typen.slice();
  if (v.objektTyp && !typListe.includes(v.objektTyp)) typListe.push(v.objektTyp);
  return `
    <div class="field">
      <label for="${praefix}Adresse">Adresse <span class="req">*</span></label>
      <input id="${praefix}Adresse" class="f-adresse" type="text" value="${escapeHtml(v.adresse || "")}"
             placeholder="Straße Hausnr., PLZ Ort" autocomplete="off" />
    </div>
    <div class="grid-2">
      <div class="field">
        <label for="${praefix}Typ">${istGastro ? "Art der Filiale" : "Objekttyp"} <span class="req">*</span></label>
        <select id="${praefix}Typ" class="f-typ">
          ${typListe.map((t) => `<option value="${escapeHtml(t)}"${t === v.objektTyp ? " selected" : ""}>${escapeHtml(t)}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label for="${praefix}Monat">Produktionsmonat</label>
        <select id="${praefix}Monat" class="f-monat">${monatOptionsHtml(monat)}</select>
      </div>
    </div>
    <div class="field">
      <label for="${praefix}Beschreibung">Beschreibung / Eckdaten</label>
      <textarea id="${praefix}Beschreibung" class="f-beschreibung" placeholder="${istGastro
        ? "Ambiente, Besonderheiten, beste Drehzeiten …"
        : "Zimmer, Wohnfläche, Besonderheiten, gewünschter Fokus …"}">${escapeHtml(v.beschreibung || "")}</textarea>
    </div>
    <div class="field">
      <label for="${praefix}Link">Link (optional)</label>
      <input id="${praefix}Link" class="f-link" type="url" value="${escapeHtml(v.link || "")}"
             placeholder="https://drive.google.com/… oder https://www.dropbox.com/…" />
    </div>`;
}

// Monats-Fenster: Vormonat … +2, plus den gesetzten Monat falls er außerhalb
// liegt (sonst wäre die Selektion unsichtbar). Gleiche Logik wie in der Pipeline.
function monatOptionsHtml(gewaehlt) {
  const basis = monatKey(new Date());
  const fenster = [monatPlus(basis, -1), basis, monatPlus(basis, 1), monatPlus(basis, 2)];
  if (gewaehlt && !fenster.includes(gewaehlt)) fenster.push(gewaehlt);
  return fenster.sort()
    .map((m) => `<option value="${escapeHtml(m)}"${m === gewaehlt ? " selected" : ""}>${escapeHtml(monatsLabel(m))}</option>`)
    .join("");
}

// Werte aus einem Feldsatz (Anlege-Formular oder Inline-Editor) einsammeln.
function leseFelder(wurzel) {
  return {
    adresse:          wurzel.querySelector(".f-adresse").value.trim(),
    objektTyp:        wurzel.querySelector(".f-typ").value,
    beschreibung:     wurzel.querySelector(".f-beschreibung").value.trim(),
    link:             wurzel.querySelector(".f-link").value.trim(),
    produktionsMonat: wurzel.querySelector(".f-monat").value
  };
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
    const daten = leseFelder(form);
    if (!daten.adresse) { errB.textContent = "Bitte eine Adresse angeben."; errB.hidden = false; return; }
    if (!kundeId) { errB.textContent = "Kein aktiver Kunde gewählt."; errB.hidden = false; return; }
    save.disabled = true;
    try {
      await objektMelden({ ...daten, gemeldetVon: user && user.email, kundeId });
      form.reset();
      okB.textContent = `${wortEinheit} angelegt — eingeplant für die ${monatsLabel(daten.produktionsMonat)}-Produktion.`;
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

function zeichne(el, objekte, ctx) {
  const { istGastro } = ctx;

  if (!objekte.length) {
    el.innerHTML = `<div class="card card--pad empty-card">
      <div class="empty-emoji">${istGastro ? "📍" : "🏠"}</div>
      <p class="empty-title">${istGastro ? "Noch keine Filialen gemeldet" : "Noch keine Objekte gemeldet"}</p>
      <p class="muted">${istGastro ? "Sobald der Kunde eine Filiale meldet, erscheint sie hier." : "Sobald der Kunde ein Objekt meldet, erscheint es hier."}</p>
    </div>`;
    return;
  }

  // Nach Produktionsmonat gruppieren. Der aktuelle Monat existiert IMMER (auch
  // leer) — so „öffnet" sich am 1. automatisch die neue Sektion, ohne Backend.
  const aktuellerMonat = monatKey(new Date());
  const gruppen = new Map();
  objekte.forEach((o) => {
    const m = objektProduktionsMonat(o);
    if (!gruppen.has(m)) gruppen.set(m, []);
    gruppen.get(m).push(o);
  });
  if (!gruppen.has(aktuellerMonat)) gruppen.set(aktuellerMonat, []);

  // Laufende + kommende Produktion zuerst (aufsteigend), vergangene Monate
  // darunter (neueste zuerst).
  const keys = [...gruppen.keys()];
  const monate = keys.filter((m) => m >= aktuellerMonat).sort()
    .concat(keys.filter((m) => m < aktuellerMonat).sort().reverse());

  el.innerHTML = monate.map((m) => sektionHtml(m, gruppen.get(m), m === aktuellerMonat, ctx)).join("");

  // Monats-Sektionen auf-/zuklappen.
  el.querySelectorAll(".ob-monat-head").forEach((btn) => {
    btn.addEventListener("click", () => {
      const m = btn.closest(".ob-monat").getAttribute("data-monat");
      if (ctx.offeneMonate.has(m)) ctx.offeneMonate.delete(m);
      else ctx.offeneMonate.add(m);
      ctx.render();
    });
  });

  el.querySelectorAll(".ob-row").forEach((row) => {
    const id = row.getAttribute("data-id");
    const obj = objekte.find((x) => x.id === id);
    if (!obj) return;
    wireKarte(row, id, obj, ctx);
  });
}

function sektionHtml(m, objekte, istAktuell, ctx) {
  const offen = ctx.offeneMonate.has(m);
  const inhalt = objekte.length
    ? `<div class="ob-karten">${objekte.map((o) => kartenHtml(o, ctx)).join("")}</div>`
    : `<div class="card card--pad"><p class="muted" style="margin:0">Für diesen Monat ist noch nichts eingeplant.</p></div>`;
  return `
    <section class="ob-monat${offen ? " is-offen" : ""}" data-monat="${escapeHtml(m)}">
      <button class="ob-monat-head" type="button" title="${offen ? "Monat zuklappen" : "Monat aufklappen"}">
        <span class="ob-monat-chevron">▸</span>
        <span class="ob-monat-label">${escapeHtml(monatsLabel(m))}</span>
        ${istAktuell ? `<span class="ob-monat-jetzt">aktuelle Produktion</span>` : ""}
        <span class="ob-monat-n muted">${objekte.length} ${ctx.istGastro
          ? (objekte.length === 1 ? "Filiale" : "Filialen")
          : (objekte.length === 1 ? "Objekt" : "Objekte")}</span>
      </button>
      <div class="ob-monat-body"${offen ? "" : " hidden"}>${inhalt}</div>
    </section>`;
}

// Eine Karte pro Objekt — gleiche Feld-Optik wie das Melde-Formular des
// Kunden (Adresse, Objekttyp, Beschreibung, Link), read-only bis „Bearbeiten".
function kartenHtml(o, ctx) {
  const { istGastro, typen } = ctx;
  const imEdit = ctx.offenEdit.has(o.id);
  const prod   = objektProduktionsMonat(o);
  const melde  = objektMeldeMonat(o);

  const statusOpts = OBJEKT_STATUS_LISTE
    .map((s) => `<option value="${escapeHtml(s)}"${s === o.status ? " selected" : ""}>${escapeHtml(s)}</option>`)
    .join("");

  const koerper = imEdit
    ? `<form class="ob-edit-form">
         ${felderHtml(`obe-${escapeHtml(o.id)}-`, o, typen, istGastro, prod)}
         <div class="action-btns">
           <button class="btn btn--accent btn--sm ob-edit-save" type="submit">Speichern</button>
           <button class="btn btn--ghost btn--sm ob-edit-cancel" type="button">Abbrechen</button>
         </div>
       </form>`
    : `<div class="ob-felder">
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
         ${exposeHtml(o.expose)}
       </div>`;

  return `
    <section class="card card--pad ob-card ob-row" data-id="${escapeHtml(o.id)}">
      <div class="ob-card-kopf">
        <h2 class="ob-card-adresse">${istGastro ? "📍" : "🏠"} ${escapeHtml(o.adresse || "Ohne Adresse")}</h2>
        <select class="ob-status field-inline" aria-label="Status">${statusOpts}</select>
      </div>
      <p class="ob-herleitung muted">
        Gemeldet <strong>${escapeHtml(monatsLabel(melde))}</strong>
        <span class="ob-herleitung-pfeil" aria-hidden="true">→</span>
        Produktion <strong>${escapeHtml(monatsLabel(prod))}</strong>
        <select class="ob-monat-sel field-inline" aria-label="Produktionsmonat"
                title="In welchem Monat wird dieses ${istGastro ? "Filial-Video" : "Objekt"} produziert?">${monatOptionsHtml(prod)}</select>
      </p>
      ${koerper}
      <div class="ob-card-fuss action-btns">
        <button class="btn btn--accent btn--sm ob-video" type="button">+ Video anlegen</button>
        <button class="btn btn--ghost btn--sm ob-edit" type="button">${imEdit ? "Bearbeiten schließen" : "Bearbeiten"}</button>
        <button class="btn btn--ghost btn--sm ob-del" type="button" aria-label="Löschen">Löschen</button>
      </div>
    </section>`;
}

// Vom Kunden hochgeladenes Exposé. Die Datei liegt blockweise in Firestore
// (js/dateien.js), es gibt also keine fertige URL — sie wird erst auf Klick
// geholt und zusammengesetzt. Fehlt sie, entfällt die Zeile, damit Alt-Objekte
// unverändert aussehen.
function exposeHtml(expose) {
  if (!expose || !expose.dateiId) return "";
  const kb = Math.round((expose.groesse || 0) / 1024);
  const groesse = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
  return `
    <div class="ob-feld ob-feld--voll">
      <span class="ob-feld-label">Exposé (Original)</span>
      <button class="btn btn--ghost btn--sm ob-expose" type="button"
              data-datei="${escapeHtml(expose.dateiId)}">
        📎 ${escapeHtml(expose.name || "Exposé")} <span class="muted">· ${escapeHtml(groesse)}</span> anzeigen
      </button>
      <div class="ob-expose-ziel"></div>
    </div>`;
}

// Exposé auf Klick holen und in der Karte anzeigen (PDF im Rahmen, Bild direkt,
// Word als Textvorschau — zeigeDateiInline kann das alles), plus Download.
function wireExpose(row) {
  const btn = row.querySelector(".ob-expose");
  const ziel = row.querySelector(".ob-expose-ziel");
  if (!btn || !ziel) return;

  btn.addEventListener("click", async () => {
    if (ziel.dataset.offen === "1") {           // zweiter Klick = zuklappen
      ziel.innerHTML = "";
      ziel.dataset.offen = "";
      btn.classList.remove("is-aktiv");
      return;
    }
    btn.disabled = true;
    ziel.innerHTML = `<p class="muted" style="margin:.5rem 0 0;font-size:.85rem">Exposé wird geladen …</p>`;
    try {
      const datei = await ladeDatei(btn.dataset.datei);
      ziel.innerHTML = "";
      // Die blob:-URLs müssen beim View-Wechsel freigegeben werden.
      beiViewWechsel(zeigeDateiInline(ziel, datei));
      ziel.dataset.offen = "1";
      btn.classList.add("is-aktiv");
    } catch (e) {
      console.error("Exposé konnte nicht geladen werden:", e);
      ziel.innerHTML = `<p class="notice notice--error" style="margin:.5rem 0 0">
        Exposé konnte nicht geladen werden: ${escapeHtml(e.message || "unbekannter Fehler")}</p>`;
    } finally {
      btn.disabled = false;
    }
  });
}

function wireKarte(row, id, obj, ctx) {
  const sel       = row.querySelector(".ob-status");
  const monSel    = row.querySelector(".ob-monat-sel");
  const btnVideo  = row.querySelector(".ob-video");
  const btnEdit   = row.querySelector(".ob-edit");
  const btnDel    = row.querySelector(".ob-del");
  const editForm  = row.querySelector(".ob-edit-form");

  wireExpose(row);

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

  // 📅 Produktionsmonat umhängen — die Karte springt danach in die andere Sektion.
  monSel.addEventListener("change", async () => {
    monSel.disabled = true;
    try {
      await aktualisiereObjekt(id, { produktionsMonat: monSel.value });   // Observer zeichnet neu
    } catch (e) {
      console.error(e);
      alert("Produktionsmonat konnte nicht gespeichert werden.");
      monSel.disabled = false;
    }
  });

  btnVideo.addEventListener("click", () => {
    // Prefill für das Edit-Formular hinterlegen, dann zum Anlegen springen.
    // Den Monat liest admin-video-edit.js direkt aus dem Objekt.
    sessionStorage.setItem("neuesVideoObjekt", id);
    location.hash = "/admin/video/neu";
  });

  btnEdit.addEventListener("click", () => {
    if (ctx.offenEdit.has(id)) ctx.offenEdit.delete(id);
    else ctx.offenEdit.add(id);
    ctx.render();
  });

  if (editForm) {
    editForm.querySelector(".ob-edit-cancel").addEventListener("click", () => {
      ctx.offenEdit.delete(id);
      ctx.render();
    });
    editForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const daten = leseFelder(editForm);
      if (!daten.adresse) { alert("Bitte eine Adresse angeben."); return; }
      const save = editForm.querySelector(".ob-edit-save");
      save.disabled = true;
      try {
        await aktualisiereObjekt(id, daten);
        ctx.offenEdit.delete(id);
        ctx.render();
      } catch (ex) {
        console.error(ex);
        alert("Speichern fehlgeschlagen. Bitte erneut versuchen.");
        save.disabled = false;
      }
    });
  }

  btnDel.addEventListener("click", async () => {
    if (!confirm(`Objekt „${(obj && obj.adresse) || ""}" wirklich löschen? Das kann nicht rückgängig gemacht werden.`)) return;
    btnDel.disabled = true;
    try {
      // Erst die Datei-Blöcke, dann den Datensatz — sonst bliebe das Exposé als
      // Waise in `dateien` liegen, ohne Verweis, über den man es je wiederfindet.
      if (obj && obj.expose && obj.expose.dateiId) {
        try {
          await loescheDateiKomplett(obj.expose.dateiId);
        } catch (se) {
          // Fehlende/bereits gelöschte Datei darf das Löschen nicht blockieren.
          console.warn("Exposé konnte nicht entfernt werden:", se);
        }
      }
      await loescheObjekt(id);
    } catch (e) {
      console.error(e);
      alert("Löschen fehlgeschlagen.");
      btnDel.disabled = false;
    }
  });
}

function kurz(email) {
  return String(email || "").split("@")[0] || "Kunde";
}
