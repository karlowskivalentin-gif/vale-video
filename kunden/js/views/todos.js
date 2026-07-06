// To-Do-Liste (map-übergreifend, Admin + Kollaborator).
// Zwei Modi über opts.modus:
//   "todo"   (Default) — anstehende To-Dos (todo=true)
//   "sticky"           — 📌 Sticky Notes (sticky=true): spontane offene
//                        Fragestellungen; eigene Reihenfolge (stickyReihenfolge),
//                        sonst identische Logik (Filter, Kategorien, ↑↓,
//                        Split-View, Zuweisung, Abhaken wirkt in der Mindmap).
// Zeigt AUSSCHLIESSLICH anstehende Einträge (nicht erledigt, nicht
// archiviert):
//   1) Übersicht über alle eigenen Maps (Filter: Alle | Mir zugewiesen |
//      Nicht zugewiesen)
//   2) gruppiert pro Mindmap.
// Pro To-Do lässt sich der Verantwortliche wählen (Mitglieder der Map, "" =
// niemand). Abhaken markiert den Gedanken als erledigt — wirkt direkt in der
// Mindmap (dort dann per „→ Archiv" ablegbar).
// Privatsphäre: Es erscheinen nur Maps, auf die der Nutzer Zugriff hat —
// beim Kollaborator erzwingen das zusätzlich die Firestore-Rules (er kann
// fremde Maps gar nicht erst laden).
import { beobachteGedanken, aktualisiereGedanke, beobachteMindmaps,
         beobachteMeineMindmaps, ladeMindmap } from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { escapeHtml, mdZuHtml } from "../util.js";

const DEFAULT_MAP = "default";
const lc = (s) => String(s || "").toLowerCase();

export function renderTodos(container, opts) {
  const rolle = (opts && opts.rolle) || "admin";
  const istKollab = rolle === "kollaborator";
  const meineEmail = lc(opts && opts.user && opts.user.email);
  const kollabMapId = (opts && opts.kollabMapId) || null;
  const modus = (opts && opts.modus) === "sticky" ? "sticky" : "todo";
  const istSticky = modus === "sticky";
  const FELD = istSticky ? "stickyReihenfolge" : "reihenfolge";   // getrennte manuelle Reihenfolgen

  let mindmaps = [];          // sichtbare Map-Definitionen
  let kollabMapDoc = null;    // Kollaborator: Doc der geteilten Map
  let filter = "alle";        // "alle" | "meine" | "offen"
  const daten = new Map();    // id → Gedanke
  const unsubs = [];          // globale Abos
  const mapAbos = new Map();  // Kollaborator: mapId → Gedanken-Abo

  container.innerHTML = `
    <div class="admin-head admin-head--todos">
      <h1 class="view-title" style="margin:0">${istSticky ? "Sticky Notes" : "To-Dos"}</h1>
      <select class="gd-filter" id="todoKat" aria-label="Nach Kategorie (Sub/Bereich) filtern">
        <option value="">Alle Kategorien</option>
      </select>
      <select class="gd-filter" id="todoFilter" aria-label="Einträge filtern">
        <option value="alle">Alle</option>
        <option value="meine">Mir zugewiesen</option>
        <option value="offen">Nicht zugewiesen</option>
      </select>
    </div>
    <p class="muted view-intro">${istSticky
      ? "Deine 📌 Sticky Notes aus allen Mindmaps — spontane Fragestellungen, die noch beantwortet, definiert oder ausgeführt werden müssen. Abhaken erledigt sie auch in der Mindmap; am Griff ⠿ ziehen sortiert und ändert die Dringlichkeit; Doppelklick öffnet die Note in voller Länge neben der Liste."
      : "Alle anstehenden To-Dos aus deinen Mindmaps an einem Ort. Abhaken erledigt sie auch in der Mindmap; am Griff ⠿ ziehen sortiert und ändert die Dringlichkeit; Doppelklick öffnet das To-Do in voller Länge neben der Liste."}
      Die Kategorien sind deine Subs/Bereiche — ein Eintrag gehört dazu, wenn er damit verbunden ist.</p>
    <div class="todo-split" id="todoSplit">
      <div id="todoBody"><p class="muted">Lädt…</p></div>
      <aside class="todo-detail" id="todoDetail" hidden aria-label="To-Do-Detail"></aside>
    </div>`;
  const body = container.querySelector("#todoBody");
  const split = container.querySelector("#todoSplit");
  const detail = container.querySelector("#todoDetail");
  let detailId = null;   // aktuell im Split-Panel geöffnetes To-Do
  const katSelect = container.querySelector("#todoKat");
  let katFilter = "";   // Gedanken-Id des gewählten Subs/Bereichs ("" = alle)
  container.querySelector("#todoFilter").addEventListener("change", (e) => { filter = e.target.value; render(); });
  katSelect.addEventListener("change", () => { katFilter = katSelect.value; render(); });

  // Kategorien = ALLE Subs/Bereiche der sichtbaren Maps (automatisch, kein
  // 🎯-Häkchen mehr) — dieselbe Logik wie im Fokus-Session-Dropdown.
  function kategorien() {
    const mapIds = new Set(meineMaps().map((m) => m.id));
    return [...daten.values()]
      .filter((g) => (g.ebene === "sub" || g.ebene === "bereich" || g.ebene === "untersub") && !g.archiviert
        && mapIds.has(g.mapId || DEFAULT_MAP))
      .map((g) => ({ id: g.id, name: (g.text || "Unbenannt").trim() || "Unbenannt" }))
      .sort((a, b) => a.name.localeCompare(b.name, "de"));
  }
  function renderKatSelect() {
    const aktuell = katSelect.value;
    katSelect.innerHTML = `<option value="">Alle Kategorien</option>` +
      kategorien().map((k) => `<option value="${escapeHtml(k.id)}"${k.id === aktuell ? " selected" : ""}>🎯 ${escapeHtml(k.name)}</option>`).join("");
    if (aktuell && ![...katSelect.options].some((o) => o.value === aktuell)) { katFilter = ""; katSelect.value = ""; }
  }
  // Gehört das To-Do zur gewählten Kategorie (Verbindung in eine Richtung)?
  function passtKategorie(g) {
    if (!katFilter) return true;
    const kat = daten.get(katFilter);
    if (!kat) return true;
    return (kat.verbindungen || []).includes(g.id) || (g.verbindungen || []).includes(katFilter);
  }

  // Maps, die dieser Nutzer sieht: Admin = Standard + Mitglieds-Maps
  // (Altbestände ohne mitglieder-Feld gehören ihm; fremde private Maps NICHT).
  // Kollaborator = geteilte Map + selbst angelegte.
  function meineMaps() {
    if (!istKollab) {
      const eigene = mindmaps.filter((m) => !Array.isArray(m.mitglieder) || m.mitglieder.map(lc).includes(meineEmail));
      return [{ id: DEFAULT_MAP, name: "Standard" }, ...eigene];
    }
    const arr = [...mindmaps];
    if (kollabMapId && !arr.some((m) => m.id === kollabMapId)) {
      arr.unshift({ id: kollabMapId, name: (kollabMapDoc && kollabMapDoc.name) || "Geteilte Map", ...(kollabMapDoc || {}) });
    }
    return arr;
  }
  // Wählbare Verantwortliche einer Map = ihre Mitglieder (+ Besitzer + ich).
  function nutzerFuerMap(m) {
    const set = new Set([meineEmail]);
    (m && Array.isArray(m.mitglieder) ? m.mitglieder : []).forEach((e) => set.add(lc(e)));
    if (m && m.besitzer) set.add(lc(m.besitzer));
    return [...set].filter(Boolean);
  }
  const istOffen = (g) => (istSticky ? g.sticky === true : g.todo === true) && !g.erledigt && !g.archiviert;
  const passtFilter = (g) => filter === "alle"
    || (filter === "meine" && lc(g.verantwortlich) === meineEmail)
    || (filter === "offen" && !g.verantwortlich);

  // Manuelle Reihenfolge (②): kleiner = weiter oben; ohne Wert ans Ende.
  // ❗ Dringliche bleiben immer als Block ganz oben fixiert.
  const ordnung = (g) => (Number.isFinite(g[FELD]) ? g[FELD] : Infinity);
  const vergleich = (a, b) =>
    ((b.dringend === true ? 1 : 0) - (a.dringend === true ? 1 : 0))
    || (ordnung(a) - ordnung(b))
    || (a.text || "").localeCompare(b.text || "", "de");

  function offeneListe() {
    const maps = meineMaps();
    const mapVon = (g) => maps.find((m) => m.id === (g.mapId || DEFAULT_MAP)) || null;
    return [...daten.values()]
      .filter((g) => istOffen(g) && mapVon(g) && passtFilter(g) && passtKategorie(g))
      .sort(vergleich);
  }

  // --- Drag & Drop: freies Sortieren + Dringlichkeit per Ziehen (②) --------
  // Am Griff (⠿) mit der Maus/dem Finger ziehen → das Element folgt live an
  // die gewünschte Position; zwischen den beiden Zonen „Dringlich" / „Anstehend"
  // ziehen setzt/entfernt das Dringlich-Flag. Beim Loslassen wird die neue
  // Reihenfolge (FELD) + dringend geschrieben — wirkt überall (Mindmap, Fokus).
  let istDragging = false;
  function starteDrag(handle, ev) {
    const li = handle.closest(".todo-item");
    if (!li) return;
    ev.preventDefault();
    istDragging = true;
    li.classList.add("is-dragging");
    try { handle.setPointerCapture(ev.pointerId); } catch (_) { /* egal */ }

    const zonen = () => [...body.querySelectorAll(".todo-uebersicht .todo-liste[data-zone]")];

    const move = (e) => {
      const y = e.clientY, x = e.clientX;
      // Ziel-Zone bestimmen (Element unter dem Cursor, sonst per Y der Zonen-Box).
      let zoneUl = null;
      const unter = document.elementFromPoint(x, y);
      if (unter && unter.closest) zoneUl = unter.closest(".todo-liste[data-zone]");
      if (!zoneUl) {
        const zs = zonen();
        zoneUl = zs.find((z) => { const r = z.closest(".todo-zone").getBoundingClientRect(); return y < r.bottom; }) || zs[zs.length - 1];
      }
      if (!zoneUl) return;
      const items = [...zoneUl.querySelectorAll(".todo-item")].filter((it) => it !== li);
      const nach = items.find((it) => { const r = it.getBoundingClientRect(); return y < r.top + r.height / 2; });
      const leer = zoneUl.querySelector(".todo-zone-leer");
      if (leer) leer.remove();
      if (nach) zoneUl.insertBefore(li, nach);
      else zoneUl.appendChild(li);
    };

    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      li.classList.remove("is-dragging");
      istDragging = false;
      // Neue Reihenfolge + Dringlichkeit aus dem finalen DOM ableiten.
      const schreiben = [];
      let idx = 0;
      for (const zoneUl of zonen()) {
        const dringend = zoneUl.getAttribute("data-zone") === "dringend";
        for (const it of zoneUl.querySelectorAll(".todo-item")) {
          const gid = it.getAttribute("data-id");
          const g = daten.get(gid);
          if (!g) continue;
          const felder = {};
          if (g[FELD] !== idx) { g[FELD] = idx; felder[FELD] = idx; }
          if ((g.dringend === true) !== dringend) { g.dringend = dringend; felder.dringend = dringend; }
          if (Object.keys(felder).length) schreiben.push(aktualisiereGedanke(gid, felder).catch((e) => console.warn("Sortieren speichern fehlgeschlagen:", e)));
          idx++;
        }
      }
      render();               // sauber neu aufbauen (Reihenfolge + ❗-Markierung)
      Promise.all(schreiben); // im Hintergrund; Snapshots bestätigen
    };

    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  function itemHtml(g, map, mitDrag) {
    const nutzer = nutzerFuerMap(map);
    const wer = lc(g.verantwortlich);
    const dringend = g.dringend === true;
    const griff = mitDrag
      ? `<span class="todo-drag" title="Ziehen: sortieren oder Dringlichkeit ändern" aria-label="Verschieben">⠿</span>`
      : "";
    return `
      <li class="todo-item${istSticky ? " is-sticky" : ""}${dringend ? " is-dringend" : ""}${g.id === detailId ? " is-detail" : ""}" data-id="${escapeHtml(g.id)}" title="Doppelklick: voll öffnen">
        ${griff}
        <input type="checkbox" class="todo-check" data-id="${escapeHtml(g.id)}" title="Erledigen (wirkt auch in der Mindmap)">
        <div class="todo-haupt">
          <span class="todo-text">${dringend ? "❗ " : ""}${escapeHtml(g.text || "Unbenannter Gedanke")}</span>
          <span class="todo-meta muted">🗺 ${escapeHtml(map ? map.name : "")}${g.detail && g.detail.trim() ? " · 📝" : ""}</span>
        </div>
        <select class="todo-wer" data-id="${escapeHtml(g.id)}" title="Verantwortlich">
          <option value="">– niemand –</option>
          ${nutzer.map((n) => `<option value="${escapeHtml(n)}"${n === wer ? " selected" : ""}>${escapeHtml(n === meineEmail ? `Ich (${n})` : n)}</option>`).join("")}
        </select>
      </li>`;
  }

  function render() {
    if (istDragging) return;   // laufendes Drag nicht durch Re-Render zerstören
    renderKatSelect();
    const maps = meineMaps();
    const mapVon = (g) => maps.find((m) => m.id === (g.mapId || DEFAULT_MAP)) || null;
    const offene = offeneListe();

    if (!offene.length) {
      body.innerHTML = `<p class="muted">${istSticky
        ? `Keine offenen Sticky Notes${filter !== "alle" ? " für diesen Filter" : ""}. 📌 Markiere einen Gedanken in der Mindmap mit 📌, damit er hier auftaucht.`
        : `Keine anstehenden To-Dos${filter !== "alle" ? " für diesen Filter" : ""}. 🎉`}</p>`;
      aktualisiereDetail();
      return;
    }

    const dringliche = offene.filter((g) => g.dringend === true);
    const normale    = offene.filter((g) => g.dringend !== true);

    const gruppen = maps
      .map((m) => ({ map: m, items: offene.filter((g) => (g.mapId || DEFAULT_MAP) === m.id) }))
      .filter((x) => x.items.length);

    body.innerHTML = `
      <section class="todo-uebersicht card card--pad">
        <h2 class="todo-h2">${istSticky ? "📌" : "🎯"} Übersicht · ${offene.length} offen</h2>
        <p class="todo-drag-hint muted">Am Griff ⠿ ziehen, um zu sortieren — oder zwischen „Dringlich" und „Anstehend" verschieben.</p>
        <div class="todo-zone todo-zone--dringend">
          <div class="todo-zone-kopf">❗ Dringlich</div>
          <ul class="todo-liste" data-zone="dringend">${
            dringliche.map((g) => itemHtml(g, mapVon(g), true)).join("")
            || `<li class="todo-zone-leer">Hierher ziehen, um „dringlich" zu markieren</li>`}</ul>
        </div>
        <div class="todo-zone todo-zone--normal">
          <div class="todo-zone-kopf">Anstehend</div>
          <ul class="todo-liste" data-zone="normal">${
            normale.map((g) => itemHtml(g, mapVon(g), true)).join("")
            || `<li class="todo-zone-leer">—</li>`}</ul>
        </div>
      </section>
      <h2 class="todo-h2" style="margin-top:1.5rem">Pro Mindmap</h2>
      ${gruppen.map((x) => `
        <section class="todo-gruppe">
          <h3 class="todo-h3">🗺 ${escapeHtml(x.map.name)} <span class="muted">(${x.items.length})</span></h3>
          <ul class="todo-liste">${x.items.map((g) => itemHtml(g, x.map, false)).join("")}</ul>
        </section>`).join("")}`;

    body.querySelectorAll(".todo-check").forEach((cb) => cb.addEventListener("change", async () => {
      const id = cb.getAttribute("data-id");
      cb.disabled = true;
      try {
        const g = daten.get(id); if (g) g.erledigt = true;
        await aktualisiereGedanke(id, { erledigt: true });
        render();
      } catch (e) {
        console.warn("Erledigen fehlgeschlagen:", e);
        cb.checked = false; cb.disabled = false;
      }
    }));
    body.querySelectorAll(".todo-wer").forEach((sel) => sel.addEventListener("change", async () => {
      const id = sel.getAttribute("data-id");
      const wert = sel.value;
      try {
        const g = daten.get(id); if (g) g.verantwortlich = wert;
        await aktualisiereGedanke(id, { verantwortlich: wert });
        render();
      } catch (e) { console.warn("Zuweisen fehlgeschlagen:", e); }
    }));
    // Drag & Drop am Griff (②) — sortieren + Dringlichkeit ändern
    body.querySelectorAll(".todo-drag").forEach((h) => {
      h.addEventListener("pointerdown", (e) => { if (e.button === 0 || e.pointerType !== "mouse") starteDrag(h, e); });
    });
    // Doppelklick → volles To-Do im Split-Panel (④)
    body.querySelectorAll(".todo-item").forEach((li) => li.addEventListener("dblclick", (e) => {
      if (e.target.closest("input, select, button")) return;
      oeffneDetail(li.getAttribute("data-id"));
    }));

    aktualisiereDetail();
  }

  // --- Split-Panel: volles To-Do neben der Liste (④) ----------------------
  function schliesseDetail() {
    detailId = null;
    detail.hidden = true; detail.innerHTML = "";
    split.classList.remove("has-detail");
    body.querySelectorAll(".todo-item.is-detail").forEach((li) => li.classList.remove("is-detail"));
  }
  function oeffneDetail(id) {
    if (!id) return;
    detailId = id;
    renderDetail();
    body.querySelectorAll(".todo-item").forEach((li) => li.classList.toggle("is-detail", li.getAttribute("data-id") === id));
  }
  // Nach jedem Listen-Render: Panel nachziehen (außer man tippt gerade darin).
  function aktualisiereDetail() {
    if (!detailId) return;
    if (detail.contains(document.activeElement)) return;
    renderDetail();
  }
  function renderDetail() {
    const g = daten.get(detailId);
    if (!g || !istOffen(g)) { schliesseDetail(); return; }
    const map = meineMaps().find((m) => m.id === (g.mapId || DEFAULT_MAP)) || null;
    split.classList.add("has-detail");
    detail.hidden = false;
    detail.innerHTML = `
      <div class="todo-detail-kopf">
        <span class="todo-detail-crumb muted">${istSticky ? "📌 Sticky Note" : "To-Do"}</span>
        <button type="button" class="todo-detail-zu" title="Schließen">✕</button>
      </div>
      <h2 class="todo-detail-titel">${g.dringend === true ? "❗ " : ""}${escapeHtml(g.text || "Unbenannter Gedanke")}</h2>
      <div class="todo-detail-meta muted">🗺 ${escapeHtml(map ? map.name : "")}${g.verantwortlich ? ` · 👤 ${escapeHtml(g.verantwortlich)}` : ""}</div>
      <div class="gd-abschnitt-titel" style="margin-top:.9rem">Ausführung</div>
      <div class="todo-detail-md" id="tdMd"></div>
      <div class="action-btns" style="margin-top:1.1rem">
        <button type="button" class="btn btn--accent btn--sm" id="tdErledigt">✓ Erledigen</button>
      </div>`;
    detail.querySelector(".todo-detail-zu").addEventListener("click", schliesseDetail);
    // Ausführung: Markdown-Vorschau; Klick → Bearbeiten; Blur → speichern
    // (gleiches Muster wie in der Mindmap).
    const md = detail.querySelector("#tdMd");
    const zeigePreview = () => {
      const cur = (daten.get(detailId) || {}).detail || "";
      md.innerHTML = `<div class="gd-md-preview">${cur ? mdZuHtml(cur) : `<span class="gd-md-leer muted">＋ Ausführung hinzufügen … (Markdown)</span>`}</div>`;
      md.querySelector(".gd-md-preview").addEventListener("click", zeigeEdit);
    };
    const zeigeEdit = () => {
      md.innerHTML = "";
      const ta = document.createElement("textarea");
      ta.className = "gd-detail todo-detail-edit";
      ta.placeholder = "Ausführung … (Markdown: # Titel, **fett**, - Liste, [Text](url))";
      ta.value = (daten.get(detailId) || {}).detail || "";
      md.appendChild(ta);
      const wachse = () => { ta.style.height = "auto"; ta.style.height = Math.max(140, ta.scrollHeight) + "px"; };
      wachse();
      ta.addEventListener("input", wachse);
      ta.addEventListener("blur", () => {
        const val = ta.value;
        const g2 = daten.get(detailId); if (g2) g2.detail = val;
        aktualisiereGedanke(detailId, { detail: val }).catch((e) => console.warn(e));
        zeigePreview();
      });
      ta.focus();
    };
    zeigePreview();
    detail.querySelector("#tdErledigt").addEventListener("click", async () => {
      const id = detailId;
      const g2 = daten.get(id); if (g2) g2.erledigt = true;
      try { await aktualisiereGedanke(id, { erledigt: true }); }
      catch (e) { console.warn("Erledigen fehlgeschlagen:", e); }
      schliesseDetail();
      render();
    });
  }

  // --- Daten-Abos --------------------------------------------------------
  if (!istKollab) {
    unsubs.push(beobachteMindmaps((l) => { mindmaps = l; render(); }, () => {}));
    unsubs.push(beobachteGedanken(
      (l) => { daten.clear(); l.forEach((g) => daten.set(g.id, g)); render(); },
      (e) => { console.warn("To-Dos laden fehlgeschlagen:", e); body.innerHTML = `<p class="muted">Konnte die To-Dos nicht laden.</p>`; }
    ));
  } else {
    // Kollaborator: pro Map eine gefilterte Query (Rules verbieten "alle").
    ladeMindmap(kollabMapId).then((d) => { kollabMapDoc = d; syncMapAbos(); render(); }).catch(() => {});
    unsubs.push(beobachteMeineMindmaps(meineEmail, (l) => { mindmaps = l; syncMapAbos(); render(); }, () => {}));
    syncMapAbos();
  }
  function syncMapAbos() {
    const ids = new Set(meineMaps().map((m) => m.id));
    for (const [mid, un] of mapAbos) if (!ids.has(mid)) { try { un(); } catch (_) { /* egal */ } mapAbos.delete(mid); }
    for (const mid of ids) if (!mapAbos.has(mid)) {
      mapAbos.set(mid, beobachteGedanken((l) => {
        for (const [id, g] of daten) if ((g.mapId || DEFAULT_MAP) === mid) daten.delete(id);
        l.forEach((g) => daten.set(g.id, g));
        render();
      }, () => {}, mid));
    }
  }

  beiViewWechsel(() => {
    unsubs.forEach((u) => { try { u(); } catch (_) { /* egal */ } });
    for (const [, u] of mapAbos) { try { u(); } catch (_) { /* egal */ } }
    mapAbos.clear();
  });
}
