// Admin-View: Gedanken (Obsidian-artige Mindmap, Admin-only).
// Eine private Denk-Leinwand: Jeder Gedanke ist ein frei verschiebbarer Knoten
// (Checkbox + Überschrift + Chevron + Datei-Anhang + Löschen) auf einer
// unendlichen, pannbaren Leinwand. Knoten lassen sich über Docking-Punkte mit
// SVG-Linien verbinden.
//
// Drei Ebenen der Tiefe pro Gedanke:
//   1) Überschrift        — direkt am Knoten editierbar (textarea).
//   2) Chevron ▸/▾        — klappt den Knoten INLINE in der Mindmap auf:
//                           Markdown-Ausführung + Dateien + „Verwandt mit".
//   3) Doppelklick        — öffnet den Gedanken als VOLLE Seite (Detailansicht,
//                           oben links „← Mindmap").
//
// Dateien: Anhänge werden als Metadaten am Gedanken gespeichert; die Bytes
// liegen Base64 in der Collection „dateiblobs" und werden erst beim Öffnen
// geladen (Spark-Plan: kein Firebase Storage, Cap ~700 KB — für große Videos
// stattdessen einen Link anhängen, der via embeds.js inline abspielt).
//
// Datenmodell (Firestore „gedanken", siehe db.js):
//   { text, detail, x, y (Weltkoord.), ebene (gedanke|sub|bereich),
//     kind (gedanke|post), todo (bool), mapId, erledigt, farbe,
//     verbindungen:[ids], dateien:[{art,blobId|url,name,typ}] }
//
// Realtime: beobachteGedanken + Reconcile (KEIN innerHTML-Neuaufbau pro
// Snapshot, sonst verliert der Nutzer Fokus/Drag). Der Kunde sieht das NIE.
import {
  beobachteGedanken, gedankeAnlegen, aktualisiereGedanke, loescheGedanke,
  dateiblobAnlegen, ladeDateiblob, loescheDateiblob,
  beobachteMindmaps, beobachteMeineMindmaps, mindmapAnlegen, loescheMindmap,
  ladeMindmap, benachrichtigungAnlegen
} from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { escapeHtml } from "../util.js";
import { embedHtml, verarbeiteEmbeds } from "../embeds.js";

const SVGNS = "http://www.w3.org/2000/svg";
const KNOTEN_B = 220;        // Knotenbreite (px) — Platzierung/Mittelpunkt-Fallback
const KNOTEN_H = 64;         // grobe Starthöhe als Fallback vor dem ersten Layout
const DRAG_SCHWELLE = 4;     // px Bewegung, ab der ein Klick als Drag zählt
const MAX_DATEI = 700 * 1024; // Upload-Cap (Firestore-Doc-Limit ~1 MiB, Base64-Aufschlag)
const DEFAULT_MAP = "default"; // Map-ID für Altbestände / die Standard-Mindmap
const lc = (s) => String(s || "").toLowerCase();
// Feste Farbpalette für manuelle Karten-Farben. Grün und Rosa fehlen bewusst:
// grün = To-Do, rosa = Post (abgeleitete Farben, nicht überschreibbar).
const FARBEN = [
  { id: "gelb",    hex: "#eab308", name: "Gelb" },
  { id: "blau",    hex: "#3b82f6", name: "Blau" },
  { id: "lila",    hex: "#8b5cf6", name: "Lila" },
  { id: "tuerkis", hex: "#14b8a6", name: "Türkis" },
  { id: "rot",     hex: "#ef4444", name: "Rot" },
  { id: "grau",    hex: "#9ca3af", name: "Grau" }
];

export function renderAdminGedanken(container, opts) {
  // Kollaborator-Modus: geteilte Map (per Einladung) + selbst angelegte Maps.
  const kollabMapId = (opts && opts.kollabMapId) || null;
  const istKollab = !!kollabMapId;
  const meineEmail = lc((opts && opts.user && opts.user.email) || "");

  // --- Modul-State -------------------------------------------------------
  let panX = 0, panY = 0;            // Verschiebung des sichtbaren Ausschnitts
  let zoom = 1;                      // Zoom-Faktor der Leinwand (0.4–2.2)
  let geladen = false;               // erster Snapshot angekommen?
  let fokusId = null;                // frisch angelegter Gedanke → Textfokus
  let neuZaehler = 0;                // leichter Versatz für neue Knoten
  let seiteId = null;                // aktuell voll geöffneter Gedanke (Detailseite) | null
  let anhangZielId = null;           // Ziel-Gedanke des Datei-Dialogs
  let ansicht = "aktiv";             // "aktiv" = Haupt-Leinwand | "archiv" = erledigte Gedanken
  const LS_MAP_KEY = istKollab ? "vale_gd_map_k" : "vale_gd_map";
  let aktiveMapId = localStorage.getItem(LS_MAP_KEY) || (istKollab ? (kollabMapId || DEFAULT_MAP) : DEFAULT_MAP);  // gewählte Mindmap (④)
  let filterModus = "alle";          // "alle" | "todos" | "system" (① To-Do-Filter)
  let mindmaps = [];                 // ④ zusätzliche benannte Mindmaps (Firestore)
  let mapUnsub = null;               // ④ onSnapshot-Abbestellung für mindmaps
  const daten = new Map();           // id → zuletzt bekannter Gedanke
  const knoten = new Map();          // id → HTMLElement (Reconcile)
  const offen = new Set();           // ids der INLINE aufgeklappten Knoten (UI-only)
  const blobCache = new Map();       // blobId → data:-URL (on-demand geladen)
  const aktiveInteraktion = new Set(); // ids, die gerade gezogen werden
  const postIndex = new Map();       // id → aktueller Carousel-Bildindex (Post-Cards, UI-only)

  // Nur einzelne Gedanken (nicht Sub/Bereich) tragen einen To-Do-Status.
  const istEinzelGedanke = (g) => ebeneOk(g.ebene) === "gedanke";
  const istTodo = (g) => g.todo === true;

  // Sicht-Gate: Map-Zugehörigkeit (④) + Ansicht (aktiv/archiv) + To-Do-Filter (①).
  // Bereiche/Subs bleiben vom To-Do-Filter IMMER unberührt (nur echte Gedanken
  // werden ein-/ausgeblendet). `daten` hält stets ALLE Gedanken, gerendert wird
  // nur die aktuelle Map+Ansicht. Erledigtes „verschwindet" ins Archiv (eigene
  // Ansicht) und ordnet sich dort über dieselben Verbindungen wieder ein.
  function istSichtbar(g) {
    if ((g.mapId || DEFAULT_MAP) !== aktiveMapId) return false;
    if ((!!g.archiviert) !== (ansicht === "archiv")) return false;
    if (ansicht !== "archiv" && filterModus !== "alle" && istEinzelGedanke(g)) {
      if (filterModus === "todos"  && !istTodo(g)) return false;
      if (filterModus === "system" &&  istTodo(g)) return false;
    }
    return true;
  }

  container.innerHTML = `
    <div class="admin-head">
      <h1 class="view-title" style="margin:0">Gedanken</h1>
      <div class="gd-neu-group">
        <select class="gd-mapselect" id="gdMapSelect" title="Mindmap wählen" aria-label="Mindmap wählen"></select>
        <button class="btn btn--ghost btn--sm gd-map-neu" id="gdNeuMap" type="button" title="Neue Mindmap anlegen">+ Karte</button>
        <button class="btn btn--ghost btn--sm gd-map-del" id="gdMapDel" type="button" title="Aktuelle Mindmap löschen" hidden>🗑 Karte</button>
        <span class="gd-mapneu" id="gdMapNeu" hidden>
          <input type="text" id="gdMapNeuInput" class="gd-mapneu-input" maxlength="40" placeholder="Name der neuen Mindmap" aria-label="Name der neuen Mindmap" />
          <button class="btn btn--accent btn--sm" id="gdMapNeuOk" type="button">Anlegen</button>
          <button class="btn btn--ghost btn--sm" id="gdMapNeuAbbr" type="button">Abbrechen</button>
        </span>
        <button class="btn btn--accent btn--sm" id="gdNeuBereich" type="button" title="Großer, übergeordneter Bereich (z. B. Vale Video)">+ Bereich</button>
        <button class="btn btn--ghost btn--sm" id="gdNeuSub" type="button" title="Subbereich (z. B. Social Media)">+ Sub</button>
        <button class="btn btn--ghost btn--sm" id="gdNeuGedanke" type="button" title="Einzelner Gedanke">+ Gedanke</button>
        <button class="btn btn--ghost btn--sm gd-neu-post" id="gdNeuPost" type="button" title="Post-Entwurf (Bilder-Carousel + Video/Social-Link)">+ Post</button>
        <select class="gd-filter" id="gdFilter" title="Gedanken filtern (Bereiche & Subs bleiben immer sichtbar)" aria-label="Gedanken filtern">
          <option value="alle">Alle</option>
          <option value="todos">Nur To-Dos</option>
          <option value="system">Nur beständige</option>
        </select>
        <button class="btn btn--ghost btn--sm gd-neu-alle" id="gdNeuAlle" type="button" title="Alle neuen Elemente des Partners anerkennen" hidden>✓ Neu</button>
        <button class="btn btn--ghost btn--sm gd-archiv-toggle" id="gdArchivToggle" type="button" title="Archiv erledigter Gedanken ein-/ausblenden" aria-pressed="false">🗄 Archiv</button>
      </div>
    </div>
    <p class="muted view-intro">Deine private Denk-Leinwand: Ebene wählen (Bereich / Sub / Gedanke),
      Überschrift am Knoten tippen, mit dem Pfeil ▸ die Ausführung + Dateien inline aufklappen,
      per Doppelklick voll öffnen. Über die Rand-Punkte verbinden, auf leerer Fläche ziehen verschiebt den Ausschnitt,
      Mausrad oder Pinch (zwei Finger) zoomt stufenlos rein und raus. Erledigtes lässt sich per ✓ abhaken
      und mit „→ Archiv" auf eine eigene Archiv-Leinwand verschieben.</p>
    <div class="gd-canvas" id="gdCanvas">
      <svg class="gd-edges" id="gdEdges" width="1" height="1" aria-hidden="true"></svg>
      <div class="gd-welt" id="gdWelt"></div>
      <div class="gd-status" id="gdStatus">Wird geladen…</div>
      <div class="gd-leer" id="gdLeer" hidden>Noch keine Gedanken — leg deinen ersten an.</div>
      <div class="gd-modus-banner" id="gdModusBanner" hidden>🗄 Archiv — erledigte Gedanken. Neu Verbundenes ordnet sich hier automatisch ein.</div>
      <button class="gd-sidebar-btn" id="gdSidebarBtn" type="button" title="Alle Gedanken">☰ Liste</button>
      <aside class="gd-sidebar" id="gdSidebar" aria-label="Alle Gedanken">
        <div class="gd-sidebar-kopf">Alle Gedanken<button class="gd-sidebar-zu" id="gdSidebarZu" type="button" title="Schließen">✕</button></div>
        <div class="gd-liste" id="gdListe"></div>
      </aside>
      <div class="gd-toast" id="gdToast" hidden></div>
    </div>
    <div class="gd-seite" id="gdSeite" hidden></div>`;

  const canvas  = container.querySelector("#gdCanvas");
  const welt    = container.querySelector("#gdWelt");
  const svg     = container.querySelector("#gdEdges");
  const status  = container.querySelector("#gdStatus");
  const leer    = container.querySelector("#gdLeer");
  const sidebar = container.querySelector("#gdSidebar");
  const liste   = container.querySelector("#gdListe");
  const seite   = container.querySelector("#gdSeite");
  const toastEl = container.querySelector("#gdToast");

  // Verstecktes Datei-Eingabefeld (einmal, für alle 📎-Buttons wiederverwendet).
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.style.display = "none";
  container.appendChild(fileInput);
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files && fileInput.files[0];
    const ziel = anhangZielId;
    fileInput.value = "";
    fileInput.accept = "";   // Filter (z. B. Post-Bild „image/*") wieder freigeben
    if (f && ziel) await haengeDateiAn(ziel, f);
  });

  // SVG-Ebenen: Kanten neu gezeichnet, Temp-Linie (Zug) in eigener Ebene.
  const kantenEbene = document.createElementNS(SVGNS, "g");
  const tempEbene   = document.createElementNS(SVGNS, "g");
  tempEbene.setAttribute("class", "gd-edges-temp");
  svg.appendChild(kantenEbene);
  svg.appendChild(tempEbene);
  welt.appendChild(svg); // SVG wandert mit der Welt

  // --- kleiner Toast -----------------------------------------------------
  let toastTimer = null;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 4000);
  }

  // --- Koordinaten-Helfer ------------------------------------------------
  function weltPunkt(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return { x: (clientX - r.left - panX) / zoom, y: (clientY - r.top - panY) / zoom };
  }
  function wendePanAn() {
    welt.style.transformOrigin = "0 0";
    welt.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    canvas.style.backgroundPosition = `${panX}px ${panY}px`;
    canvas.style.backgroundSize = `${(24 * zoom).toFixed(2)}px ${(24 * zoom).toFixed(2)}px`;
  }
  // Zoomt auf einen Faktor, hält dabei einen Fokuspunkt (Cursor oder
  // Leinwand-Mitte) im Bild fest. fx/fy sind Client-Koordinaten (optional).
  function setzeZoom(z, fx, fy) {
    const r = canvas.getBoundingClientRect();
    const focalX = fx == null ? r.width / 2 : fx - r.left;
    const focalY = fy == null ? r.height / 2 : fy - r.top;
    const neu = Math.min(2.2, Math.max(0.4, z));
    const wx = (focalX - panX) / zoom;   // Weltpunkt unter dem Fokus
    const wy = (focalY - panY) / zoom;
    zoom = neu;
    panX = focalX - wx * zoom;           // Fokuspunkt an gleicher Stelle halten
    panY = focalY - wy * zoom;
    wendePanAn();
  }
  // Aktiven Editor (Überschrift/Detail/Titel/Link) blurren, damit sein
  // onBlur-Speichern feuert — nötig VOR Pan/Drag, deren preventDefault das
  // native Blur sonst unterdrückt (sonst geht der getippte Text verloren).
  function blurAktiv() {
    const a = document.activeElement;
    if (a && a.blur && (a.classList.contains("gd-text") || a.classList.contains("gd-detail") ||
        a.classList.contains("gd-seite-titel") || a.classList.contains("gd-link-input"))) {
      a.blur();
    }
  }
  function mittelpunkt(id) {
    const g = daten.get(id);
    if (!g) return null;
    const el = knoten.get(id);
    const b = el && el.offsetWidth  ? el.offsetWidth  : KNOTEN_B;
    const h = el && el.offsetHeight ? el.offsetHeight : KNOTEN_H;
    return { x: g.x + b / 2, y: g.y + h / 2 };
  }
  function pfad(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 1;
    const biege = Math.min(36, dist * 0.16);
    const mx = (a.x + b.x) / 2 - (dy / dist) * biege;
    const my = (a.y + b.y) / 2 + (dx / dist) * biege;
    return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }

  // --- Kanten zeichnen ---------------------------------------------------
  function zeichneKanten() {
    const gesehen = new Set();
    let html = "";
    for (const g of daten.values()) {
      if (!knoten.has(g.id)) continue;            // nur sichtbare (gerenderte) Knoten
      for (const zielId of (g.verbindungen || [])) {
        if (zielId === g.id || !knoten.has(zielId)) continue;
        const key = g.id < zielId ? `${g.id}|${zielId}` : `${zielId}|${g.id}`;
        if (gesehen.has(key)) continue;
        gesehen.add(key);
        const a = mittelpunkt(g.id), b = mittelpunkt(zielId);
        if (!a || !b) continue;
        const d = pfad(a, b);
        html += `<g class="gd-edge-grp" data-quelle="${escapeHtml(g.id)}" data-ziel="${escapeHtml(zielId)}">
          <path class="gd-edge-hit" d="${d}"></path>
          <path class="gd-edge" d="${d}"></path>
        </g>`;
      }
    }
    kantenEbene.innerHTML = html;
  }
  svg.addEventListener("click", (e) => {
    const grp = e.target.closest ? e.target.closest(".gd-edge-grp") : null;
    if (grp) entferneKante(grp.dataset.quelle, grp.dataset.ziel);
  });
  function entferneKante(idA, idB) {
    for (const [von, nach] of [[idA, idB], [idB, idA]]) {
      const g = daten.get(von);
      if (g && (g.verbindungen || []).includes(nach)) {
        g.verbindungen = g.verbindungen.filter((v) => v !== nach);
        aktualisiereGedanke(von, { verbindungen: g.verbindungen })
          .catch((err) => console.warn("Kante konnte nicht entfernt werden:", err));
      }
    }
    zeichneKanten();
  }
  function verbinde(quellId, zielId) {
    if (!quellId || !zielId || quellId === zielId) return;
    const quelle = daten.get(quellId), ziel = daten.get(zielId);
    if (!quelle || !ziel) return;
    if ((quelle.verbindungen || []).includes(zielId) || (ziel.verbindungen || []).includes(quellId)) return;
    quelle.verbindungen = [...(quelle.verbindungen || []), zielId];
    zeichneKanten();
    aktualisiereGedanke(quellId, { verbindungen: quelle.verbindungen })
      .catch((err) => console.warn("Verbindung konnte nicht gespeichert werden:", err));
  }

  // --- Markdown (klein, sicher: alles wird zuerst escaped) ---------------
  function mdZuHtml(src) {
    let out = escapeHtml(src || "");
    out = out
      .replace(/^###\s+(.*)$/gm, "<h3>$1</h3>")
      .replace(/^##\s+(.*)$/gm, "<h2>$1</h2>")
      .replace(/^#\s+(.*)$/gm, "<h1>$1</h1>");
    out = out.replace(/(?:^|\n)((?:\s*-\s+.*(?:\n|$))+)/g, (m, block) => {
      const items = block.trim().split("\n")
        .map((l) => l.replace(/^\s*-\s+/, "").trim())
        .filter(Boolean)
        .map((t) => `<li>${t}</li>`).join("");
      return `\n<ul>${items}</ul>\n`;
    });
    out = out
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener">$1</a>');
    out = out.replace(/\n/g, "<br>");
    // <br> direkt um Blockelemente wieder entfernen (kosmetisch)
    out = out.replace(/<br>\s*(<\/?(?:h1|h2|h3|ul|li)>)/g, "$1")
             .replace(/(<\/?(?:h1|h2|h3|ul|li)>)\s*<br>/g, "$1");
    return out;
  }

  // --- Dateien / Anhänge -------------------------------------------------
  function leseDatei(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result || ""));
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }
  async function haengeDateiAn(id, file) {
    if (file.size > MAX_DATEI) {
      toast(`„${file.name}" ist ${Math.round(file.size / 1024)} KB — max. ~700 KB. Für große Videos lieber einen Link anhängen.`);
      return;
    }
    try {
      const durl = await leseDatei(file);
      const komma = durl.indexOf(",");
      const base64 = komma >= 0 ? durl.slice(komma + 1) : durl;
      const typ = file.type || "application/octet-stream";
      const ref = await dateiblobAnlegen({ base64, name: file.name, typ });
      blobCache.set(ref.id, `data:${typ};base64,${base64}`); // gleich cachen
      const g = daten.get(id);
      const dateien = [...((g && g.dateien) || []), { art: "datei", blobId: ref.id, name: file.name, typ }];
      if (g) g.dateien = dateien;
      await aktualisiereGedanke(id, { dateien });
    } catch (err) {
      console.warn("Datei konnte nicht gespeichert werden:", err);
      toast("Datei konnte nicht gespeichert werden.");
    }
  }
  async function haengeLinkAn(id, urlRoh) {
    let url = String(urlRoh || "").trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    const g = daten.get(id);
    const dateien = [...((g && g.dateien) || []), { art: "link", url, name: url, typ: "link" }];
    if (g) g.dateien = dateien;
    await aktualisiereGedanke(id, { dateien })
      .catch((err) => { console.warn(err); toast("Link konnte nicht gespeichert werden."); });
  }
  async function entferneAnhang(id, index) {
    const g = daten.get(id);
    if (!g || !Array.isArray(g.dateien)) return;
    const arr = [...g.dateien];
    const weg = arr.splice(index, 1)[0];
    g.dateien = arr;
    await aktualisiereGedanke(id, { dateien: arr }).catch((e) => console.warn(e));
    if (weg && weg.art === "datei" && weg.blobId) {
      loescheDateiblob(weg.blobId).catch(() => {});
      blobCache.delete(weg.blobId);
    }
  }
  async function blobDataUrl(blobId) {
    if (blobCache.has(blobId)) return blobCache.get(blobId);
    const b = await ladeDateiblob(blobId);
    if (!b) return null;
    const url = `data:${b.typ};base64,${b.base64}`;
    blobCache.set(blobId, url);
    return url;
  }
  function medienHtml(src, typ, name) {
    const s = escapeHtml(src), n = escapeHtml(name || "Datei");
    if ((typ || "").startsWith("image/")) return `<img class="gd-media-img" src="${s}" alt="${n}">`;
    if ((typ || "").startsWith("audio/")) return `<audio class="gd-media-audio" controls src="${s}"></audio>`;
    if ((typ || "").startsWith("video/")) return `<video class="gd-media-video" controls src="${s}"></video>`;
    if (typ === "application/pdf")        return `<a class="btn btn--ghost btn--sm" href="${s}" target="_blank" rel="noopener">PDF öffnen ↗</a>`;
    return `<a class="btn btn--ghost btn--sm" href="${s}" download="${n}">Herunterladen ↓</a>`;
  }
  function linkMedienHtml(url) {
    const u = String(url || "").toLowerCase();
    if (/\.(png|jpe?g|gif|webp|svg)(\?.*)?$/.test(u)) return `<img class="gd-media-img" src="${escapeHtml(url)}" alt="">`;
    if (/\.(mp4|webm|mov|m4v)(\?.*)?$/.test(u))       return `<video class="gd-media-video" controls src="${escapeHtml(url)}"></video>`;
    if (/\.(mp3|wav|ogg|m4a|aac)(\?.*)?$/.test(u))    return `<audio class="gd-media-audio" controls src="${escapeHtml(url)}"></audio>`;
    return embedHtml(url); // YouTube/TikTok/Instagram inline, sonst Fallback-Link
  }
  // Füllt ein Media-Element (asynchron bei Datei-Blobs).
  function fuelleMedia(el, att) {
    if (att.art === "link") {
      el.innerHTML = linkMedienHtml(att.url);
      verarbeiteEmbeds(el);
      return;
    }
    el.innerHTML = `<span class="muted" style="font-size:.8rem">lädt …</span>`;
    blobDataUrl(att.blobId).then((url) => {
      if (!url) { el.innerHTML = `<span class="gd-anh-fehler">Datei nicht gefunden</span>`; return; }
      el.innerHTML = medienHtml(url, att.typ, att.name);
    }).catch(() => { el.innerHTML = `<span class="gd-anh-fehler">Fehler beim Laden</span>`; });
  }
  // Rendert die Anhang-Liste eines Gedanken in ein Ziel-Element.
  function renderAnhaenge(zielEl, id) {
    const g = daten.get(id) || {};
    const list = g.dateien || [];
    zielEl.innerHTML = "";
    if (!list.length) { zielEl.innerHTML = `<span class="gd-anh-leer muted">Keine Dateien angehängt.</span>`; return; }
    list.forEach((att, i) => {
      const row = document.createElement("div");
      row.className = "gd-anh";
      const kopf = document.createElement("div");
      kopf.className = "gd-anh-kopf";
      const name = document.createElement("span");
      name.className = "gd-anh-name";
      name.textContent = (att.art === "link" ? "🔗 " : "📄 ") + (att.name || att.url || "Datei");
      const del = document.createElement("button");
      del.type = "button"; del.className = "gd-anh-del"; del.textContent = "✕"; del.title = "Anhang entfernen";
      del.addEventListener("click", () => entferneAnhang(id, i).then(() => renderAnhaenge(zielEl, id)));
      kopf.append(name, del);
      const media = document.createElement("div");
      media.className = "gd-anh-media";
      fuelleMedia(media, att);
      row.append(kopf, media);
      zielEl.appendChild(row);
    });
  }

  // --- Post-Card: Bilder-Carousel + Social/Video-Embeds -----------------
  const istBildAnhang = (a) =>
    (a.art === "datei" && (a.typ || "").startsWith("image/")) ||
    (a.art === "link" && /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(a.url || ""));

  function zeichnePostMedia(el, id) {
    const wrap = el.querySelector(".gd-post");
    if (!wrap) return;
    wrap.hidden = false;
    const g = daten.get(id) || {};
    const dateien = g.dateien || [];
    const bilder = [], embeds = [];
    dateien.forEach((a, i) => {
      if (istBildAnhang(a)) bilder.push({ a, i });
      else if (a.art === "link") embeds.push({ a, i });
    });

    let idx = postIndex.get(id) || 0;
    if (idx >= bilder.length) idx = 0;
    postIndex.set(id, idx);

    wrap.innerHTML = "";

    // Bilder-Carousel
    if (bilder.length) {
      const car = document.createElement("div");
      car.className = "gd-post-carousel";
      const stage = document.createElement("div");
      stage.className = "gd-post-stage";
      const cur = bilder[idx].a;
      if (cur.art === "datei") {
        stage.innerHTML = `<span class="muted" style="font-size:.72rem">lädt …</span>`;
        blobDataUrl(cur.blobId).then((url) => {
          if (url && stage.isConnected) stage.innerHTML = `<img class="gd-post-img" src="${escapeHtml(url)}" alt="">`;
          else if (stage.isConnected) stage.innerHTML = `<span class="gd-anh-fehler">Bild nicht gefunden</span>`;
        }).catch(() => { if (stage.isConnected) stage.innerHTML = `<span class="gd-anh-fehler">Fehler</span>`; });
      } else {
        stage.innerHTML = `<img class="gd-post-img" src="${escapeHtml(cur.url)}" alt="">`;
      }
      car.appendChild(stage);

      const delImg = document.createElement("button");
      delImg.type = "button"; delImg.className = "gd-post-delimg"; delImg.textContent = "✕"; delImg.title = "Bild entfernen";
      delImg.addEventListener("click", (e) => { e.stopPropagation(); postIndex.set(id, 0); entferneAnhang(id, bilder[idx].i).then(() => zeichnePostMedia(el, id)); });
      car.appendChild(delImg);

      if (bilder.length > 1) {
        const prev = document.createElement("button");
        prev.type = "button"; prev.className = "gd-post-nav gd-post-prev"; prev.textContent = "‹"; prev.title = "Vorheriges Bild";
        prev.addEventListener("click", (e) => { e.stopPropagation(); postIndex.set(id, (idx - 1 + bilder.length) % bilder.length); zeichnePostMedia(el, id); });
        const next = document.createElement("button");
        next.type = "button"; next.className = "gd-post-nav gd-post-next"; next.textContent = "›"; next.title = "Nächstes Bild";
        next.addEventListener("click", (e) => { e.stopPropagation(); postIndex.set(id, (idx + 1) % bilder.length); zeichnePostMedia(el, id); });
        const dots = document.createElement("div");
        dots.className = "gd-post-dots";
        dots.innerHTML = bilder.map((_, i) => `<span class="gd-post-dot${i === idx ? " is-active" : ""}"></span>`).join("");
        car.append(prev, next, dots);
      }
      wrap.appendChild(car);
    }

    // Video/Social-Embeds (YouTube/Instagram/TikTok) — je eigener Block.
    embeds.forEach(({ a, i }) => {
      const box = document.createElement("div");
      box.className = "gd-post-embed";
      const media = document.createElement("div");
      media.className = "gd-post-embed-media";
      media.innerHTML = embedHtml(a.url);
      verarbeiteEmbeds(media);
      const del = document.createElement("button");
      del.type = "button"; del.className = "gd-post-embed-del"; del.textContent = "✕"; del.title = "Link entfernen";
      del.addEventListener("click", (e) => { e.stopPropagation(); entferneAnhang(id, i).then(() => zeichnePostMedia(el, id)); });
      box.append(media, del);
      wrap.appendChild(box);
    });

    // Hinzufügen-Leiste: Bild (Upload) + Link (Einbetten).
    const add = document.createElement("div");
    add.className = "gd-post-add";
    const bildBtn = document.createElement("button");
    bildBtn.type = "button"; bildBtn.className = "gd-post-addbtn"; bildBtn.textContent = "📷 Bild";
    bildBtn.title = "Bild hinzufügen (max ~700 KB)";
    bildBtn.addEventListener("click", (e) => { e.stopPropagation(); anhangZielId = id; fileInput.accept = "image/*"; fileInput.click(); });
    const linkBtn = document.createElement("button");
    linkBtn.type = "button"; linkBtn.className = "gd-post-addbtn"; linkBtn.textContent = "🔗 Link";
    linkBtn.title = "YouTube / Instagram / TikTok / Bild-URL einbetten";
    linkBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      add.innerHTML = "";
      const inp = document.createElement("input");
      inp.type = "url"; inp.className = "gd-post-linkinput";
      inp.placeholder = "YouTube / Instagram / TikTok / Bild-URL";
      const ok = document.createElement("button");
      ok.type = "button"; ok.className = "gd-post-addbtn"; ok.textContent = "Einbetten";
      const senden = () => { const v = (inp.value || "").trim(); if (v) haengeLinkAn(id, v).then(() => zeichnePostMedia(el, id)); };
      ok.addEventListener("click", (e2) => { e2.stopPropagation(); senden(); });
      inp.addEventListener("keydown", (e2) => { if (e2.key === "Enter") { e2.preventDefault(); senden(); } });
      add.append(inp, ok);
      inp.focus();
    });
    add.append(bildBtn, linkBtn);
    wrap.appendChild(add);
  }

  // --- „Verwandt mit" (verbundene Gedanken, beide Richtungen) ------------
  function verwandteIds(id) {
    const set = new Set();
    const g = daten.get(id);
    (g && g.verbindungen || []).forEach((v) => set.add(v));
    daten.forEach((o) => { if (o.id !== id && (o.verbindungen || []).includes(id)) set.add(o.id); });
    return [...set].filter((v) => daten.has(v));
  }
  function renderVerwandt(zielEl, id, gross) {
    const ids = verwandteIds(id);
    zielEl.innerHTML = `<div class="gd-verwandt-titel">Verwandt mit</div>`;
    if (!ids.length) { zielEl.insertAdjacentHTML("beforeend", `<span class="gd-verwandt-leer muted">— noch nichts verbunden</span>`); return; }
    const box = document.createElement("div");
    box.className = "gd-verwandt-liste";
    ids.forEach((vid) => {
      const o = daten.get(vid);
      const b = document.createElement("button");
      b.type = "button"; b.className = "gd-verwandt-item";
      if (o.erledigt) b.classList.add("is-erledigt");
      b.textContent = o.text || "Unbenannter Gedanke";
      b.addEventListener("click", () => {
        if (gross) { oeffneSeite(vid); }
        else { zuKnoten(vid); if (!offen.has(vid)) toggleOffen(vid); }
      });
      box.appendChild(b);
    });
    zielEl.appendChild(box);
  }

  // --- Gemeinsamer „Körper" (Ausführung + Dateien + Verwandt) -----------
  // Wird sowohl im Inline-Aufklapp als auch in der Vollseite verwendet.
  function baueKoerper(id, gross) {
    const wrap = document.createElement("div");
    wrap.className = "gd-koerper" + (gross ? " gd-koerper--gross" : "");

    // Markdown-Ausführung: Vorschau; Klick → Bearbeiten; Blur → speichern.
    const md = document.createElement("div");
    md.className = "gd-md";
    function zeigePreview() {
      md.innerHTML = "";
      const p = document.createElement("div");
      p.className = "gd-md-preview";
      const cur = (daten.get(id) || {}).detail || "";
      p.innerHTML = cur ? mdZuHtml(cur) : `<span class="gd-md-leer muted">＋ Ausführung hinzufügen … (Markdown)</span>`;
      p.addEventListener("click", zeigeEdit);
      md.appendChild(p);
    }
    function zeigeEdit() {
      md.innerHTML = "";
      const ta = document.createElement("textarea");
      ta.className = "gd-detail";
      ta.placeholder = "Ausführung … (Markdown: # Titel, **fett**, - Liste, [Text](url))";
      ta.value = (daten.get(id) || {}).detail || "";
      md.appendChild(ta);
      const wachse = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; };
      wachse();
      ta.addEventListener("input", wachse);
      ta.addEventListener("blur", () => {
        const val = ta.value;
        const g = daten.get(id); if (g) g.detail = val;
        aktualisiereGedanke(id, { detail: val }).catch((e) => console.warn(e));
        zeigePreview();
      });
      ta.focus();
    }
    zeigePreview();

    // Dateien
    const anhTitel = document.createElement("div");
    anhTitel.className = "gd-abschnitt-titel";
    anhTitel.textContent = "Dateien";
    const anh = document.createElement("div");
    anh.className = "gd-anhaenge";
    renderAnhaenge(anh, id);

    // Hinzufügen: Datei + Link
    const addRow = document.createElement("div");
    addRow.className = "gd-add-row";
    const dateiBtn = document.createElement("button");
    dateiBtn.type = "button"; dateiBtn.className = "btn btn--ghost btn--sm";
    dateiBtn.textContent = "📎 Datei";
    dateiBtn.addEventListener("click", () => { anhangZielId = id; fileInput.click(); });
    const linkInput = document.createElement("input");
    linkInput.type = "url"; linkInput.className = "gd-link-input field-inline";
    linkInput.placeholder = "Link (YouTube, Drive …) einfügen";
    const linkBtn = document.createElement("button");
    linkBtn.type = "button"; linkBtn.className = "btn btn--ghost btn--sm";
    linkBtn.textContent = "🔗 Link";
    const addLink = async () => {
      const v = linkInput.value; linkInput.value = "";
      if (v.trim()) { await haengeLinkAn(id, v); renderAnhaenge(anh, id); }
    };
    linkBtn.addEventListener("click", addLink);
    linkInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addLink(); } });
    addRow.append(dateiBtn, linkInput, linkBtn);

    // Verwandt
    const vw = document.createElement("div");
    vw.className = "gd-verwandt";
    renderVerwandt(vw, id, gross);

    wrap.append(md, anhTitel, anh, addRow, vw);
    return wrap;
  }

  // --- Inline-Aufklappen am Knoten --------------------------------------
  function toggleOffen(id) {
    if (offen.has(id)) offen.delete(id); else offen.add(id);
    const el = knoten.get(id);
    if (el) zeichneKnotenBody(el, id);
    zeichneKanten();
  }
  function zeichneKnotenBody(el, id) {
    const body = el.querySelector(".gd-node-body");
    const chev = el.querySelector(".gd-chevron");
    if (!body) return;
    if (offen.has(id)) {
      body.innerHTML = "";
      body.appendChild(baueKoerper(id, false));
      body.hidden = false;
      if (chev) { chev.textContent = "▾"; chev.classList.add("is-offen"); }
    } else {
      body.innerHTML = "";
      body.hidden = true;
      if (chev) { chev.textContent = "▸"; chev.classList.remove("is-offen"); }
    }
  }

  // --- Vollseite (Detailansicht) ----------------------------------------
  function oeffneSeite(id) {
    seiteId = id;
    const g = daten.get(id) || {};
    seite.innerHTML = `
      <div class="gd-seite-bar">
        <button class="btn btn--ghost btn--sm" id="gdSeiteBack" type="button">← Mindmap</button>
        <span class="gd-seite-crumb muted">Gedanke</span>
      </div>
      <div class="gd-seite-inner">
        <input class="gd-seite-titel" id="gdSeiteTitel" placeholder="Überschrift …" />
        <div class="gd-seite-body" id="gdSeiteBody"></div>
      </div>`;
    seite.hidden = false;
    const titel = seite.querySelector("#gdSeiteTitel");
    titel.value = g.text || "";
    titel.addEventListener("input", () => {
      const gg = daten.get(id); if (gg) gg.text = titel.value;
      const el = knoten.get(id); if (el) { const ta = el.querySelector(".gd-text"); if (ta && document.activeElement !== ta) ta.value = titel.value; }
    });
    titel.addEventListener("blur", () => {
      aktualisiereGedanke(id, { text: titel.value }).catch((e) => console.warn(e));
      renderSidebar();
    });
    seite.querySelector("#gdSeiteBody").appendChild(baueKoerper(id, true));
    seite.querySelector("#gdSeiteBack").addEventListener("click", schliesseSeite);
  }
  function schliesseSeite() {
    seite.hidden = true;
    seite.innerHTML = "";
    seiteId = null;
  }

  // --- Zu einem Knoten springen (aus Liste / Verwandt) ------------------
  function zuKnoten(id) {
    const g = daten.get(id); if (!g) return;
    const el = knoten.get(id);
    const w = el && el.offsetWidth ? el.offsetWidth : KNOTEN_B;
    const h = el && el.offsetHeight ? el.offsetHeight : KNOTEN_H;
    const r = canvas.getBoundingClientRect();
    panX = Math.round(r.width / 2 - (g.x + w / 2) * zoom);
    panY = Math.round(r.height / 2 - (g.y + h / 2) * zoom);
    wendePanAn();
    if (el) { el.classList.add("is-highlight"); setTimeout(() => el.classList.remove("is-highlight"), 1300); }
  }

  // --- Ebenen (Bereich / Sub / Gedanke) ---------------------------------
  const EBENEN = ["gedanke", "sub", "bereich"];
  function ebeneOk(e) { return e === "bereich" || e === "sub" ? e : "gedanke"; }
  function ebeneLabel(e) { return e === "bereich" ? "H1" : e === "sub" ? "H2" : "—"; }
  // Setzt die Ebenen-Klasse am Knoten-Element und das Umschalter-Label.
  function wendeEbeneAn(el, ebene) {
    const e = ebeneOk(ebene);
    el.classList.remove("gd-node--bereich", "gd-node--sub", "gd-node--gedanke");
    el.classList.add("gd-node--" + e);
    const btn = el.querySelector(".gd-ebene");
    if (btn) btn.textContent = ebeneLabel(e);
  }
  function setzeEbene(id, ebene) {
    const e = ebeneOk(ebene);
    const g = daten.get(id); if (g) g.ebene = e;
    const felder = { ebene: e };
    // Nur einzelne Gedanken dürfen To-Do sein — beim Höherstufen entfernen.
    if (e !== "gedanke" && g && g.todo) { g.todo = false; felder.todo = false; }
    const el = knoten.get(id); if (el) { wendeEbeneAn(el, e); wendeFarbeAn(el, g || {}); }
    aktualisiereGedanke(id, felder).catch((err) => console.warn(err));
    zeichneKanten(); renderSidebar();
  }

  // --- Farbe / To-Do (① grün = To-Do, ③ rosa = Post) --------------------
  // Abgeleitete Farbklasse: Post gewinnt (rosa), sonst To-Do (grün), sonst neutral.
  function farbKlasse(g) {
    if ((g.kind || "gedanke") === "post") return "is-post";
    if (g.todo === true) return "is-todo";
    return null;
  }
  // Setzt is-todo/is-post bzw. die manuelle Palettenfarbe am Knoten und
  // spiegelt To-Do-Umschalter + Farb-Button. Priorität: Post > To-Do > Farbe.
  function wendeFarbeAn(el, g) {
    el.classList.remove("is-todo", "is-post");
    FARBEN.forEach((f) => el.classList.remove("gd-farbe-" + f.id));
    const k = farbKlasse(g);
    if (k) el.classList.add(k);
    else if (g.farbe && FARBEN.some((f) => f.id === g.farbe)) el.classList.add("gd-farbe-" + g.farbe);
    const tb = el.querySelector(".gd-todo");
    if (tb) {
      const einzel = ebeneOk(g.ebene) === "gedanke" && (g.kind || "gedanke") !== "post";
      tb.hidden = !einzel;
      tb.classList.toggle("is-active", g.todo === true);
      tb.setAttribute("aria-pressed", String(g.todo === true));
    }
    const fb = el.querySelector(".gd-farbe-btn");
    if (fb) {
      fb.hidden = !!k;   // bei To-Do/Post keine manuelle Farbe
      const f = FARBEN.find((x) => x.id === g.farbe);
      fb.style.setProperty("--f", f ? f.hex : "transparent");
      fb.classList.toggle("hat-farbe", !!f);
    }
  }
  function setzeTodo(id, val) {
    const g = daten.get(id); if (g) g.todo = !!val;
    const el = knoten.get(id); if (el) wendeFarbeAn(el, daten.get(id) || {});
    aktualisiereGedanke(id, { todo: !!val }).catch((err) => console.warn(err));
    renderSidebar();
  }
  function setzeFarbe(id, farbe) {
    const g = daten.get(id); if (g) g.farbe = farbe || null;
    const el = knoten.get(id); if (el) wendeFarbeAn(el, daten.get(id) || { farbe });
    aktualisiereGedanke(id, { farbe: farbe || null }).catch((err) => console.warn(err));
  }
  // Kleines Paletten-Popover am Knoten (feste Farben + „keine").
  function zeigeFarbPop(el, id) {
    let pop = el.querySelector(".gd-farbe-pop");
    if (pop) { pop.remove(); return; }
    pop = document.createElement("div");
    pop.className = "gd-farbe-pop";
    pop.innerHTML = FARBEN.map((f) =>
      `<button type="button" class="gd-farbe-dot" data-f="${f.id}" style="--f:${f.hex}" title="${f.name}"></button>`).join("") +
      `<button type="button" class="gd-farbe-dot gd-farbe-keine" data-f="" title="Keine Farbe">∅</button>`;
    el.querySelector(".gd-node-kopf").appendChild(pop);
    pop.querySelectorAll(".gd-farbe-dot").forEach((d) => d.addEventListener("click", (e) => {
      e.stopPropagation();
      setzeFarbe(id, d.getAttribute("data-f") || null);
      pop.remove();
    }));
  }

  // --- Neu-Markierung + Anerkennen + Kommentar (geteilte Maps, ④) --------
  const kurz = (t) => { const s = String(t || "Unbenannt").trim() || "Unbenannt"; return s.length > 40 ? s.slice(0, 40) + "…" : s; };

  function akzeptiere(id) {
    const g = daten.get(id); if (!g || !g.neuVon) return;
    const autor = lc(g.neuVon);
    g.neuVon = null;
    const el = knoten.get(id); if (el) wendeNeuAn(el, g);
    aktualisiereGedanke(id, { neuVon: null }).catch((err) => console.warn(err));
    if (autor && autor !== meineEmail) {
      benachrichtigungAnlegen({ fuer: autor, von: meineEmail, text: `✓ ${meineEmail} hat „${kurz(g.text)}" anerkannt` }).catch(() => {});
    }
    aktualisiereNeuAlle();
  }
  function entferneNeu(id) {
    const g = daten.get(id); if (!g) return;
    g.neuVon = null;
    const el = knoten.get(id); if (el) wendeNeuAn(el, g);
    aktualisiereGedanke(id, { neuVon: null }).catch((err) => console.warn(err));
    aktualisiereNeuAlle();
  }

  // Badge/Buttons + roten Partner-Kommentar am Knoten nachziehen.
  function wendeNeuAn(el, g) {
    el.classList.toggle("is-neu", !!g.neuVon);
    const wrap = el.querySelector(".gd-neu-wrap");
    if (wrap) {
      if (!g.neuVon) {
        wrap.innerHTML = "";
      } else if (lc(g.neuVon) === meineEmail) {
        // Eigenes neues Element: der Partner sieht es als NEU; ✕ = endmarkieren.
        wrap.innerHTML = `<span class="gd-neu-badge" title="Der Partner sieht dieses Element als neu">NEU</span><button type="button" class="gd-neu-x" title="Neu-Markierung entfernen (Partner sieht es dann nicht mehr als neu)">✕</button>`;
        wrap.querySelector(".gd-neu-x").addEventListener("click", (e) => { e.stopPropagation(); entferneNeu(g.id); });
      } else {
        // Neues Element des Partners: anerkennen (✓) oder kommentieren (💬).
        wrap.innerHTML = `<span class="gd-neu-badge">NEU</span><button type="button" class="gd-neu-ok" title="Anerkennen — Markierung verschwindet, der Partner wird benachrichtigt">✓</button><button type="button" class="gd-neu-komm" title="Kommentar für den Partner hinterlassen">💬</button>`;
        wrap.querySelector(".gd-neu-ok").addEventListener("click", (e) => { e.stopPropagation(); akzeptiere(g.id); });
        wrap.querySelector(".gd-neu-komm").addEventListener("click", (e) => { e.stopPropagation(); zeigeKommentarBox(g.id); });
      }
    }
    // Roter Partner-Kommentar (hinweis) unter dem Kopf.
    let h = el.querySelector(".gd-hinweis");
    if (g.hinweis && g.hinweis.text) {
      if (!h) {
        h = document.createElement("div");
        h.className = "gd-hinweis";
        const kopf = el.querySelector(".gd-node-kopf");
        if (kopf) kopf.after(h); else el.appendChild(h);
      }
      h.innerHTML = `<span>💬 ${escapeHtml(g.hinweis.text)}</span><button type="button" class="gd-hinweis-x" title="Kommentar entfernen">✕</button>`;
      h.querySelector(".gd-hinweis-x").addEventListener("click", (e) => {
        e.stopPropagation();
        const d = daten.get(g.id); if (d) d.hinweis = null;
        aktualisiereGedanke(g.id, { hinweis: null }).catch(() => {});
        h.remove();
      });
    } else if (h) { h.remove(); }
  }

  // Inline-Kommentarfeld (statt prompt) — Enter/Senden speichert + benachrichtigt.
  function zeigeKommentarBox(id) {
    const el = knoten.get(id); if (!el) return;
    let box = el.querySelector(".gd-hinweis-form");
    if (box) { box.remove(); return; }
    box = document.createElement("div");
    box.className = "gd-hinweis-form";
    box.innerHTML = `<input type="text" maxlength="200" placeholder="Kommentar für den Partner…"><button type="button">Senden</button>`;
    const kopf = el.querySelector(".gd-node-kopf");
    if (kopf) kopf.after(box); else el.appendChild(box);
    const inp = box.querySelector("input");
    const senden = () => {
      const t = (inp.value || "").trim(); if (!t) { inp.focus(); return; }
      const g = daten.get(id);
      const hinweis = { von: meineEmail, text: t, am: Date.now() };
      if (g) g.hinweis = hinweis;
      aktualisiereGedanke(id, { hinweis }).catch((err) => console.warn(err));
      if (g && g.neuVon && lc(g.neuVon) !== meineEmail) {
        benachrichtigungAnlegen({ fuer: lc(g.neuVon), von: meineEmail, text: `💬 Kommentar zu „${kurz(g.text)}": ${t}` }).catch(() => {});
      }
      box.remove();
      const elx = knoten.get(id); if (elx) wendeNeuAn(elx, daten.get(id) || {});
    };
    box.querySelector("button").addEventListener("click", (e) => { e.stopPropagation(); senden(); });
    inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); senden(); } });
    inp.addEventListener("pointerdown", (e) => e.stopPropagation());
    inp.focus();
  }

  // --- Knoten-Element bauen ---------------------------------------------
  function autoHoehe(ta) { ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight}px`; }

  function erzeugeKnoten(g) {
    const el = document.createElement("div");
    el.className = "gd-node";
    el.dataset.id = g.id;
    el.innerHTML = `
      <div class="gd-node-kopf">
        <input type="checkbox" class="gd-check" title="Erledigt" />
        <span class="gd-neu-wrap"></span>
        <div class="gd-node-tools">
          <button type="button" class="gd-farbe-btn" title="Farbe wählen" hidden></button>
          <button type="button" class="gd-todo" title="Als To-Do markieren (grün)" aria-pressed="false" hidden>◎</button>
          <button type="button" class="gd-ebene" title="Ebene wechseln: Gedanke → Sub → Bereich">—</button>
          <button type="button" class="gd-archiv-btn" title="Erledigten Gedanken ins Archiv verschieben">→ Archiv</button>
          <button type="button" class="gd-chevron" title="Ausführung ein-/ausklappen">▸</button>
          <button type="button" class="gd-attach" title="Datei anhängen">📎</button>
          <button type="button" class="gd-del" title="Gedanken löschen">✕</button>
        </div>
      </div>
      <textarea class="gd-text" rows="1" placeholder="Gedanke…"></textarea>
      <div class="gd-post" hidden></div>
      <div class="gd-node-body" hidden></div>
      <span class="gd-dock" data-seite="oben"></span>
      <span class="gd-dock" data-seite="rechts"></span>
      <span class="gd-dock" data-seite="unten"></span>
      <span class="gd-dock" data-seite="links"></span>`;

    const id    = g.id;
    const check = el.querySelector(".gd-check");
    const del   = el.querySelector(".gd-del");
    const attach = el.querySelector(".gd-attach");
    const chev  = el.querySelector(".gd-chevron");
    const ebeneBtn = el.querySelector(".gd-ebene");
    const todoBtn  = el.querySelector(".gd-todo");
    const farbeBtn = el.querySelector(".gd-farbe-btn");
    const archivBtn = el.querySelector(".gd-archiv-btn");
    const ta    = el.querySelector(".gd-text");

    // Ebene (Größe/Gewicht) + Farbe (To-Do/Post/Palette) + NEU initial anwenden.
    wendeEbeneAn(el, g.ebene);
    wendeFarbeAn(el, g);
    wendeNeuAn(el, g);
    // Post-Card: Medien-Bereich zeigen, Ebenen-Umschalter ausblenden.
    if ((g.kind || "gedanke") === "post") {
      el.classList.add("gd-node--post");
      ebeneBtn.hidden = true;
      zeichnePostMedia(el, id);
    }
    // Ebenen-Umschalter: Gedanke → Sub → Bereich → …
    ebeneBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const cur = ebeneOk((daten.get(id) || {}).ebene);
      const next = EBENEN[(EBENEN.indexOf(cur) + 1) % EBENEN.length];
      setzeEbene(id, next);
    });
    // To-Do-Umschalter (nur bei einzelnen Gedanken sichtbar → grün).
    todoBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setzeTodo(id, !((daten.get(id) || {}).todo === true));
    });
    // Farbwahl (feste Palette) — für Gedanken, Subs UND Bereiche;
    // ausgeblendet bei To-Do (grün fix) und Post (rosa fix).
    farbeBtn.addEventListener("click", (e) => { e.stopPropagation(); zeigeFarbPop(el, id); });

    // Archiv-Button: im aktiven Modus verschiebt er den (erledigten) Gedanken
    // ins Archiv; im Archiv-Modus holt er ihn zurück auf die Haupt-Leinwand.
    // Sichtbar ist er im aktiven Modus nur bei „erledigt" (per CSS), im Archiv
    // immer. Nach dem Schreiben liefert der Snapshot den Knoten in der anderen
    // Ansicht — hier verschwindet er also, dort erscheint er.
    if (ansicht === "archiv") { archivBtn.textContent = "↩ Zurück"; archivBtn.title = "Gedanken zurück auf die Haupt-Leinwand holen"; }
    else { archivBtn.textContent = "→ Archiv"; archivBtn.title = "Erledigten Gedanken ins Archiv verschieben"; }
    archivBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const zielArchiv = (ansicht !== "archiv");
      archivBtn.disabled = true;
      aktualisiereGedanke(id, { archiviert: zielArchiv })
        .catch((err) => { console.warn("Archiv-Status konnte nicht gespeichert werden:", err); archivBtn.disabled = false; });
    });

    check.addEventListener("change", () => {
      const wert = check.checked;
      el.classList.toggle("is-erledigt", wert);
      aktualisiereGedanke(id, { erledigt: wert }).catch((err) => {
        console.warn("Erledigt-Status konnte nicht gespeichert werden:", err);
        check.checked = !wert; el.classList.toggle("is-erledigt", !wert);
      });
    });

    // Überschrift: onBlur speichern (nur bei Änderung), Auto-Höhe.
    let textBeimFokus = "";
    ta.addEventListener("focus", () => { textBeimFokus = ta.value; });
    ta.addEventListener("input", () => autoHoehe(ta));
    ta.addEventListener("keydown", (e) => { if (e.key === "Escape") ta.blur(); });
    ta.addEventListener("blur", () => {
      if (ta.value === textBeimFokus) return;
      const d = daten.get(id); if (d) d.text = ta.value;
      aktualisiereGedanke(id, { text: ta.value }).catch((err) => console.warn(err));
      renderSidebar();
    });

    // Chevron → inline auf-/zuklappen.
    chev.addEventListener("click", (e) => { e.stopPropagation(); toggleOffen(id); });

    // 📎 → Datei-Dialog für diesen Gedanken.
    attach.addEventListener("click", (e) => { e.stopPropagation(); anhangZielId = id; fileInput.click(); });

    // Löschen mit Inline-Bestätigung.
    del.addEventListener("click", async () => {
      if (!del.classList.contains("is-bestaetigen")) {
        del.classList.add("is-bestaetigen"); del.textContent = "Löschen?"; return;
      }
      del.disabled = true;
      try {
        const aufraeumen = [];
        for (const other of daten.values()) {
          if (other.id !== id && (other.verbindungen || []).includes(id)) {
            aufraeumen.push(aktualisiereGedanke(other.id, { verbindungen: other.verbindungen.filter((v) => v !== id) }).catch(() => {}));
          }
        }
        // Blobs dieses Gedanken best-effort entfernen.
        (g.dateien || []).forEach((a) => { if (a.art === "datei" && a.blobId) loescheDateiblob(a.blobId).catch(() => {}); });
        await loescheGedanke(id);
        await Promise.all(aufraeumen);
        if (seiteId === id) schliesseSeite();
      } catch (err) {
        console.warn("Gedanke konnte nicht gelöscht werden:", err);
        del.disabled = false; del.classList.remove("is-bestaetigen"); del.textContent = "✕";
      }
    });

    // Docking-Punkte → Verbindung ziehen.
    el.querySelectorAll(".gd-dock").forEach((dock) => {
      dock.addEventListener("pointerdown", (e) => {
        e.stopPropagation(); e.preventDefault();
        dock.setPointerCapture(e.pointerId);
        const temp = document.createElementNS(SVGNS, "path");
        temp.setAttribute("class", "gd-edge gd-edge--temp");
        tempEbene.appendChild(temp);
        const start = mittelpunkt(id) || weltPunkt(e.clientX, e.clientY);
        const move = (ev) => { const z = weltPunkt(ev.clientX, ev.clientY); temp.setAttribute("d", pfad(mittelpunkt(id) || start, z)); };
        const up = (ev) => {
          dock.removeEventListener("pointermove", move);
          dock.removeEventListener("pointerup", up);
          dock.removeEventListener("pointercancel", up);
          temp.remove();
          if (ev.type !== "pointerup") return;
          const drunter = document.elementFromPoint(ev.clientX, ev.clientY);
          const zielNode = drunter && drunter.closest ? drunter.closest(".gd-node") : null;
          if (zielNode) verbinde(id, zielNode.dataset.id);
        };
        dock.addEventListener("pointermove", move);
        dock.addEventListener("pointerup", up);
        dock.addEventListener("pointercancel", up);
      });
    });

    // Doppelklick → Vollseite (nicht auf Buttons / Body).
    el.addEventListener("dblclick", (e) => {
      if (e.target.closest(".gd-check, .gd-todo, .gd-farbe-btn, .gd-farbe-pop, .gd-neu-wrap, .gd-hinweis, .gd-hinweis-form, .gd-del, .gd-attach, .gd-chevron, .gd-ebene, .gd-archiv-btn, .gd-dock, .gd-node-body")) return;
      oeffneSeite(id);
    });

    // Knoten-Drag (Pointer Events). Reiner Klick → Überschrift fokussieren.
    el.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (e.target.closest(".gd-check, .gd-todo, .gd-farbe-btn, .gd-farbe-pop, .gd-neu-wrap, .gd-hinweis, .gd-hinweis-form, .gd-del, .gd-attach, .gd-chevron, .gd-ebene, .gd-archiv-btn, .gd-dock, .gd-node-body")) return;
      if (e.target === ta && document.activeElement === ta) return;
      blurAktiv();
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const d0 = daten.get(id) || { x: 0, y: 0 };
      const start = { sx: e.clientX, sy: e.clientY, x: d0.x, y: d0.y };
      let dragging = false;
      const move = (ev) => {
        const dx = ev.clientX - start.sx, dy = ev.clientY - start.sy;
        if (!dragging && Math.hypot(dx, dy) < DRAG_SCHWELLE) return;
        if (!dragging) { dragging = true; aktiveInteraktion.add(id); el.classList.add("is-gezogen"); }
        const wx = start.x + dx / zoom, wy = start.y + dy / zoom; // Screen-Delta → Welt-Delta
        const d = daten.get(id);
        if (d) { d.x = wx; d.y = wy; }
        el.style.transform = `translate(${wx}px, ${wy}px)`;
        zeichneKanten();
      };
      const up = (ev) => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
        if (dragging) {
          aktiveInteraktion.delete(id); el.classList.remove("is-gezogen");
          const d = daten.get(id);
          if (d && ev.type === "pointerup") {
            aktualisiereGedanke(id, { x: Math.round(d.x), y: Math.round(d.y) }).catch((err) => console.warn(err));
          }
        } else if (ev.type === "pointerup") {
          ta.focus();
          const n = ta.value.length;
          try { ta.setSelectionRange(n, n); } catch (_) { /* egal */ }
        }
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    });

    return el;
  }

  // Bestehenden Knoten mit Snapshot-Daten abgleichen.
  function aktualisiereKnotenElement(el, g) {
    const check = el.querySelector(".gd-check");
    const ta    = el.querySelector(".gd-text");
    const attach = el.querySelector(".gd-attach");
    check.checked = !!g.erledigt;
    el.classList.toggle("is-erledigt", !!g.erledigt);
    // Ebene (Größe/Gewicht) nachziehen, falls anderswo geändert.
    if (!el.classList.contains("gd-node--" + ebeneOk(g.ebene))) wendeEbeneAn(el, g.ebene);
    // Farbe/To-Do/Palette + NEU-Markierung/Kommentar nachziehen.
    wendeFarbeAn(el, g);
    wendeNeuAn(el, g);
    // Post-Card: Medien nachziehen (nur wenn nichts im Post-Bereich fokussiert ist).
    if ((g.kind || "gedanke") === "post") {
      el.classList.add("gd-node--post");
      const eb = el.querySelector(".gd-ebene"); if (eb) eb.hidden = true;
      const pw = el.querySelector(".gd-post");
      if (pw && !pw.contains(document.activeElement)) zeichnePostMedia(el, g.id);
    }
    if (!aktiveInteraktion.has(g.id)) el.style.transform = `translate(${g.x}px, ${g.y}px)`;
    if (document.activeElement !== ta && ta.value !== (g.text || "")) { ta.value = g.text || ""; autoHoehe(ta); }
    // Anhang-Zähler am 📎
    const n = (g.dateien || []).length;
    attach.textContent = n ? `📎 ${n}` : "📎";
    el.classList.toggle("has-anhang", n > 0);
    // Offener Inline-Body: nur neu zeichnen, wenn kein Feld darin fokussiert ist.
    const body = el.querySelector(".gd-node-body");
    if (offen.has(g.id) && !body.contains(document.activeElement)) zeichneKnotenBody(el, g.id);
  }

  // --- Seitenleiste (Liste aller Gedanken) ------------------------------
  function renderSidebar() {
    const arr = [...daten.values()].filter(istSichtbar);
    if (!arr.length) { liste.innerHTML = `<div class="gd-liste-leer muted">${ansicht === "archiv" ? "Archiv ist noch leer." : "Noch keine Gedanken."}</div>`; return; }
    liste.innerHTML = "";
    arr.forEach((g) => {
      const row = document.createElement("div");
      row.className = "gd-liste-item ebene-" + ebeneOk(g.ebene) + (g.erledigt ? " is-erledigt" : "");
      const t = document.createElement("button");
      t.type = "button"; t.className = "gd-liste-titel";
      t.textContent = g.text || "Unbenannter Gedanke";
      t.title = "Zum Gedanken springen";
      t.addEventListener("click", () => { zuKnoten(g.id); if (window.matchMedia("(max-width: 760px)").matches) sidebar.classList.remove("is-open"); });
      const meta = document.createElement("span");
      meta.className = "gd-liste-meta muted";
      const n = (g.dateien || []).length;
      meta.textContent = n ? `📎${n}` : "";
      const oeff = document.createElement("button");
      oeff.type = "button"; oeff.className = "gd-liste-oeffnen"; oeff.textContent = "⤢"; oeff.title = "Voll öffnen";
      oeff.addEventListener("click", () => oeffneSeite(g.id));
      row.append(t, meta, oeff);
      liste.appendChild(row);
    });
  }

  container.querySelector("#gdSidebarBtn").addEventListener("click", () => sidebar.classList.toggle("is-open"));
  container.querySelector("#gdSidebarZu").addEventListener("click", () => sidebar.classList.remove("is-open"));

  // --- Archiv-Ansicht umschalten ----------------------------------------
  // Zentriert den Ausschnitt grob auf den Schwerpunkt der sichtbaren Knoten
  // (nützlich, wenn die archivierten Gedanken abseits des aktuellen Bildes liegen).
  function zentriereAufSichtbare() {
    const pts = [...daten.values()].filter(istSichtbar);
    if (!pts.length) return;
    let sx = 0, sy = 0;
    for (const g of pts) { sx += g.x; sy += g.y; }
    const r = canvas.getBoundingClientRect();
    panX = Math.round(r.width / 2 - (sx / pts.length) * zoom);
    panY = Math.round(r.height / 2 - (sy / pts.length) * zoom);
    wendePanAn();
  }
  const ansichtCache = { aktiv: null, archiv: null };  // je Ansicht letzter Ausschnitt
  const archivToggle = container.querySelector("#gdArchivToggle");
  const modusBanner  = container.querySelector("#gdModusBanner");
  archivToggle.addEventListener("click", () => {
    ansichtCache[ansicht] = { panX, panY, zoom };       // Ausschnitt der verlassenen Ansicht merken
    ansicht = (ansicht === "archiv") ? "aktiv" : "archiv";
    const imArchiv = ansicht === "archiv";
    archivToggle.classList.toggle("is-active", imArchiv);
    archivToggle.setAttribute("aria-pressed", String(imArchiv));
    archivToggle.textContent = imArchiv ? "← Zurück zur Mindmap" : "🗄 Archiv";
    modusBanner.hidden = !imArchiv;
    canvas.classList.toggle("gd-archiv-modus", imArchiv);
    leer.textContent = imArchiv
      ? "Archiv ist noch leer — hake einen Gedanken ab und schick ihn mit „→ Archiv“ hierher."
      : "Noch keine Gedanken — leg deinen ersten an.";
    // Ansicht sofort aus dem lokalen Cache neu aufbauen (ohne auf Firestore zu warten).
    if (seiteId) schliesseSeite();
    for (const [id, el] of knoten) { el.remove(); knoten.delete(id); }
    reconcile([...daten.values()]);
    const gemerkt = ansichtCache[ansicht];
    if (gemerkt) { panX = gemerkt.panX; panY = gemerkt.panY; zoom = gemerkt.zoom; wendePanAn(); }
    else { zentriereAufSichtbare(); }
  });

  // Zoom-Steuerung: nur noch Mausrad + Pinch (Fokus am Cursor bzw. Finger-Mittelpunkt).
  canvas.addEventListener("wheel", (e) => {
    // In Textfeldern/Media normales Scrollen zulassen, sonst zoomen.
    if (e.target.closest && e.target.closest("textarea, input, .gd-anh-media, .gd-md-preview")) return;
    e.preventDefault();
    setzeZoom(zoom * (e.deltaY < 0 ? 1.1 : 0.9), e.clientX, e.clientY);
  }, { passive: false });

  // --- Reconcile ---------------------------------------------------------
  function reconcile(listeDaten) {
    const alleIds = new Set(listeDaten.map((g) => g.id));
    // Gelöschte Gedanken vollständig vergessen (ansichtsübergreifend).
    for (const id of [...daten.keys()]) {
      if (!alleIds.has(id)) {
        daten.delete(id); aktiveInteraktion.delete(id); offen.delete(id);
        if (seiteId === id) schliesseSeite();
      }
    }
    // daten-Map hält ALLE Gedanken (für Kanten/Verwandt über beide Ansichten).
    for (const g of listeDaten) {
      if (aktiveInteraktion.has(g.id)) { const alt = daten.get(g.id); if (alt) { g.x = alt.x; g.y = alt.y; } }
      daten.set(g.id, g);
    }
    // Knoten-Elemente entfernen, die nicht (mehr) in die aktuelle Ansicht gehören
    // — etwa weil gerade archiviert/zurückgeholt wurde.
    for (const [id, el] of knoten) {
      const g = daten.get(id);
      if (!g || !istSichtbar(g)) { el.remove(); knoten.delete(id); }
    }
    // Nur die sichtbare Ansicht rendern/aktualisieren.
    let sichtbar = 0;
    for (const g of listeDaten) {
      if (!istSichtbar(g)) continue;
      sichtbar++;
      let el = knoten.get(g.id);
      if (!el) {
        el = erzeugeKnoten(g);
        el.style.transform = `translate(${g.x}px, ${g.y}px)`;
        welt.appendChild(el);
        knoten.set(g.id, el);
        const ta = el.querySelector(".gd-text");
        ta.value = g.text || ""; autoHoehe(ta);
        el.querySelector(".gd-check").checked = !!g.erledigt;
        el.classList.toggle("is-erledigt", !!g.erledigt);
        const n = (g.dateien || []).length;
        el.querySelector(".gd-attach").textContent = n ? `📎 ${n}` : "📎";
        el.classList.toggle("has-anhang", n > 0);
        if (fokusId === g.id) { fokusId = null; ta.focus(); }
      } else {
        aktualisiereKnotenElement(el, g);
      }
    }
    leer.hidden = !(geladen && sichtbar === 0);
    zeichneKanten();
    renderSidebar();
    aktualisiereNeuAlle();
    // Offene Vollseite auffrischen (Verwandt/Dateien), wenn dort nichts fokussiert ist.
    if (seiteId && daten.has(seiteId) && !seite.contains(document.activeElement)) {
      const body = seite.querySelector("#gdSeiteBody");
      const titel = seite.querySelector("#gdSeiteTitel");
      if (titel && document.activeElement !== titel) titel.value = (daten.get(seiteId).text || "");
      if (body) { body.innerHTML = ""; body.appendChild(baueKoerper(seiteId, true)); }
    } else if (seiteId && !daten.has(seiteId)) {
      schliesseSeite();
    }
  }

  // --- Leinwand-Pan (1 Finger/Maus) + Pinch-Zoom (2 Finger) --------------
  // Alle auf leerer Fläche gestarteten Pointer werden zentral verwaltet:
  //   1 aktiver Pointer  → Pan (Ausschnitt verschieben)
  //   2 aktive Pointer   → Pinch: Abstand steuert den Zoom, der Finger-
  //                        Mittelpunkt bleibt als Fokus im Bild.
  // Der Zoom skaliert die DOM-Welt per CSS-transform → Knoten/Text bleiben
  // vektor-scharf (kein Bitmap, kein Qualitätsverlust auf jeder Stufe).
  const pointer = new Map();   // pointerId → {x, y}
  let panStart = null;         // {sx, sy, px, py}
  let pinchStart = null;       // {dist, zoom}

  function pinchMetrik() {
    const pts = [...pointer.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
    return { dist, cx: (pts[0].x + pts[1].x) / 2, cy: (pts[0].y + pts[1].y) / 2 };
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target !== canvas && e.target !== welt) return;   // nur leere Fläche pannt/zoomt
    blurAktiv();
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    pointer.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointer.size === 1) {
      canvas.classList.add("is-pan");
      panStart = { sx: e.clientX, sy: e.clientY, px: panX, py: panY };
      pinchStart = null;
    } else if (pointer.size === 2) {
      canvas.classList.remove("is-pan");   // aus Pan raus, in Pinch rein
      panStart = null;
      pinchStart = { dist: pinchMetrik().dist, zoom };
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!pointer.has(e.pointerId)) return;
    pointer.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinchStart && pointer.size >= 2) {
      const m = pinchMetrik();
      setzeZoom(pinchStart.zoom * (m.dist / pinchStart.dist), m.cx, m.cy);
    } else if (panStart && pointer.size === 1) {
      panX = panStart.px + (e.clientX - panStart.sx);
      panY = panStart.py + (e.clientY - panStart.sy);
      wendePanAn();
    }
  });

  function pointerWeg(e) {
    if (!pointer.has(e.pointerId)) return;
    pointer.delete(e.pointerId);
    if (pointer.size < 2) pinchStart = null;
    if (pointer.size === 1) {
      // von Pinch zurück auf einen Finger → Pan an dessen Position neu ankern
      const p = [...pointer.values()][0];
      panStart = { sx: p.x, sy: p.y, px: panX, py: panY };
      canvas.classList.add("is-pan");
    } else if (pointer.size === 0) {
      panStart = null;
      canvas.classList.remove("is-pan");
    }
  }
  canvas.addEventListener("pointerup", pointerWeg);
  canvas.addEventListener("pointercancel", pointerWeg);

  // Klick woanders bricht offene Lösch-Bestätigungen ab.
  const bestaetigungAbbrechen = (e) => {
    const geklickt = e.target.closest ? e.target.closest(".gd-del") : null;
    container.querySelectorAll(".gd-del.is-bestaetigen").forEach((b) => {
      if (b !== geklickt) { b.classList.remove("is-bestaetigen"); b.textContent = "✕"; }
    });
  };
  container.addEventListener("pointerdown", bestaetigungAbbrechen, true);
  beiViewWechsel(() => container.removeEventListener("pointerdown", bestaetigungAbbrechen, true));

  // --- Neuer Gedanke (Ebene + optional Post-Card) ------------------------
  async function neuerGedanke(opts) {
    const o = typeof opts === "string" ? { ebene: opts } : (opts || {});
    const kind = o.kind === "post" ? "post" : "gedanke";
    const e = kind === "post" ? "gedanke" : ebeneOk(o.ebene);  // Posts sind immer Leaf-Ebene
    const todo = kind === "post";                              // Post ist per Default To-Do
    const r = canvas.getBoundingClientRect();
    neuZaehler++;
    const versatz = (neuZaehler % 5) * 26 - 52;
    const breite = e === "bereich" ? 300 : e === "sub" ? 250 : KNOTEN_B;
    const worldCX = (r.width / 2 - panX) / zoom;   // Welt-Mitte des Ausschnitts
    const worldCY = (r.height / 2 - panY) / zoom;
    const x = Math.round(worldCX - breite / 2 + versatz);
    const y = Math.round(worldCY - KNOTEN_H / 2 + (neuZaehler % 3) * 22);
    try {
      const ref = await gedankeAnlegen({ text: "", ebene: e, kind, todo, mapId: aktiveMapId, neuVon: aktiveMapGeteilt() ? meineEmail : null, detail: "", x, y, erledigt: false, farbe: null, verbindungen: [], dateien: [], archiviert: ansicht === "archiv" });
      fokusId = ref.id;
      const el = knoten.get(ref.id);
      if (el) { fokusId = null; el.querySelector(".gd-text").focus(); }
    } catch (err) {
      console.warn("Gedanke konnte nicht angelegt werden:", err);
      status.hidden = false; status.classList.add("is-fehler");
      status.textContent = "Konnte nicht speichern — bitte später erneut versuchen.";
    }
  }
  container.querySelector("#gdNeuBereich").addEventListener("click", () => neuerGedanke("bereich"));
  container.querySelector("#gdNeuSub").addEventListener("click", () => neuerGedanke("sub"));
  container.querySelector("#gdNeuGedanke").addEventListener("click", () => neuerGedanke("gedanke"));
  container.querySelector("#gdNeuPost").addEventListener("click", () => neuerGedanke({ ebene: "gedanke", kind: "post" }));

  // Leinwand komplett aus dem lokalen Datenstand neu aufbauen (Filter-/Map-Wechsel).
  function neuZeichnenAusDaten() {
    if (seiteId) schliesseSeite();
    for (const [id, el] of knoten) { el.remove(); knoten.delete(id); }
    reconcile([...daten.values()]);
  }

  // Filter: Alle | Nur To-Dos | Nur beständige (Bereiche/Subs bleiben sichtbar).
  const filterSelect = container.querySelector("#gdFilter");
  filterSelect.value = filterModus;
  filterSelect.addEventListener("change", () => {
    filterModus = filterSelect.value;
    neuZeichnenAusDaten();
  });

  // „Alle Neu akzeptieren": sichtbar, sobald fremde neue Elemente in der
  // aktuellen Ansicht liegen. Ein Klick erkennt alle an + benachrichtigt.
  const neuAlleBtn = container.querySelector("#gdNeuAlle");
  function aktualisiereNeuAlle() {
    if (!neuAlleBtn) return;
    const neue = [...daten.values()].filter((g) => istSichtbar(g) && g.neuVon && lc(g.neuVon) !== meineEmail);
    neuAlleBtn.hidden = !neue.length;
    if (neue.length) neuAlleBtn.textContent = `✓ ${neue.length} Neue akzeptieren`;
  }
  neuAlleBtn.addEventListener("click", () => {
    const neue = [...daten.values()].filter((g) => istSichtbar(g) && g.neuVon && lc(g.neuVon) !== meineEmail);
    const proAutor = new Map();
    neue.forEach((g) => {
      const autor = lc(g.neuVon);
      proAutor.set(autor, (proAutor.get(autor) || 0) + 1);
      g.neuVon = null;
      const el = knoten.get(g.id); if (el) wendeNeuAn(el, g);
      aktualisiereGedanke(g.id, { neuVon: null }).catch(() => {});
    });
    for (const [autor, n] of proAutor) {
      if (autor && autor !== meineEmail) {
        benachrichtigungAnlegen({ fuer: autor, von: meineEmail, text: `✓ ${meineEmail} hat ${n} neue Element${n === 1 ? "" : "e"} anerkannt` }).catch(() => {});
      }
    }
    aktualisiereNeuAlle();
  });

  // --- Mehrere Mindmaps (④): Dropdown + „+ Karte" -----------------------
  const mapSelect   = container.querySelector("#gdMapSelect");
  const mapNeuWrap  = container.querySelector("#gdMapNeu");
  const mapNeuBtn   = container.querySelector("#gdNeuMap");
  const mapNeuInput = container.querySelector("#gdMapNeuInput");
  const mapDelBtn   = container.querySelector("#gdMapDel");

  // Kollaborator: Name/Mitglieder der geteilten Map nachladen (fürs Dropdown
  // und die Geteilt-Erkennung des Neu-/Akzeptier-Systems).
  let kollabMapDoc = null;
  if (istKollab && kollabMapId) {
    ladeMindmap(kollabMapId).then((d) => { kollabMapDoc = d; renderMapSelect(); }).catch(() => {});
  }

  // Maps, die dieser Nutzer sieht: Admin = Standard + Maps, in denen er
  // Mitglied ist (Altbestände ohne mitglieder-Feld gehören ihm). Kollaborator =
  // geteilte Map + selbst angelegte. Private Maps des Partners tauchen hier
  // bewusst NICHT auf.
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
  function aktuelleMap() { return meineMaps().find((m) => m.id === aktiveMapId) || null; }
  // Geteilte Map (>1 Mitglied) → Neu-/Akzeptier-System aktiv (④).
  function aktiveMapGeteilt() {
    const m = aktuelleMap();
    return !!(m && Array.isArray(m.mitglieder) && m.mitglieder.length > 1);
  }

  function renderMapSelect() {
    const optionen = meineMaps();
    if (!optionen.some((o) => o.id === aktiveMapId)) optionen.push({ id: aktiveMapId, name: "(lädt …)" });
    mapSelect.innerHTML = optionen.map((o) =>
      `<option value="${escapeHtml(o.id)}"${o.id === aktiveMapId ? " selected" : ""}>${escapeHtml(o.name || "Unbenannt")}</option>`).join("");
    // Löschen: Admin alles außer Standard; Kollaborator nur selbst angelegte Maps.
    const m = aktuelleMap();
    mapDelBtn.hidden = istKollab ? !(m && lc(m.besitzer) === meineEmail) : aktiveMapId === DEFAULT_MAP;
    mapDelBtn.classList.remove("is-bestaetigen");
    mapDelBtn.textContent = "🗑 Karte";
  }

  // Aktuelle Map + alle ihre Gedanken löschen (2-Klick-Bestätigung am Button).
  mapDelBtn.addEventListener("click", async () => {
    if (aktiveMapId === DEFAULT_MAP) return;
    const inMap = [...daten.values()].filter((g) => (g.mapId || DEFAULT_MAP) === aktiveMapId);
    if (!mapDelBtn.classList.contains("is-bestaetigen")) {
      mapDelBtn.classList.add("is-bestaetigen");
      mapDelBtn.textContent = inMap.length ? `Karte + ${inMap.length} löschen?` : "Karte löschen?";
      return;
    }
    mapDelBtn.disabled = true;
    try {
      for (const g of inMap) {
        (g.dateien || []).forEach((a) => { if (a.art === "datei" && a.blobId) loescheDateiblob(a.blobId).catch(() => {}); });
        await loescheGedanke(g.id).catch(() => {});
      }
      await loescheMindmap(aktiveMapId);   // beobachteMindmaps-Callback wechselt zurück auf Standard
    } catch (err) { console.warn("Mindmap löschen fehlgeschlagen:", err); toast("Mindmap konnte nicht gelöscht werden."); }
    mapDelBtn.disabled = false;
  });
  function wechsleMap(mapId) {
    if (mapId === aktiveMapId) return;
    aktiveMapId = mapId;
    localStorage.setItem(LS_MAP_KEY, mapId);
    if (istKollab) starteGedankenListener();   // Kollaborator lädt Gedanken pro Map
    neuZeichnenAusDaten();
    zentriereAufSichtbare();
    renderMapSelect();
  }
  mapSelect.addEventListener("change", () => wechsleMap(mapSelect.value));

  function zeigeMapNeu(zeigen) {
    mapNeuWrap.hidden = !zeigen;
    mapNeuBtn.hidden = zeigen;
    if (zeigen) { mapNeuInput.value = ""; mapNeuInput.focus(); }
  }
  mapNeuBtn.addEventListener("click", () => zeigeMapNeu(true));
  container.querySelector("#gdMapNeuAbbr").addEventListener("click", () => zeigeMapNeu(false));
  async function legeMapAn() {
    const name = (mapNeuInput.value || "").trim();
    if (!name) { mapNeuInput.focus(); return; }
    try {
      const ref = await mindmapAnlegen({ name, besitzer: meineEmail, mitglieder: [meineEmail] });
      zeigeMapNeu(false);
      aktiveMapId = ref.id;                                  // zur neuen (leeren) Map wechseln
      localStorage.setItem(LS_MAP_KEY, ref.id);
      if (istKollab) starteGedankenListener();
      renderMapSelect();
      neuZeichnenAusDaten();
      zentriereAufSichtbare();
    } catch (err) { console.warn("Mindmap konnte nicht angelegt werden:", err); toast("Mindmap konnte nicht angelegt werden."); }
  }
  container.querySelector("#gdMapNeuOk").addEventListener("click", legeMapAn);
  mapNeuInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); legeMapAn(); }
    else if (e.key === "Escape") zeigeMapNeu(false);
  });

  renderMapSelect();
  const mapsCallback = (liste) => {
    mindmaps = liste;
    // Gemerkte Map nicht (mehr) verfügbar? → zurück auf die Basis-Map.
    if (!meineMaps().some((m) => m.id === aktiveMapId)) {
      aktiveMapId = istKollab ? (kollabMapId || DEFAULT_MAP) : DEFAULT_MAP;
      localStorage.setItem(LS_MAP_KEY, aktiveMapId);
      if (istKollab) starteGedankenListener();
      neuZeichnenAusDaten(); zentriereAufSichtbare();
    }
    renderMapSelect();
  };
  mapUnsub = istKollab
    ? beobachteMeineMindmaps(meineEmail, mapsCallback, (err) => console.warn("Mindmaps laden fehlgeschlagen:", err))
    : beobachteMindmaps(mapsCallback, (err) => console.warn("Mindmaps laden fehlgeschlagen:", err));
  beiViewWechsel(() => { if (mapUnsub) { try { mapUnsub(); } catch (_) { /* egal */ } mapUnsub = null; } });

  // --- Realtime-Listener -------------------------------------------------
  // Admin: alle Gedanken (eine Query, clientseitig gefiltert). Kollaborator:
  // pro aktiver Map (where mapId) — die Rules verweigern ihm eine Query über
  // alle Maps; beim Map-Wechsel wird neu abonniert.
  wendePanAn();
  let gedankenUnsub = null;
  function starteGedankenListener() {
    if (gedankenUnsub) { try { gedankenUnsub(); } catch (_) { /* egal */ } gedankenUnsub = null; }
    gedankenUnsub = beobachteGedanken(
      (listeDaten) => { geladen = true; status.hidden = true; status.classList.remove("is-fehler"); reconcile(listeDaten); },
      (err) => {
        console.warn("Gedanken konnten nicht geladen werden:", err);
        status.hidden = false; status.classList.add("is-fehler");
        status.textContent = `Konnte nicht laden${err && err.message ? ` (${String(err.message)})` : ""}…`;
      },
      istKollab ? aktiveMapId : undefined
    );
  }
  starteGedankenListener();
  beiViewWechsel(() => { if (gedankenUnsub) { try { gedankenUnsub(); } catch (_) { /* egal */ } gedankenUnsub = null; } });
}
