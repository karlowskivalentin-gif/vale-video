// To-Do-Liste (map-übergreifend, Admin + Kollaborator).
// Zeigt AUSSCHLIESSLICH anstehende To-Dos (todo=true, nicht erledigt, nicht
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
import { escapeHtml } from "../util.js";

const DEFAULT_MAP = "default";
const lc = (s) => String(s || "").toLowerCase();

export function renderTodos(container, opts) {
  const rolle = (opts && opts.rolle) || "admin";
  const istKollab = rolle === "kollaborator";
  const meineEmail = lc(opts && opts.user && opts.user.email);
  const kollabMapId = (opts && opts.kollabMapId) || null;

  let mindmaps = [];          // sichtbare Map-Definitionen
  let kollabMapDoc = null;    // Kollaborator: Doc der geteilten Map
  let filter = "alle";        // "alle" | "meine" | "offen"
  const daten = new Map();    // id → Gedanke
  const unsubs = [];          // globale Abos
  const mapAbos = new Map();  // Kollaborator: mapId → Gedanken-Abo

  container.innerHTML = `
    <div class="admin-head">
      <h1 class="view-title" style="margin:0">To-Dos</h1>
      <select class="gd-filter" id="todoKat" aria-label="Nach Kategorie (Sub/Bereich) filtern">
        <option value="">Alle Kategorien</option>
      </select>
      <select class="gd-filter" id="todoFilter" aria-label="To-Dos filtern">
        <option value="alle">Alle</option>
        <option value="meine">Mir zugewiesen</option>
        <option value="offen">Nicht zugewiesen</option>
      </select>
    </div>
    <p class="muted view-intro">Alle anstehenden To-Dos aus deinen Mindmaps an einem Ort.
      Abhaken erledigt sie auch in der Mindmap; wer verantwortlich ist, wählst du direkt am To-Do.
      Die Kategorien entstehen aus deinen Subs/Bereichen — ein To-Do gehört dazu, wenn es damit verbunden ist.</p>
    <div id="todoBody"><p class="muted">Lädt…</p></div>`;
  const body = container.querySelector("#todoBody");
  const katSelect = container.querySelector("#todoKat");
  let katFilter = "";   // Gedanken-Id des gewählten Subs/Bereichs ("" = alle)
  container.querySelector("#todoFilter").addEventListener("change", (e) => { filter = e.target.value; render(); });
  katSelect.addEventListener("change", () => { katFilter = katSelect.value; render(); });

  // Kategorien = alle (nicht archivierten) Subs/Bereiche der sichtbaren Maps.
  function kategorien() {
    const mapIds = new Set(meineMaps().map((m) => m.id));
    return [...daten.values()]
      .filter((g) => (g.ebene === "sub" || g.ebene === "bereich") && !g.archiviert && mapIds.has(g.mapId || DEFAULT_MAP))
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
  const istOffen = (g) => g.todo === true && !g.erledigt && !g.archiviert;
  const passtFilter = (g) => filter === "alle"
    || (filter === "meine" && lc(g.verantwortlich) === meineEmail)
    || (filter === "offen" && !g.verantwortlich);

  function itemHtml(g, map) {
    const nutzer = nutzerFuerMap(map);
    const wer = lc(g.verantwortlich);
    return `
      <li class="todo-item">
        <input type="checkbox" class="todo-check" data-id="${escapeHtml(g.id)}" title="Erledigen (wirkt auch in der Mindmap)">
        <div class="todo-haupt">
          <span class="todo-text">${escapeHtml(g.text || "Unbenannter Gedanke")}</span>
          <span class="todo-meta muted">🗺 ${escapeHtml(map ? map.name : "")}</span>
        </div>
        <select class="todo-wer" data-id="${escapeHtml(g.id)}" title="Verantwortlich">
          <option value="">– niemand –</option>
          ${nutzer.map((n) => `<option value="${escapeHtml(n)}"${n === wer ? " selected" : ""}>${escapeHtml(n === meineEmail ? `Ich (${n})` : n)}</option>`).join("")}
        </select>
      </li>`;
  }

  function render() {
    renderKatSelect();
    const maps = meineMaps();
    const mapVon = (g) => maps.find((m) => m.id === (g.mapId || DEFAULT_MAP)) || null;
    const offene = [...daten.values()]
      .filter((g) => istOffen(g) && mapVon(g) && passtFilter(g) && passtKategorie(g))
      .sort((a, b) => (a.text || "").localeCompare(b.text || "", "de"));

    if (!offene.length) {
      body.innerHTML = `<p class="muted">Keine anstehenden To-Dos${filter !== "alle" ? " für diesen Filter" : ""}. 🎉</p>`;
      return;
    }

    const gruppen = maps
      .map((m) => ({ map: m, items: offene.filter((g) => (g.mapId || DEFAULT_MAP) === m.id) }))
      .filter((x) => x.items.length);

    body.innerHTML = `
      <section class="todo-uebersicht card card--pad">
        <h2 class="todo-h2">🎯 Übersicht · ${offene.length} offen</h2>
        <ul class="todo-liste">${offene.map((g) => itemHtml(g, mapVon(g))).join("")}</ul>
      </section>
      <h2 class="todo-h2" style="margin-top:1.5rem">Pro Mindmap</h2>
      ${gruppen.map((x) => `
        <section class="todo-gruppe">
          <h3 class="todo-h3">🗺 ${escapeHtml(x.map.name)} <span class="muted">(${x.items.length})</span></h3>
          <ul class="todo-liste">${x.items.map((g) => itemHtml(g, x.map)).join("")}</ul>
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
