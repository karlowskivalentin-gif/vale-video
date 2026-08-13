// Admin-View: Personal Brand → Formate (Admin-only) — Route #/admin/formate
//
// Ein Format ist ein REZEPT, keine Linksammlung. Es beantwortet drei Fragen:
//   1. Bauplan     — welche Beats in welcher Reihenfolge (= Take-Gerüst)
//   2. Voraussetzung — brauche ich dafür Talking Head oder reicht Footage?
//   3. Beweis      — welche Referenzvideos zeigen, dass es funktioniert
//
// Punkt 1 ist der Grund, warum die Seite mehr ist als eine hübsche Galerie:
// beim Anlegen eines Skripts werden die Beats direkt zu Takes
// (brandplan.js → takesAusFormat, admin-brand.js → Format-Auswahl).
//
// Die Referenzvideos kommen bewusst aus den vorhandenen Inspirations-Cards
// (/admin/inspiration) — ein TikTok wird einmal gepflegt und kann in mehreren
// Formaten hängen. Zusätzliche Links gehen trotzdem direkt am Format.
import { ladeFormate, formatAnlegen, aktualisiereFormat, loescheFormat,
         beobachteInspirationen } from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { escapeHtml } from "../util.js";
import { embedHtml, verarbeiteEmbeds } from "../embeds.js";
import { PLATTFORMEN, GROESSEN, PERSPEKTIVEN, BEWEGUNGEN, AUFWAND,
         leererBeat, neueId, labelVon } from "../brandplan.js";

const FILTER = [
  { id: "alle",     label: "Alle" },
  { id: "footage",  label: "Ohne Talking Head" },
  { id: "talking",  label: "Mit Talking Head" }
];

export function renderAdminFormate(container, ctx = {}) {
  let formate = [];
  let inspirationen = [];
  let inspGeladen = false;
  let filter = "alle";
  let offen = (ctx.query && ctx.query.f) || null;   // aufgeklapptes Format

  container.innerHTML = `
    <div class="admin-head">
      <h1 class="view-title" style="margin:0">Formate</h1>
      <button class="btn btn--accent btn--sm" id="fmNeu" type="button">+ Neues Format</button>
    </div>
    <p class="muted view-intro">Deine Baupläne: Aufbau, Material-Bedarf und die Referenzvideos, die zeigen,
      dass es funktioniert. Beim Anlegen eines Skripts wählst du ein Format — seine Beats stehen dann
      sofort als Takes bereit.</p>
    <div class="insp-chips" id="fmChips">
      ${FILTER.map((f) => `<button class="insp-chip${f.id === "alle" ? " is-active" : ""}" data-f="${f.id}" type="button">${f.label}</button>`).join("")}
    </div>
    <div class="fm-liste" id="fmListe"><p class="muted">Lädt …</p></div>`;

  const liste = container.querySelector("#fmListe");

  container.querySelectorAll("#fmChips .insp-chip").forEach((c) => c.addEventListener("click", () => {
    filter = c.getAttribute("data-f");
    container.querySelectorAll("#fmChips .insp-chip").forEach((x) => x.classList.toggle("is-active", x === c));
    zeichne();
  }));

  const neuBtn = container.querySelector("#fmNeu");
  neuBtn.addEventListener("click", async () => {
    neuBtn.disabled = true;
    try {
      const ref = await formatAnlegen({
        name: "",
        // Ein leeres Format hilft niemandem — der Standard-Dreiklang steht
        // schon da und kann umbenannt oder gelöscht werden.
        beats: [leererBeat("Hook"), leererBeat("Kern"), leererBeat("CTA")]
      });
      const frisch = await ladeFormate();
      formate = frisch;
      offen = ref.id;
      zeichne();
      const el = liste.querySelector(`.fm-karte[data-id="${CSS.escape(ref.id)}"] input`);
      if (el) el.focus();
    } catch (e) {
      console.warn("Format anlegen fehlgeschlagen:", e);
      alert("Konnte nicht anlegen. Sind die Firestore-Rules für „formate“ veröffentlicht?");
    }
    neuBtn.disabled = false;
  });

  // --- Speichern (entprellt, pro Format) --------------------------------
  const timer = {};
  function speichere(f) {
    clearTimeout(timer[f.id]);
    timer[f.id] = setTimeout(() => {
      aktualisiereFormat(f.id, {
        name: f.name, beschreibung: f.beschreibung, plattformen: f.plattformen,
        talkingHead: f.talkingHead, materialBedarf: f.materialBedarf, aufwand: f.aufwand,
        beats: f.beats, hooks: f.hooks, inspirationIds: f.inspirationIds, links: f.links
      }).catch((e) => console.warn("Format speichern fehlgeschlagen:", e));
    }, 600);
  }
  beiViewWechsel(() => Object.values(timer).forEach(clearTimeout));

  function normalisiere(f) {
    f.name = f.name || "";
    f.beschreibung = f.beschreibung || "";
    f.plattformen = Array.isArray(f.plattformen) ? f.plattformen : [];
    f.talkingHead = f.talkingHead !== false;
    f.materialBedarf = f.materialBedarf || "";
    f.aufwand = f.aufwand || "mittel";
    f.beats = Array.isArray(f.beats) ? f.beats : [];
    f.hooks = Array.isArray(f.hooks) ? f.hooks : [];
    f.inspirationIds = Array.isArray(f.inspirationIds) ? f.inspirationIds : [];
    f.links = Array.isArray(f.links) ? f.links : [];
    return f;
  }

  // =====================================================================
  // Karte (zugeklappt = Steckbrief, aufgeklappt = Editor)
  // =====================================================================
  function karteHtml(f) {
    const auf = offen === f.id;
    const chips = [
      f.talkingHead === false ? "Kein Talking Head" : "Talking Head",
      labelVon(AUFWAND, f.aufwand),
      ...(f.plattformen || []).map((p) => labelVon(PLATTFORMEN, p)).filter(Boolean)
    ].filter(Boolean);
    const referenzen = (f.inspirationIds || []).length + (f.links || []).length;

    return `
      <article class="card fm-karte${auf ? " is-offen" : ""}" data-id="${escapeHtml(f.id)}">
        <div class="fm-kopf">
          <button class="fm-titel" type="button">${escapeHtml(f.name || "Neues Format")}</button>
          <span class="muted fm-sub">${f.beats.length} Beat${f.beats.length === 1 ? "" : "s"} ·
            ${referenzen} Referenz${referenzen === 1 ? "" : "en"}</span>
          <button class="gd-del fm-del" type="button" title="Format löschen">✕</button>
        </div>
        ${f.beschreibung && !auf ? `<p class="muted fm-beschr">${escapeHtml(f.beschreibung)}</p>` : ""}
        <div class="bs-chips">${chips.map((c) => `<span class="bs-chip">${escapeHtml(c)}</span>`).join("")}</div>
        ${f.materialBedarf && !auf ? `<p class="fm-material">🎞️ ${escapeHtml(f.materialBedarf)}</p>` : ""}
        ${auf ? editorHtml(f) : ""}
      </article>`;
  }

  function editorHtml(f) {
    return `
      <div class="fm-editor">
        <div class="grid-2">
          <label class="bs-feld">Name
            <input type="text" data-k="name" value="${escapeHtml(f.name)}" placeholder="z. B. Footage-Story" /></label>
          <label class="bs-feld">Aufwand
            <select data-k="aufwand">
              ${AUFWAND.map((a) => `<option value="${a.id}"${f.aufwand === a.id ? " selected" : ""}>${a.label}</option>`).join("")}
            </select></label>
        </div>
        <label class="bs-feld">Wofür ist das Format gut?
          <textarea data-k="beschreibung" rows="2" placeholder="Wann setze ich das ein, was ist der Effekt?">${escapeHtml(f.beschreibung)}</textarea></label>

        <div class="fm-block">
          <span class="bs-feld-titel">Voraussetzungen</span>
          <label class="bs-feld bs-feld--haken">
            <input type="checkbox" data-k="talkingHead" ${f.talkingHead ? "checked" : ""} /> Ich muss dafür vor die Kamera
          </label>
          <label class="bs-feld">Welches Material brauche ich?
            <input type="text" data-k="materialBedarf" value="${escapeHtml(f.materialBedarf)}"
              placeholder="z. B. 30 Sek. B-Roll vom Dreh, Screen-Recording, fertiger Kundenclip" /></label>
          <div class="fm-plattformen">
            <span class="muted">Passt für:</span>
            ${PLATTFORMEN.map((p) => `
              <label class="fm-plat"><input type="checkbox" data-plat="${p.id}"
                ${f.plattformen.includes(p.id) ? "checked" : ""} /> ${p.label}</label>`).join("")}
          </div>
        </div>

        <div class="fm-block">
          <span class="bs-feld-titel">Bauplan — wird beim neuen Skript zum Take-Gerüst</span>
          <div class="fm-beats">
            ${f.beats.map((b, i) => beatHtml(b, i, f.beats.length)).join("")}
          </div>
          <button class="btn btn--ghost btn--sm fm-beat-neu" type="button">+ Beat</button>
        </div>

        <div class="fm-block">
          <span class="bs-feld-titel">Hook-Vorlagen</span>
          <p class="muted" style="margin:.2rem 0 .5rem">Beim Schreiben eines Skripts mit diesem Format per Klick einfügbar.</p>
          <div class="fm-hooks">
            ${f.hooks.map((h, i) => `
              <div class="fm-hook" data-i="${i}">
                <input type="text" data-hook="${i}" value="${escapeHtml(h.text || "")}" placeholder="„Ich hab drei Jahre lang …“" />
                <button class="gd-del fm-hook-del" type="button" data-i="${i}" title="Vorlage löschen">✕</button>
              </div>`).join("")}
          </div>
          <button class="btn btn--ghost btn--sm fm-hook-neu" type="button">+ Hook-Vorlage</button>
        </div>

        <div class="fm-block">
          <span class="bs-feld-titel">Referenzvideos</span>
          ${inspGeladen ? inspAuswahlHtml(f) : `<p class="muted">Inspirationen werden geladen …</p>`}
          <div class="fm-links">
            ${f.links.map((l, i) => `
              <div class="fm-link" data-i="${i}">
                <input type="url" data-link="${i}" value="${escapeHtml(l.url || "")}" placeholder="https://tiktok.com/…" />
                <button class="gd-del fm-link-del" type="button" data-i="${i}" title="Link entfernen">✕</button>
              </div>`).join("")}
          </div>
          <button class="btn btn--ghost btn--sm fm-link-neu" type="button">+ Eigener Link</button>
          ${vorschauHtml(f)}
        </div>
      </div>`;
  }

  function beatHtml(b, i, anzahl) {
    const sel = (feld, liste) => `
      <select data-beat="${i}" data-bf="${feld}">
        <option value="">—</option>
        ${liste.map((o) => `<option value="${o.id}"${b[feld] === o.id ? " selected" : ""}>${o.label}</option>`).join("")}
      </select>`;
    return `
      <div class="fm-beat" data-i="${i}">
        <div class="fm-beat-kopf">
          <span class="fm-beat-nr">${i + 1}</span>
          <input class="fm-beat-label" type="text" data-beat="${i}" data-bf="label"
            value="${escapeHtml(b.label || "")}" placeholder="Beat-Name (Hook, Kern, CTA …)" />
          <button class="fm-beat-hoch" type="button" data-i="${i}" ${i === 0 ? "disabled" : ""} title="nach oben">↑</button>
          <button class="fm-beat-runter" type="button" data-i="${i}" ${i === anzahl - 1 ? "disabled" : ""} title="nach unten">↓</button>
          <button class="gd-del fm-beat-del" type="button" data-i="${i}" title="Beat löschen">✕</button>
        </div>
        <input class="fm-beat-hinweis" type="text" data-beat="${i}" data-bf="hinweis"
          value="${escapeHtml(b.hinweis || "")}" placeholder="Was passiert hier? (wird zur Take-Notiz)" />
        <div class="fm-beat-felder">
          ${sel("groesse", GROESSEN)}
          ${sel("perspektive", PERSPEKTIVEN)}
          ${sel("bewegung", BEWEGUNGEN)}
          <input class="fm-beat-dauer" type="number" data-beat="${i}" data-bf="dauer"
            value="${b.dauer == null ? "" : escapeHtml(b.dauer)}" placeholder="Sek." min="0" />
        </div>
      </div>`;
  }

  function inspAuswahlHtml(f) {
    if (!inspirationen.length) {
      return `<p class="muted">Noch keine Inspirationen gepflegt —
        <a href="#/admin/inspiration">dort anlegen</a>, dann kannst du sie hier anhängen.</p>`;
    }
    return `
      <div class="fm-insp-wahl">
        ${inspirationen.map((i) => `
          <label class="fm-insp-opt${f.inspirationIds.includes(i.id) ? " is-an" : ""}">
            <input type="checkbox" data-insp="${escapeHtml(i.id)}" ${f.inspirationIds.includes(i.id) ? "checked" : ""} />
            <span class="fm-insp-titel">${escapeHtml(i.titel || "Ohne Titel")}</span>
            <span class="muted fm-insp-kat">${escapeHtml(i.kategorie || "")}</span>
          </label>`).join("")}
      </div>`;
  }

  function vorschauHtml(f) {
    const urls = [
      ...f.inspirationIds
        .map((iid) => inspirationen.find((x) => x.id === iid))
        .filter(Boolean)
        .map((i) => i.url),
      ...f.links.map((l) => l.url)
    ].filter((u) => String(u || "").trim());
    if (!urls.length) return "";
    return `<div class="fm-vorschau">${urls.map((u) => `<div class="insp-embed">${embedHtml(u)}</div>`).join("")}</div>`;
  }

  // =====================================================================
  function zeichne() {
    const gefiltert = formate.filter((f) => {
      if (filter === "footage") return f.talkingHead === false;
      if (filter === "talking") return f.talkingHead !== false;
      return true;
    });

    if (!gefiltert.length) {
      liste.innerHTML = `<div class="card card--pad empty-card">
        <div class="empty-emoji">🧩</div>
        <p class="empty-title">${formate.length ? "Nichts in diesem Filter" : "Noch kein Format"}</p>
        <p class="muted">Ein Format ist dein Bauplan: Aufbau, was du dafür brauchst, und die Videos,
          an denen du dich orientierst.</p>
      </div>`;
      return;
    }

    liste.innerHTML = gefiltert.map(karteHtml).join("");
    const offeneKarte = liste.querySelector(".fm-karte.is-offen");
    if (offeneKarte) verarbeiteEmbeds(offeneKarte);

    liste.querySelectorAll(".fm-karte").forEach((karte) => {
      const fid = karte.getAttribute("data-id");
      const f = formate.find((x) => x.id === fid);
      if (!f) return;

      karte.querySelector(".fm-titel").addEventListener("click", () => {
        offen = offen === fid ? null : fid;
        zeichne();
      });

      const del = karte.querySelector(".fm-del");
      del.addEventListener("click", async () => {
        if (!del.classList.contains("is-bestaetigen")) {
          del.classList.add("is-bestaetigen"); del.textContent = "Löschen?";
          return;
        }
        try {
          await loescheFormat(fid);
          formate = formate.filter((x) => x.id !== fid);
          if (offen === fid) offen = null;
          zeichne();
        } catch (e) { console.warn("Löschen fehlgeschlagen:", e); }
      });

      if (offen !== fid) return;

      // --- Einfache Felder ------------------------------------------------
      karte.querySelectorAll("[data-k]").forEach((el) => {
        const k = el.getAttribute("data-k");
        const ereignis = (el.type === "checkbox" || el.tagName === "SELECT") ? "change" : "input";
        el.addEventListener(ereignis, () => {
          f[k] = el.type === "checkbox" ? el.checked : el.value;
          if (k === "name") {
            const titel = karte.querySelector(".fm-titel");
            if (titel) titel.textContent = f.name || "Neues Format";
          }
          speichere(f);
        });
      });

      karte.querySelectorAll("[data-plat]").forEach((el) => el.addEventListener("change", () => {
        const p = el.getAttribute("data-plat");
        f.plattformen = el.checked
          ? [...new Set([...f.plattformen, p])]
          : f.plattformen.filter((x) => x !== p);
        speichere(f);
      }));

      // --- Beats ----------------------------------------------------------
      karte.querySelectorAll("[data-beat]").forEach((el) => {
        const i = Number(el.getAttribute("data-beat"));
        const bf = el.getAttribute("data-bf");
        const ereignis = el.tagName === "SELECT" ? "change" : "input";
        el.addEventListener(ereignis, () => {
          if (!f.beats[i]) return;
          f.beats[i][bf] = bf === "dauer" ? (el.value === "" ? null : Number(el.value)) : el.value;
          speichere(f);
        });
      });
      karte.querySelector(".fm-beat-neu").addEventListener("click", () => {
        f.beats.push(leererBeat(""));
        speichere(f); zeichne();
      });
      karte.querySelectorAll(".fm-beat-del").forEach((b) => b.addEventListener("click", () => {
        f.beats.splice(Number(b.getAttribute("data-i")), 1);
        speichere(f); zeichne();
      }));
      karte.querySelectorAll(".fm-beat-hoch").forEach((b) => b.addEventListener("click", () => {
        const i = Number(b.getAttribute("data-i"));
        if (i > 0) { const [x] = f.beats.splice(i, 1); f.beats.splice(i - 1, 0, x); speichere(f); zeichne(); }
      }));
      karte.querySelectorAll(".fm-beat-runter").forEach((b) => b.addEventListener("click", () => {
        const i = Number(b.getAttribute("data-i"));
        if (i < f.beats.length - 1) { const [x] = f.beats.splice(i, 1); f.beats.splice(i + 1, 0, x); speichere(f); zeichne(); }
      }));

      // --- Hooks ----------------------------------------------------------
      karte.querySelectorAll("[data-hook]").forEach((el) => el.addEventListener("input", () => {
        const i = Number(el.getAttribute("data-hook"));
        if (f.hooks[i]) { f.hooks[i].text = el.value; speichere(f); }
      }));
      karte.querySelector(".fm-hook-neu").addEventListener("click", () => {
        f.hooks.push({ hid: neueId("h"), text: "" });
        speichere(f); zeichne();
      });
      karte.querySelectorAll(".fm-hook-del").forEach((b) => b.addEventListener("click", () => {
        f.hooks.splice(Number(b.getAttribute("data-i")), 1);
        speichere(f); zeichne();
      }));

      // --- Referenzen -----------------------------------------------------
      karte.querySelectorAll("[data-insp]").forEach((el) => el.addEventListener("change", () => {
        const iid = el.getAttribute("data-insp");
        f.inspirationIds = el.checked
          ? [...new Set([...f.inspirationIds, iid])]
          : f.inspirationIds.filter((x) => x !== iid);
        speichere(f); zeichne();
      }));
      karte.querySelectorAll("[data-link]").forEach((el) => el.addEventListener("change", () => {
        const i = Number(el.getAttribute("data-link"));
        let u = (el.value || "").trim();
        if (u && !/^https?:\/\//i.test(u)) u = "https://" + u;
        if (f.links[i]) { f.links[i].url = u; speichere(f); zeichne(); }
      }));
      karte.querySelector(".fm-link-neu").addEventListener("click", () => {
        f.links.push({ url: "" });
        speichere(f); zeichne();
      });
      karte.querySelectorAll(".fm-link-del").forEach((b) => b.addEventListener("click", () => {
        f.links.splice(Number(b.getAttribute("data-i")), 1);
        speichere(f); zeichne();
      }));
    });
  }

  // --- Laden ------------------------------------------------------------
  (async function laden() {
    try {
      formate = (await ladeFormate()).map(normalisiere);
      zeichne();
    } catch (e) {
      console.warn("Formate laden fehlgeschlagen:", e);
      liste.innerHTML = `<div class="card card--pad"><p class="notice notice--error" style="margin:0">
        Konnte nicht laden — sind die Firestore-Rules für „formate" veröffentlicht?</p></div>`;
    }
  })();

  // Inspirations-Cards zur Auswahl. Nur der ERSTE Snapshot löst ein Neuzeichnen
  // aus — danach würde ein Re-Render die gerade getippte Eingabe zerstören.
  const unsub = beobachteInspirationen((l) => {
    inspirationen = l;
    if (!inspGeladen) { inspGeladen = true; if (formate.length) zeichne(); }
  }, (e) => { console.warn("Inspirationen laden fehlgeschlagen:", e); inspGeladen = true; });
  beiViewWechsel(unsub);
}
