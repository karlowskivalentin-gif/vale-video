// Admin-View: Fokus (Admin-only) — drei Tabs auf einer Seite:
//   1) Timer   — Fokus-Session (Forest-Stil): wachsender Ring + Pflanze,
//                Presets 25/45/60/90 Min, Name vorm Start, Pause, „Beenden"
//                (zählt) / „Abbrechen" (zählt nicht), Ton am Ende.
//   2) Videos  — kuratierte YouTube-Anspielliste zum Fokussieren: großer
//                Inline-Player oben, Karten-Grid darunter, „+ Video" fügt per
//                Link neue hinzu (Titel/Thumbnail via noembed automatisch).
//                Persistiert in Firestore („fokusvideos", siehe db.js), Loop.
//   3) Verlauf — abgeschlossene Sessions aus Firestore („fokussessions"):
//                Summen (heute/Woche/gesamt), Streak, Balken (14 Tage), Liste.
//   Der Kunde sieht diesen Bereich nie.
import { beiViewWechsel } from "../view-lifecycle.js";
import { youtubeId } from "../drive.js";
import { escapeHtml, formatDatum, mdZuHtml,
         tagKey, isoKW, wochenKey, monatKey, MONATE_KURZ } from "../util.js";
import { fokusvideoAnlegen, aktualisiereFokusvideo, beobachteFokusvideos, loescheFokusvideo,
         fokusSessionAnlegen, beobachteFokusSessions, loescheFokusSession,
         beobachteGedanken, aktualisiereGedanke } from "../db.js";

const LS_SESSION = "vale_fokus_session";   // laufende/pausierte Session
const LS_STATS   = "vale_fokus_stats";     // Tages-Zähler (Sessions + Minuten)
const LS_TAB     = "vale_fokus_tab";       // zuletzt aktiver Tab ('timer'|'videos'|'verlauf')
const LS_VERTEIL = "vale_fokus_verteilung"; // Zeitraum der Fokus-Verteilung ('heute'|'woche'|'monat'|'gesamt')
const VERTEIL_ZR = ["heute", "woche", "monat", "gesamt"];
const LS_STAT_GRAN = "vale_fokus_stat_gran"; // Granularität des Zeitverlaufs ('tag'|'woche'|'monat')
const STAT_GRAN  = ["tag", "woche", "monat"];
const LS_VT_GRUPP = "vale_fokus_vt_grupp";  // Gruppierung der Projekt-Verteilung ('name'|'kategorie')
const VT_GRUPP   = ["name", "kategorie"];
const TABS       = ["timer", "videos", "verlauf", "statistik"];
const PRESETS    = [25, 45, 60, 90];
const R = 120;                             // Ring-Radius (SVG-Einheiten)
const C = 2 * Math.PI * R;                 // Umfang für stroke-dasharray

// ===================================================================
// Persistenter Mini-Player (Modul-Singleton) — läuft über Tab-/View-
// Wechsel hinweg weiter. Das iframe lebt in einem fixed Container an
// document.body (außerhalb von #app) und wird NIE re-parentet → nie neu
// geladen. So spielt das Fokus-Video weiter, egal ob man auf Timer/
// Verlauf/Gedanken wechselt. Schließen stoppt es (iframe entfernt).
// ===================================================================
let floatEl = null;      // Container an document.body
let floatVid = null;     // aktuell laufende YouTube-ID (null = nichts)

function floatEmbedUrl(vid, loop) {
  const id = encodeURIComponent(vid);
  const base = `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&autoplay=1`;
  return loop ? `${base}&loop=1&playlist=${id}` : base;
}
function ensureFloat() {
  if (floatEl) return floatEl;
  floatEl = document.createElement("div");
  floatEl.className = "fokus-float";
  floatEl.hidden = true;
  floatEl.innerHTML = `
    <div class="fokus-float-bar">
      <span class="fokus-float-titel" id="ffTitel">Fokus-Video</span>
      <button class="fokus-float-min" id="ffMin" type="button" title="Minimieren" aria-label="Minimieren">–</button>
      <button class="fokus-float-close" id="ffClose" type="button" title="Schließen" aria-label="Schließen">✕</button>
    </div>
    <div class="fokus-float-body" id="ffBody"></div>`;
  document.body.appendChild(floatEl);
  floatEl.querySelector("#ffClose").addEventListener("click", schliesseFloat);
  floatEl.querySelector("#ffMin").addEventListener("click", () => floatEl.classList.toggle("is-min"));
  return floatEl;
}
function spieleImFloat(vid, titel, loop) {
  const el = ensureFloat();
  floatVid = vid;
  el.querySelector("#ffTitel").textContent = titel || "Fokus-Video";
  el.querySelector("#ffBody").innerHTML = `<iframe src="${escapeHtml(floatEmbedUrl(vid, loop))}"
    title="Fokus-Video" loading="lazy"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
    allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  el.hidden = false; el.classList.remove("is-min");
  document.dispatchEvent(new CustomEvent("fokusfloat:change"));
}
function schliesseFloat() {
  floatVid = null;
  if (floatEl) { floatEl.querySelector("#ffBody").innerHTML = ""; floatEl.hidden = true; }
  document.dispatchEvent(new CustomEvent("fokusfloat:change"));
}

export function renderAdminFokus(container) {
  // --- gemeinsamer State ----------------------------------------------
  let ticker = null;        // Timer: setInterval-Handle
  let audioCtx = null;      // Timer: WebAudio (erst bei Start → User-Geste)
  let gewaehltMin = 25;     // Timer: aktuell gewählte Dauer im Idle-Zustand
  let gewaehlterModus = "fokus"; // 'fokus' | 'pomodoro' | 'stoppuhr'
  let pomoWork = 25, pomoBreak = 5;  // Pomodoro-Konfiguration (Minuten)
  let vollEl = null;        // Vollbild-Overlay (Singleton an document.body)

  let videoUnsub = null;    // Videos: Firestore-onSnapshot-Abbestellung
  let videos = [];          // Videos: zuletzt bekannte Liste
  let aktivesVideoId = null;// Videos: gerade im Player geladenes Video
  let formOffen = false;    // Videos: ist das „+"-Formular offen?

  let sessionUnsub = null;  // Verlauf: Firestore-onSnapshot-Abbestellung
  let sessions = [];        // Verlauf: zuletzt bekannte Session-Liste
  let gewaehlterName = "";  // Timer: benannter Session-Titel im Idle-Zustand
  let gewaehlteKat = "";    // Timer: gewählte Kategorie (Sub-Id) im Idle-Zustand

  let gedankenUnsub = null; // Kategorien/To-Dos: onSnapshot der Gedanken
  let alleGedanken = [];    // zuletzt bekannte Gedanken (für Sub-Kategorien + To-Dos)

  let aktiverTab = TABS.includes(localStorage.getItem(LS_TAB)) ? localStorage.getItem(LS_TAB) : "timer";
  let verteilZeitraum = VERTEIL_ZR.includes(localStorage.getItem(LS_VERTEIL)) ? localStorage.getItem(LS_VERTEIL) : "gesamt";
  let statGran = STAT_GRAN.includes(localStorage.getItem(LS_STAT_GRAN)) ? localStorage.getItem(LS_STAT_GRAN) : "woche";
  let vtGruppierung = VT_GRUPP.includes(localStorage.getItem(LS_VT_GRUPP)) ? localStorage.getItem(LS_VT_GRUPP) : "name";

  container.innerHTML = `
    <div class="admin-head">
      <h1 class="view-title" style="margin:0">Fokus</h1>
    </div>
    <div class="fokus-tabs" role="tablist">
      <button class="fokus-tab" data-tab="timer"     type="button" role="tab">Timer</button>
      <button class="fokus-tab" data-tab="videos"    type="button" role="tab">Videos</button>
      <button class="fokus-tab" data-tab="verlauf"   type="button" role="tab">Verlauf</button>
      <button class="fokus-tab" data-tab="statistik" type="button" role="tab">Statistik</button>
    </div>
    <div id="fokusBody"></div>`;

  const body = container.querySelector("#fokusBody");
  const tabBtns = container.querySelectorAll(".fokus-tab");

  function markiereTab() {
    tabBtns.forEach((b) => b.classList.toggle("is-active", b.getAttribute("data-tab") === aktiverTab));
  }
  function stoppeTimer() { if (ticker) { clearInterval(ticker); ticker = null; } }
  function stoppeVideos() { if (videoUnsub) { try { videoUnsub(); } catch (_) { /* egal */ } videoUnsub = null; } }
  function stoppeSessions() { if (sessionUnsub) { try { sessionUnsub(); } catch (_) { /* egal */ } sessionUnsub = null; } }

  function wechsleTab(tab) {
    if (tab === aktiverTab) return;
    aktiverTab = tab;
    localStorage.setItem(LS_TAB, tab);
    markiereTab();
    zeichneAktivenTab();
  }
  function zeichneAktivenTab() {
    if (aktiverTab === "videos") { stoppeTimer(); stoppeSessions(); zeichneVideos(); }
    else if (aktiverTab === "verlauf") { stoppeTimer(); stoppeVideos(); aktivesVideoId = null; formOffen = false; zeichneVerlauf(); }
    else if (aktiverTab === "statistik") { stoppeTimer(); stoppeVideos(); aktivesVideoId = null; formOffen = false; zeichneStatistik(); }
    else { stoppeVideos(); stoppeSessions(); aktivesVideoId = null; formOffen = false; zeichne(); }
  }
  tabBtns.forEach((b) => b.addEventListener("click", () => wechsleTab(b.getAttribute("data-tab"))));

  // ===================================================================
  // TIMER  (Logik unverändert gegenüber der ursprünglichen Fokus-View)
  // ===================================================================

  // --- Persistenz ------------------------------------------------------
  function ladeSession() {
    try { return JSON.parse(localStorage.getItem(LS_SESSION) || "null"); }
    catch (_) { return null; }
  }
  function speichereSession(s) { localStorage.setItem(LS_SESSION, JSON.stringify(s)); }
  function loescheSession() { localStorage.removeItem(LS_SESSION); }

  function heute() { return new Date().toISOString().slice(0, 10); }
  function ladeStats() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(LS_STATS) || "null"); } catch (_) { /* egal */ }
    if (!s || s.datum !== heute()) s = { datum: heute(), sessions: 0, minuten: 0 };
    return s;
  }
  function addStat(min) {
    const s = ladeStats();
    s.sessions += 1; s.minuten += min;
    localStorage.setItem(LS_STATS, JSON.stringify(s));
  }

  // --- Restzeit / Helfer ----------------------------------------------
  function aktuellerRest(sess) {
    if (!sess) return 0;
    if (sess.status === "paused") return sess.restSek;
    return Math.max(0, Math.round((sess.endeAt - Date.now()) / 1000));
  }
  function mmss(sek) {
    const m = Math.floor(sek / 60), s = sek % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  function pflanze(f) { return f < 0.25 ? "🌱" : f < 0.5 ? "🌿" : f < 0.8 ? "🪴" : "🌳"; }

  // --- Ton + Benachrichtigung am Ende ---------------------------------
  function piep() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const now = audioCtx.currentTime;
      [0, 0.26, 0.52].forEach((t, i) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = "sine"; o.frequency.value = 660 + i * 220;
        g.gain.setValueAtTime(0.0001, now + t);
        g.gain.exponentialRampToValueAtTime(0.3, now + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.22);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(now + t); o.stop(now + t + 0.24);
      });
    } catch (e) { console.warn("Fokus-Ton nicht möglich:", e); }
  }
  function benachrichtige(min) {
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("Fokus-Session geschafft! 🌳", { body: `${min} Minuten am Stück. Gönn dir eine Pause.` });
      }
    } catch (_) { /* egal */ }
  }

  // --- Render-Bausteine ------------------------------------------------
  function ringSvg(fortschritt, plant, zeit) {
    return `
      <svg class="fokus-ring" viewBox="0 0 280 280" aria-hidden="true">
        <circle class="fokus-ring-track" cx="140" cy="140" r="${R}"></circle>
        <circle id="fokusRingFill" class="fokus-ring-fill" cx="140" cy="140" r="${R}"
          stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${(C * (1 - fortschritt)).toFixed(2)}"></circle>
      </svg>
      <div class="fokus-center">
        <div class="fokus-pflanze" id="fokusPflanze">${plant}</div>
        <div class="fokus-zeit" id="fokusZeit">${zeit}</div>
      </div>`;
  }

  function aktualisiereRing(rest, dauerSek) {
    const f = dauerSek > 0 ? (dauerSek - rest) / dauerSek : 0;
    const t = body.querySelector("#fokusZeit"); if (t) t.textContent = mmss(rest);
    const ring = body.querySelector("#fokusRingFill"); if (ring) ring.style.strokeDashoffset = String((C * (1 - f)).toFixed(2));
    const pl = body.querySelector("#fokusPflanze"); if (pl) pl.textContent = pflanze(f);
  }

  // --- Kategorien (= ALLE Subs/Bereiche, automatisch) + verbundene To-Dos --
  // Jeder neue Sub/Bereich taucht sofort als Fokus-Kategorie auf — das
  // frühere 🎯-Häkchen entfällt.
  function subKategorien() {
    return alleGedanken
      .filter((g) => (g.ebene === "sub" || g.ebene === "bereich" || g.ebene === "untersub") && !g.archiviert)
      .map((g) => ({ id: g.id, name: g.text || "Unbenannter Sub" }))
      .sort((a, b) => a.name.localeCompare(b.name, "de"));
  }
  // Nicht erledigte einzelne Gedanken, die mit dem Sub verbunden sind.
  // ❗ Dringliche ganz oben, danach die manuelle Reihenfolge aus der To-Do-Liste.
  function todosFuerSub(subId) {
    const sub = alleGedanken.find((g) => g.id === subId);
    if (!sub) return [];
    const direkt = new Set(sub.verbindungen || []);
    const ordnung = (g) => (Number.isFinite(g.reihenfolge) ? g.reihenfolge : Infinity);
    return alleGedanken.filter((g) =>
      g.id !== subId
      && (g.ebene || "gedanke") === "gedanke"
      && !g.erledigt && !g.archiviert
      && (direkt.has(g.id) || (g.verbindungen || []).includes(subId))
    ).sort((a, b) => ((b.dringend === true ? 1 : 0) - (a.dringend === true ? 1 : 0))
      || (ordnung(a) - ordnung(b))
      || (a.text || "").localeCompare(b.text || "", "de"));
  }
  // Idle-Dropdown mit aktuellen Sub-Kategorien nachfüllen (ohne zeichneIdle
  // komplett neu zu bauen → Name/Dauer-Eingaben bleiben erhalten).
  function aktualisiereKatDropdown() {
    const sel = body.querySelector("#fokusKat");
    if (!sel || document.activeElement === sel) return;
    const aktuell = sel.value;
    sel.innerHTML = `<option value="">Ohne Kategorie</option>` +
      subKategorien().map((s) => `<option value="${escapeHtml(s.id)}"${s.id === aktuell ? " selected" : ""}>${escapeHtml(s.name)}</option>`).join("");
  }

  // To-Do-Panel im laufenden Timer: offene Gedanken der Session-Kategorie.
  function aktualisiereTodoPanel() {
    const el = body.querySelector("#fokusTodos");
    if (!el) return;
    const sess = ladeSession();
    if (!sess || !sess.kategorie) { el.innerHTML = ""; return; }
    const todos = todosFuerSub(sess.kategorie);
    el.innerHTML = `
      <div class="fokus-todos-kopf">🎯 ${escapeHtml(sess.kategorieName || "Kategorie")} · offene To-Dos</div>
      ${todos.length
        ? `<ul class="fokus-todos-liste">${todos.map((t) => `
            <li class="fokus-todo-item">
              <label><input type="checkbox" data-todo="${escapeHtml(t.id)}"> <span>${t.dringend === true ? "❗ " : ""}${escapeHtml(t.text || "Unbenannter Gedanke")}</span></label>
              ${t.detail && t.detail.trim() ? `<div class="fokus-todo-detail gd-md-preview">${mdZuHtml(t.detail)}</div>` : ""}
            </li>`).join("")}</ul>`
        : `<p class="fokus-todos-leer muted">Keine offenen To-Dos für diese Kategorie. 🎉</p>`}`;
    el.querySelectorAll("input[data-todo]").forEach((cb) => {
      cb.addEventListener("change", async () => {
        const id = cb.getAttribute("data-todo");
        cb.disabled = true;
        try { await aktualisiereGedanke(id, { erledigt: true }); }   // wirkt auch in der Mindmap
        catch (e) { console.warn("To-Do abhaken fehlgeschlagen:", e); cb.checked = false; cb.disabled = false; }
        // Der Gedanken-Snapshot ruft aktualisiereTodoPanel erneut → Item verschwindet.
      });
    });
  }

  function zeichneIdle() {
    if (ticker) { clearInterval(ticker); ticker = null; }
    const stats = ladeStats();
    const istFokus = gewaehlterModus === "fokus";
    const istPomo  = gewaehlterModus === "pomodoro";
    const istStop  = gewaehlterModus === "stoppuhr";
    const MODI = [["fokus", "Fokus"], ["pomodoro", "Pomodoro"], ["stoppuhr", "Stoppuhr"]];
    body.innerHTML = `
      <section class="card card--pad fokus-card">
        <div class="fokus-ring-wrap">${ringSvg(0, "🌱", istStop ? "00:00" : "--:--")}</div>
        <input id="fokusName" class="fokus-name" type="text" maxlength="60"
          placeholder="Woran arbeitest du? (z. B. Deussen-Schnitt)" value="${escapeHtml(gewaehlterName)}"
          aria-label="Name der Fokus-Session" />
        <select id="fokusKat" class="fokus-kat" aria-label="Kategorie (Sub aus einer Mindmap)">
          <option value="">Ohne Kategorie</option>
          ${subKategorien().map((s) => `<option value="${escapeHtml(s.id)}"${s.id === gewaehlteKat ? " selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
        </select>
        <div class="fokus-modi" role="tablist">
          ${MODI.map(([v, l]) => `<button class="btn btn--ghost btn--sm fokus-modus${v === gewaehlterModus ? " is-active" : ""}" data-modus="${v}" type="button">${l}</button>`).join("")}
        </div>
        ${istFokus ? `
        <div class="fokus-presets">
          ${PRESETS.map((m) => `<button class="btn btn--ghost btn--sm fokus-preset${m === gewaehltMin ? " is-active" : ""}" data-min="${m}" type="button">${m} Min</button>`).join("")}
          <span class="fokus-custom"><input id="fokusCustom" type="number" min="1" max="180" value="${gewaehltMin}" aria-label="Dauer in Minuten" /> Min</span>
        </div>` : ""}
        ${istPomo ? `
        <div class="fokus-pomo-conf">
          <label>Arbeit <input id="pomoWork" type="number" min="1" max="120" value="${pomoWork}" /> Min</label>
          <label>Pause <input id="pomoBreak" type="number" min="1" max="60" value="${pomoBreak}" /> Min</label>
        </div>` : ""}
        ${istStop ? `<p class="muted fokus-stop-hint">Stoppuhr läuft offen — beende sie, wenn du fertig bist.</p>` : ""}
        <button class="btn btn--accent btn--block" id="fokusStart" type="button">${istStop ? "Stoppuhr starten" : "Fokus starten"}</button>
        <p class="fokus-stats muted">Heute: ${stats.sessions} Session${stats.sessions === 1 ? "" : "s"} · ${stats.minuten} Min fokussiert</p>
      </section>`;

    const nameEl = body.querySelector("#fokusName");
    if (nameEl) nameEl.addEventListener("input", () => { gewaehlterName = nameEl.value; });
    const katEl = body.querySelector("#fokusKat");
    if (katEl) katEl.addEventListener("change", () => { gewaehlteKat = katEl.value; });

    body.querySelectorAll(".fokus-modus").forEach((b) => {
      b.addEventListener("click", () => { gewaehlterModus = b.getAttribute("data-modus"); zeichneIdle(); });
    });

    body.querySelectorAll(".fokus-preset").forEach((b) => {
      b.addEventListener("click", () => {
        gewaehltMin = Number(b.getAttribute("data-min"));
        body.querySelectorAll(".fokus-preset").forEach((x) => x.classList.remove("is-active"));
        b.classList.add("is-active");
        const c = body.querySelector("#fokusCustom"); if (c) c.value = gewaehltMin;
      });
    });
    const custom = body.querySelector("#fokusCustom");
    if (custom) custom.addEventListener("input", () => {
      gewaehltMin = custom.value;
      body.querySelectorAll(".fokus-preset").forEach((x) => x.classList.remove("is-active"));
    });
    const pw = body.querySelector("#pomoWork");  if (pw) pw.addEventListener("input", () => { pomoWork = pw.value; });
    const pb = body.querySelector("#pomoBreak"); if (pb) pb.addEventListener("input", () => { pomoBreak = pb.value; });
    body.querySelector("#fokusStart").addEventListener("click", starte);
  }

  function phaseLabel(sess) {
    if (sess.modus === "pomodoro") return sess.phase === "break" ? `☕ Pause · Runde ${sess.runde || 1}` : `🍅 Fokus · Runde ${sess.runde || 1}`;
    if (sess.modus === "stoppuhr") return "⏱ Stoppuhr";
    return "";
  }

  function zeichneLauf(sess) {
    const istStop = sess.modus === "stoppuhr";
    const rest = istStop ? 0 : aktuellerRest(sess);
    const verg = istStop ? verstrichenStoppuhr(sess) : 0;
    const f = istStop ? ((verg % 60) / 60) : (sess.dauerSek > 0 ? (sess.dauerSek - rest) / sess.dauerSek : 0);
    const zeitTxt = istStop ? mmss(Math.round(verg)) : mmss(rest);
    const paused = sess.status === "paused";
    const lbl = phaseLabel(sess);
    body.innerHTML = `
      <section class="card card--pad fokus-card">
        ${sess.name ? `<div class="fokus-laufname">${escapeHtml(sess.name)}</div>` : ""}
        ${lbl ? `<div class="fokus-phase">${lbl}</div>` : ""}
        <div class="fokus-ring-wrap${paused ? " is-paused" : ""}">${ringSvg(f, pflanze(f), zeitTxt)}</div>
        <div class="fokus-laufzeit muted">${paused ? "Pausiert" : "Bleib dran — du fokussierst gerade"}${istStop ? "" : ` · ${Math.round(sess.dauerSek / 60)} Min`}</div>
        <div class="action-btns fokus-actions">
          <button class="btn btn--ghost" id="fokusToggle" type="button">${paused ? "Fortsetzen" : "Pause"}</button>
          <button class="btn btn--accent" id="fokusEnde" type="button">Beenden</button>
          <button class="btn btn--ghost fokus-abbrechen" id="fokusStop" type="button">Abbrechen</button>
          <button class="btn btn--ghost" id="fokusVoll" type="button" title="Vollbild">⛶ Vollbild</button>
        </div>
      </section>
      ${sess.kategorie ? `<section class="card card--pad fokus-todos-card"><div id="fokusTodos"></div></section>` : ""}`;
    body.querySelector("#fokusToggle").addEventListener("click", toggle);
    body.querySelector("#fokusEnde").addEventListener("click", beende);
    body.querySelector("#fokusStop").addEventListener("click", stoppe);
    body.querySelector("#fokusVoll").addEventListener("click", oeffneVollbild);
    aktualisiereTodoPanel();   // To-Dos der Kategorie (falls gesetzt)
  }

  function zeichneDone(min) {
    if (ticker) { clearInterval(ticker); ticker = null; }
    const stats = ladeStats();
    body.innerHTML = `
      <section class="card card--pad fokus-card fokus-done">
        <div class="fokus-done-emoji">🌳</div>
        <h2 class="fokus-done-title">Geschafft!</h2>
        <p class="muted" style="margin:0">${min} Minuten fokussiert. Stark.</p>
        <p class="fokus-stats muted">Heute: ${stats.sessions} Session${stats.sessions === 1 ? "" : "s"} · ${stats.minuten} Min</p>
        <button class="btn btn--accent btn--block" id="fokusNeu" type="button">Neue Session</button>
      </section>`;
    body.querySelector("#fokusNeu").addEventListener("click", zeichneIdle);
  }

  // --- Ablauf-Steuerung ------------------------------------------------
  // Schreibt eine abgeschlossene Session in den Firestore-Verlauf (fire &
  // forget; „Abbrechen" ruft dies NICHT auf → wird nicht protokolliert).
  function protokolliere(sess, dauerMin) {
    try {
      const start = sess.startAt ? new Date(sess.startAt) : new Date();
      fokusSessionAnlegen({ name: sess.name || "Fokus", dauerMin, startAt: start, endeAt: new Date(), kategorie: sess.kategorieName || "" })
        .catch((e) => console.warn("Session-Verlauf speichern fehlgeschlagen:", e));
    } catch (e) { console.warn("Session-Verlauf speichern fehlgeschlagen:", e); }
  }

  function finalisiere(sess) {
    if (ticker) { clearInterval(ticker); ticker = null; }
    const min = Math.round(sess.dauerSek / 60);
    addStat(min);
    protokolliere(sess, min);
    loescheSession();
    piep();
    benachrichtige(min);
    schliesseVollbild();
    zeichneDone(min);
  }

  // „Beenden": laufende Session vorzeitig abschließen UND zählen.
  function beende() {
    const sess = ladeSession();
    if (!sess) { zeichne(); return; }
    if (ticker) { clearInterval(ticker); ticker = null; }
    let min;
    if (sess.modus === "stoppuhr") {
      min = Math.round(verstrichenStoppuhr(sess) / 60);
    } else if (sess.modus === "pomodoro") {
      // Nur die aktuell laufende Arbeitsphase zählt (frühere Runden wurden je
      // Phasenende schon protokolliert). In der Pause zählt nichts mehr.
      min = sess.phase === "work" ? Math.round(Math.max(0, sess.dauerSek - aktuellerRest(sess)) / 60) : 0;
    } else {
      min = Math.round(Math.max(0, sess.dauerSek - aktuellerRest(sess)) / 60);
    }
    addStat(min);
    protokolliere(sess, min);
    loescheSession();
    piep();
    schliesseVollbild();
    zeichneDone(min);
  }

  // Stoppuhr: verstrichene Sekunden (basisSek + laufendes Segment).
  function verstrichenStoppuhr(sess) {
    const basis = Number.isFinite(sess.basisSek) ? sess.basisSek : 0;
    return sess.status === "running" ? basis + Math.max(0, (Date.now() - sess.segStart) / 1000) : basis;
  }

  function aktualisiereStoppuhr(sess) {
    const verg = verstrichenStoppuhr(sess);
    const t = body.querySelector("#fokusZeit"); if (t) t.textContent = mmss(Math.round(verg));
    const f = (verg % 60) / 60;
    const ring = body.querySelector("#fokusRingFill"); if (ring) ring.style.strokeDashoffset = String((C * (1 - f)).toFixed(2));
    const pl = body.querySelector("#fokusPflanze"); if (pl) pl.textContent = pflanze(Math.min(1, verg / (25 * 60)));
  }

  // Pomodoro: Phasenende → Arbeit protokollieren + Pause starten, bzw. Pause
  // vorbei → nächste Arbeitsrunde.
  function pomodoroPhaseEnde(sess) {
    piep();
    if (sess.phase === "work") {
      const min = Math.round(sess.dauerSek / 60);
      addStat(min);
      protokolliere(sess, min);
      const brk = Math.min(60, Math.max(1, parseInt(sess.conf && sess.conf.brk, 10) || 5));
      const dauerSek = brk * 60;
      speichereSession({ ...sess, phase: "break", dauerSek, endeAt: Date.now() + dauerSek * 1000 });
    } else {
      const work = Math.min(120, Math.max(1, parseInt(sess.conf && sess.conf.work, 10) || 25));
      const dauerSek = work * 60;
      speichereSession({ ...sess, phase: "work", runde: (sess.runde || 1) + 1, dauerSek, endeAt: Date.now() + dauerSek * 1000 });
    }
    zeichne();   // baut den Lauf-Screen für die neue Phase neu auf
  }

  function tick() {
    const sess = ladeSession();
    if (!sess || sess.status !== "running") { if (ticker) { clearInterval(ticker); ticker = null; } return; }
    if (sess.modus === "stoppuhr") { aktualisiereStoppuhr(sess); aktualisiereVollbild(sess); return; }
    const rest = aktuellerRest(sess);
    if (rest <= 0) {
      if (sess.modus === "pomodoro") pomodoroPhaseEnde(sess); else finalisiere(sess);
      return;
    }
    aktualisiereRing(rest, sess.dauerSek);
    aktualisiereVollbild(sess);
  }

  function starte() {
    // User-Geste: AudioContext anlegen/aufwecken + Benachrichtigung anfragen.
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch (_) { /* egal */ }
    if ("Notification" in window && Notification.permission === "default") {
      try { Notification.requestPermission(); } catch (_) { /* egal */ }
    }
    const kategorie = gewaehlteKat || "";
    const kategorieName = kategorie ? (subKategorien().find((s) => s.id === kategorie)?.name || "") : "";
    const basis = { name: (gewaehlterName || "").trim() || (gewaehlterModus === "stoppuhr" ? "Stoppuhr" : "Fokus"),
      startAt: Date.now(), kategorie, kategorieName, modus: gewaehlterModus };

    if (gewaehlterModus === "stoppuhr") {
      speichereSession({ ...basis, status: "running", basisSek: 0, segStart: Date.now() });
    } else if (gewaehlterModus === "pomodoro") {
      const work = Math.min(120, Math.max(1, parseInt(pomoWork, 10) || 25));
      const brk  = Math.min(60,  Math.max(1, parseInt(pomoBreak, 10) || 5));
      const dauerSek = work * 60;
      speichereSession({ ...basis, status: "running", phase: "work", runde: 1, conf: { work, brk }, dauerSek, endeAt: Date.now() + dauerSek * 1000 });
    } else {
      const min = Math.min(180, Math.max(1, parseInt(gewaehltMin, 10) || 25));
      const dauerSek = min * 60;
      speichereSession({ ...basis, status: "running", dauerSek, endeAt: Date.now() + dauerSek * 1000 });
    }
    zeichne();
  }

  function toggle() {
    const sess = ladeSession();
    if (!sess) { zeichne(); return; }
    if (sess.modus === "stoppuhr") {
      if (sess.status === "running") speichereSession({ ...sess, status: "paused", basisSek: verstrichenStoppuhr(sess) });
      else                           speichereSession({ ...sess, status: "running", segStart: Date.now() });
      zeichne(); return;
    }
    // Countdown (Fokus + Pomodoro): alle Felder erhalten, nur Status/Restzeit ändern.
    if (sess.status === "running") speichereSession({ ...sess, status: "paused", restSek: aktuellerRest(sess) });
    else                           speichereSession({ ...sess, status: "running", endeAt: Date.now() + sess.restSek * 1000 });
    zeichne();
  }

  function stoppe() {
    if (!confirm("Session abbrechen? Sie wird nicht gezählt.")) return;
    loescheSession();
    schliesseVollbild();
    zeichneIdle();
  }

  // --- Einstieg Timer: Zustand aus localStorage ableiten ---------------
  function zeichne() {
    if (ticker) { clearInterval(ticker); ticker = null; }
    const sess = ladeSession();
    if (!sess) { zeichneIdle(); return; }
    // Countdown-Modi: beim Laden abgelaufen? Fokus finalisiert, Pomodoro wechselt Phase.
    if (sess.modus !== "stoppuhr" && sess.status === "running" && aktuellerRest(sess) <= 0) {
      if (sess.modus === "pomodoro") { pomodoroPhaseEnde(sess); return; }
      finalisiere(sess); return;
    }
    zeichneLauf(sess);
    if (sess.status === "running") ticker = setInterval(tick, 250);
  }

  // --- Vollbild-Overlay (großer Ring/Zeit über die ganze Seite) --------
  function ensureVollbild() {
    if (vollEl) return vollEl;
    vollEl = document.createElement("div");
    vollEl.className = "fokus-voll";
    vollEl.hidden = true;
    vollEl.innerHTML = `
      <div class="fokus-voll-inner">
        <div class="fokus-voll-name" id="fvName"></div>
        <div class="fokus-voll-phase" id="fvPhase"></div>
        <div class="fokus-voll-ringwrap">
          <svg class="fokus-ring fokus-voll-ring" viewBox="0 0 280 280" aria-hidden="true">
            <circle class="fokus-ring-track" cx="140" cy="140" r="${R}"></circle>
            <circle id="fvRing" class="fokus-ring-fill" cx="140" cy="140" r="${R}" stroke-dasharray="${C.toFixed(2)}"></circle>
          </svg>
          <div class="fokus-voll-zeit" id="fvZeit">--:--</div>
        </div>
        <div class="action-btns">
          <button class="btn btn--ghost" id="fvToggle" type="button">Pause</button>
          <button class="btn btn--accent" id="fvEnde" type="button">Beenden</button>
          <button class="btn btn--ghost" id="fvClose" type="button">Schließen</button>
        </div>
      </div>`;
    document.body.appendChild(vollEl);
    vollEl.querySelector("#fvToggle").addEventListener("click", () => { toggle(); const s = ladeSession(); if (s) aktualisiereVollbild(s); });
    vollEl.querySelector("#fvEnde").addEventListener("click", () => { schliesseVollbild(); beende(); });
    vollEl.querySelector("#fvClose").addEventListener("click", schliesseVollbild);
    document.addEventListener("fullscreenchange", () => {
      if (!document.fullscreenElement && vollEl && !vollEl.hidden) vollEl.hidden = true;
    });
    return vollEl;
  }
  function oeffneVollbild() {
    const el = ensureVollbild();
    el.hidden = false;
    const sess = ladeSession(); if (sess) aktualisiereVollbild(sess);
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) { try { req.call(el); } catch (_) { /* egal */ } }
  }
  function schliesseVollbild() {
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (_) { /* egal */ }
    if (vollEl) vollEl.hidden = true;
  }
  function aktualisiereVollbild(sess) {
    if (!vollEl || vollEl.hidden || !sess) return;
    const istStop = sess.modus === "stoppuhr";
    const rest = istStop ? 0 : aktuellerRest(sess);
    const verg = istStop ? verstrichenStoppuhr(sess) : 0;
    const f = istStop ? ((verg % 60) / 60) : (sess.dauerSek > 0 ? (sess.dauerSek - rest) / sess.dauerSek : 0);
    vollEl.querySelector("#fvName").textContent  = sess.name || "";
    vollEl.querySelector("#fvPhase").textContent = phaseLabel(sess);
    vollEl.querySelector("#fvZeit").textContent  = istStop ? mmss(Math.round(verg)) : mmss(rest);
    const ring = vollEl.querySelector("#fvRing"); if (ring) ring.style.strokeDashoffset = String((C * (1 - f)).toFixed(2));
    const tg = vollEl.querySelector("#fvToggle"); if (tg) tg.textContent = sess.status === "paused" ? "Fortsetzen" : "Pause";
  }

  // ===================================================================
  // VIDEOS  (Firestore „fokusvideos" — Grid + Inline-Player, Loop)
  // ===================================================================

  // youtube-nocookie-Embed. Bei loop=true Endlosschleife (braucht playlist=<id>);
  // bei loop=false normales Abspielen — nötig für Livestreams (lofi-Radio o. Ä.),
  // die im playlist-Loop-Modus „nicht verfügbar" melden.
  function embedUrl(vid, loop) {
    const id = encodeURIComponent(vid);
    const base = `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1`;
    return loop ? `${base}&loop=1&playlist=${id}` : base;
  }
  // Immer verfügbares Thumbnail direkt von YouTube (kein API-Key/CORS nötig).
  function thumbFallback(vid) {
    return `https://img.youtube.com/vi/${encodeURIComponent(vid)}/hqdefault.jpg`;
  }

  function zeichneVideos() {
    body.innerHTML = `
      <p class="muted view-intro">Deine YouTube-Videos zum Fokussieren — Klick auf eine Karte spielt sie in einem Mini-Player, der beim Wechsel auf Timer, Verlauf oder Gedanken weiterläuft. Neue über „+ Video" hinzufügen. Nur du siehst das.</p>
      <div class="fokusvid-player" id="fvPlayer"></div>
      <div class="fokusvid-head">
        <h2 class="fokusvid-title">Anspiel-Videos</h2>
        <button class="btn btn--accent btn--sm" id="fvAdd" type="button">+ Video</button>
      </div>
      <div class="fokusvid-form" id="fvForm" hidden></div>
      <div class="fokusvid-grid" id="fvGrid"><p class="muted">Lädt…</p></div>`;

    body.querySelector("#fvAdd").addEventListener("click", toggleForm);
    aktualisiereFvPlayerStatus();
    // Auf Mini-Player-Änderungen hören (z. B. Schließen über den Player selbst).
    document.removeEventListener("fokusfloat:change", onFloatChange);
    document.addEventListener("fokusfloat:change", onFloatChange);

    // Realtime: Grid aktualisiert sich bei jeder Änderung von selbst.
    stoppeVideos();
    videoUnsub = beobachteFokusvideos(
      (liste) => { videos = liste; zeichneGrid(); },
      (err) => {
        console.warn("Fokusvideos laden fehlgeschlagen:", err);
        const g = body.querySelector("#fvGrid");
        if (g) g.innerHTML = `<p class="muted">Konnte die Videos nicht laden.</p>`;
      }
    );
  }

  function onFloatChange() { aktualisiereFvPlayerStatus(); markiereAktiveKarte(); }

  function aktualisiereFvPlayerStatus() {
    const p = body.querySelector("#fvPlayer");
    if (!p) return;
    if (floatVid) {
      const v = videos.find((x) => x.videoId === floatVid);
      const titel = v ? (v.titel || "YouTube-Video") : "Fokus-Video";
      p.innerHTML = `
        <div class="fokusvid-laeuft">
          <span class="fokusvid-laeuft-badge">▶ Läuft im Mini-Player</span>
          <span class="fokusvid-laeuft-titel">${escapeHtml(titel)}</span>
          <p class="muted fokusvid-laeuft-hint">Der Player unten rechts bleibt beim Wechsel auf Timer, Verlauf oder Gedanken an.</p>
          <button class="btn btn--ghost btn--sm" id="fvStop" type="button">Stoppen</button>
        </div>`;
      const stop = p.querySelector("#fvStop");
      if (stop) stop.addEventListener("click", schliesseFloat);
    } else {
      p.innerHTML = `<div class="fokusvid-player-empty">Wähle unten ein Video aus — es spielt in einem Mini-Player, der beim Tab-Wechsel weiterläuft.</div>`;
    }
  }

  function markiereAktiveKarte() {
    body.querySelectorAll(".fokusvid-card").forEach((c) =>
      c.classList.toggle("is-active", c.getAttribute("data-vid") === floatVid));
  }

  function zeichneGrid() {
    const grid = body.querySelector("#fvGrid");
    if (!grid) return;
    if (!videos.length) {
      grid.innerHTML = `<p class="muted fokusvid-leer">Noch keine Videos. Füge dein erstes über „+ Video" hinzu.</p>`;
      return;
    }
    grid.innerHTML = videos.map((v) => {
      const thumb = v.thumbnail || thumbFallback(v.videoId);
      const titel = v.titel || "YouTube-Video";
      const aktiv = v.videoId === floatVid ? " is-active" : "";
      const loopAn = v.loop !== false;
      return `<div class="fokusvid-card${aktiv}" data-id="${escapeHtml(v.id)}" data-vid="${escapeHtml(v.videoId)}"
          role="button" tabindex="0" title="${escapeHtml(titel)}">
        <div class="fokusvid-thumb" style="background-image:url('${escapeHtml(thumb)}')">
          <span class="fokusvid-play" aria-hidden="true">▶</span>
          <button class="fokusvid-loop${loopAn ? " is-an" : ""}" data-loop="${escapeHtml(v.id)}" type="button"
            title="${loopAn ? "Schleife an — für Livestreams ausschalten" : "Schleife aus — spielt einmal / Livestream"}" aria-label="Schleife umschalten">${loopAn ? "🔁" : "➡"}</button>
          <button class="fokusvid-del" data-del="${escapeHtml(v.id)}" type="button"
            title="Video entfernen" aria-label="Video entfernen">✕</button>
        </div>
        <div class="fokusvid-label">${escapeHtml(titel)}</div>
      </div>`;
    }).join("");

    grid.querySelectorAll(".fokusvid-card").forEach((card) => {
      const spiele = () => spieleVideo(card.getAttribute("data-id"), card.getAttribute("data-vid"));
      card.addEventListener("click", (e) => { if (e.target.closest(".fokusvid-del") || e.target.closest(".fokusvid-loop")) return; spiele(); });
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); spiele(); }
      });
    });
    grid.querySelectorAll(".fokusvid-loop").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute("data-loop");
        const v = videos.find((x) => x.id === id);
        const neu = !(v && v.loop !== false);
        try {
          await aktualisiereFokusvideo(id, { loop: neu });
          if (v && v.videoId === floatVid) spieleVideo(id, v.videoId);  // Mini-Player mit neuem Loop-Modus neu laden
        } catch (err) { console.warn("Schleife umschalten fehlgeschlagen:", err); }
      });
    });
    grid.querySelectorAll(".fokusvid-del").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute("data-del");
        const v = videos.find((x) => x.id === id);
        if (!confirm(`Video${v && v.titel ? ` „${v.titel}"` : ""} entfernen?`)) return;
        try {
          await loescheFokusvideo(id);
          if (v && v.videoId === floatVid) schliesseFloat();   // Grid aktualisiert der Observer.
        } catch (err) {
          console.warn("Löschen fehlgeschlagen:", err);
          alert("Konnte das Video nicht entfernen.");
        }
      });
    });
  }

  function spieleVideo(id, vid) {
    const v = videos.find((x) => x.id === id);
    const loop = v ? v.loop !== false : true;
    const titel = v ? (v.titel || "YouTube-Video") : "Fokus-Video";
    spieleImFloat(vid, titel, loop);   // Mini-Player (fokusfloat:change aktualisiert Status + Karte)
  }

  function toggleForm() {
    formOffen = !formOffen;
    const form = body.querySelector("#fvForm");
    if (!form) return;
    if (!formOffen) { form.hidden = true; form.innerHTML = ""; return; }
    form.hidden = false;
    form.innerHTML = `
      <div class="fokusvid-form-row">
        <input id="fvUrl" type="url" inputmode="url" placeholder="YouTube-Link einfügen (z.B. https://youtu.be/…)" aria-label="YouTube-Link" />
        <button class="btn btn--accent btn--sm" id="fvSave" type="button">Hinzufügen</button>
        <button class="btn btn--ghost btn--sm" id="fvCancel" type="button">Abbrechen</button>
      </div>
      <div class="fokusvid-form-msg muted" id="fvMsg" hidden></div>`;
    const url = form.querySelector("#fvUrl");
    url.focus();
    form.querySelector("#fvCancel").addEventListener("click", toggleForm);
    form.querySelector("#fvSave").addEventListener("click", speichereVideo);
    url.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); speichereVideo(); } });
  }

  async function speichereVideo() {
    const form = body.querySelector("#fvForm");
    if (!form) return;
    const input = form.querySelector("#fvUrl");
    const saveBtn = form.querySelector("#fvSave");
    const msg = form.querySelector("#fvMsg");
    const zeige = (t) => { if (msg) { msg.textContent = t; msg.hidden = false; } };
    const roh = (input.value || "").trim();

    const vid = youtubeId(roh);
    if (!vid) { zeige("Das sieht nicht nach einem YouTube-Link aus. Bitte einen gültigen Link einfügen."); input.focus(); return; }
    if (videos.some((v) => v.videoId === vid)) { zeige("Dieses Video ist schon in der Liste."); return; }

    saveBtn.disabled = true; saveBtn.textContent = "Lädt…"; if (msg) msg.hidden = true;

    // Titel + Thumbnail automatisch via noembed.com (CORS-fähig). Schlägt es
    // fehl (offline/geblockt), greift der direkte YouTube-Thumbnail-Fallback.
    let titel = "", thumbnail = thumbFallback(vid);
    try {
      const r = await fetch(`https://noembed.com/embed?url=${encodeURIComponent("https://www.youtube.com/watch?v=" + vid)}`);
      if (r.ok) {
        const d = await r.json();
        if (d && !d.error) {
          if (d.title) titel = String(d.title);
          if (d.thumbnail_url) thumbnail = String(d.thumbnail_url);
        }
      }
    } catch (_) { /* Fallback greift */ }

    try {
      await fokusvideoAnlegen({ url: roh, videoId: vid, titel, thumbnail });
      formOffen = false; form.hidden = true; form.innerHTML = "";  // Grid aktualisiert der Observer.
    } catch (err) {
      console.warn("Video anlegen fehlgeschlagen:", err);
      saveBtn.disabled = false; saveBtn.textContent = "Hinzufügen";
      zeige("Konnte das Video nicht speichern. Bitte erneut versuchen.");
    }
  }

  // ===================================================================
  // VERLAUF  (Firestore „fokussessions" — Liste + Summen + Streak + Balken)
  // ===================================================================

  function zuDate(ts) {
    if (!ts) return null;
    if (typeof ts.toDate === "function") return ts.toDate();       // Firestore-Timestamp
    if (ts instanceof Date) return ts;
    if (typeof ts === "number") return new Date(ts);
    if (typeof ts.seconds === "number") return new Date(ts.seconds * 1000);
    return null;
  }
  function berechneStreak(tageMitSession) {
    if (!tageMitSession.size) return 0;
    const d = new Date(); d.setHours(0, 0, 0, 0);
    // Streak zählt ab heute; hat heute noch keine Session, aber gestern, ab gestern.
    if (!tageMitSession.has(tagKey(d))) d.setDate(d.getDate() - 1);
    let streak = 0;
    while (tageMitSession.has(tagKey(d))) { streak++; d.setDate(d.getDate() - 1); }
    return streak;
  }

  // Längster je erreichter Streak: längste Kette aufeinanderfolgender Tage im Set.
  function laengsterStreak(tageMitSession) {
    if (!tageMitSession.size) return 0;
    const keys = [...tageMitSession].sort();   // "YYYY-MM-DD" → String-Sort = chronologisch
    let best = 1, cur = 1;
    for (let i = 1; i < keys.length; i++) {
      const prev = new Date(keys[i - 1] + "T00:00:00");
      const jetzt = new Date(keys[i] + "T00:00:00");
      const diff = Math.round((jetzt - prev) / 86400000);
      if (diff === 1) { cur++; best = Math.max(best, cur); }
      else if (diff > 1) { cur = 1; }
      // diff === 0 (gleicher Tag) kommt bei einem Set nicht vor
    }
    return best;
  }

  function zeichneVerlauf() {
    const heuteStr = new Date().toISOString().slice(0, 10);
    body.innerHTML = `
      <p class="muted view-intro">Dein Fokus-Verlauf — jede abgeschlossene Session (voll durchgelaufen oder per „Beenden"). „Abbrechen" zählt nicht. Zahlen und Diagramme findest du im Tab „Statistik". Nur du siehst das.</p>
      <div class="fokus-nachtrag">
        <button class="btn btn--ghost btn--sm" id="fnToggle" type="button">＋ Session nachtragen</button>
        <div class="fokus-nachtrag-form card card--pad" id="fnForm" hidden>
          <div class="grid-2">
            <div class="field"><label for="fnName">Name</label>
              <input id="fnName" type="text" maxlength="60" placeholder="z. B. Deussen-Schnitt" /></div>
            <div class="field"><label for="fnKat">Kategorie (optional)</label>
              <input id="fnKat" type="text" maxlength="40" placeholder="frei, z. B. vale-video" /></div>
          </div>
          <div class="grid-3">
            <div class="field"><label for="fnDatum">Datum</label>
              <input id="fnDatum" type="date" value="${heuteStr}" /></div>
            <div class="field"><label for="fnVon">Von</label>
              <input id="fnVon" type="time" /></div>
            <div class="field"><label for="fnBis">Bis</label>
              <input id="fnBis" type="time" /></div>
          </div>
          <div class="notice notice--error" id="fnErr" hidden role="alert"></div>
          <div class="action-btns">
            <button class="btn btn--accent btn--sm" id="fnSave" type="button">Eintragen</button>
            <button class="btn btn--ghost btn--sm" id="fnCancel" type="button">Abbrechen</button>
          </div>
        </div>
      </div>
      <div id="fokusVerlauf"><p class="muted">Lädt…</p></div>`;

    wireNachtrag();
    stoppeSessions();
    sessionUnsub = beobachteFokusSessions(
      (liste) => { sessions = liste; zeichneVerlaufInhalt(); },
      (err) => {
        console.warn("Fokus-Sessions laden fehlgeschlagen:", err);
        const el = body.querySelector("#fokusVerlauf");
        if (el) el.innerHTML = `<p class="muted">Konnte den Verlauf nicht laden.</p>`;
      }
    );
  }

  // Session nachtragen: Datum + Von/Bis → Dauer, in den Firestore-Verlauf.
  function wireNachtrag() {
    const toggle = body.querySelector("#fnToggle");
    const form   = body.querySelector("#fnForm");
    if (!toggle || !form) return;
    const err = form.querySelector("#fnErr");
    toggle.addEventListener("click", () => {
      form.hidden = !form.hidden;
      if (!form.hidden) form.querySelector("#fnName").focus();
    });
    form.querySelector("#fnCancel").addEventListener("click", () => { form.hidden = true; err.hidden = true; });
    form.querySelector("#fnSave").addEventListener("click", async () => {
      err.hidden = true;
      const name  = form.querySelector("#fnName").value.trim() || "Fokus";
      const kat   = form.querySelector("#fnKat").value.trim();
      const datum = form.querySelector("#fnDatum").value;
      const von   = form.querySelector("#fnVon").value;
      const bis   = form.querySelector("#fnBis").value;
      if (!datum || !von || !bis) { err.textContent = "Bitte Datum, Von und Bis angeben."; err.hidden = false; return; }
      const startAt = new Date(`${datum}T${von}`);
      let endeAt    = new Date(`${datum}T${bis}`);
      if (isNaN(startAt) || isNaN(endeAt)) { err.textContent = "Ungültige Zeitangabe."; err.hidden = false; return; }
      // Über Mitternacht: Ende am Folgetag.
      if (endeAt <= startAt) endeAt = new Date(endeAt.getTime() + 24 * 3600 * 1000);
      const dauerMin = Math.round((endeAt - startAt) / 60000);
      if (dauerMin <= 0) { err.textContent = "Die Dauer muss größer als 0 sein."; err.hidden = false; return; }
      const btn = form.querySelector("#fnSave");
      btn.disabled = true; btn.textContent = "Wird eingetragen …";
      try {
        await fokusSessionAnlegen({ name, dauerMin, startAt, endeAt, kategorie: kat });
        form.hidden = true;
        form.querySelector("#fnName").value = ""; form.querySelector("#fnKat").value = "";
        form.querySelector("#fnVon").value = ""; form.querySelector("#fnBis").value = "";
      } catch (e) {
        console.error(e); err.textContent = "Konnte die Session nicht eintragen."; err.hidden = false;
      } finally {
        btn.disabled = false; btn.textContent = "Eintragen";
      }
    });
  }

  // Verlauf = reine Session-Liste (alle Auswertungen liegen im Statistik-Tab).
  function zeichneVerlaufInhalt() {
    const el = body.querySelector("#fokusVerlauf");
    if (!el) return;

    if (!sessions.length) {
      el.innerHTML = `<p class="muted fokusvid-leer">Noch keine Sessions. Starte im Timer-Tab deine erste Fokus-Session.</p>`;
      return;
    }

    el.innerHTML = `
      <ul class="fokus-liste">
        ${sessions.map((s) => `
          <li class="fokus-liste-item" data-id="${escapeHtml(s.id)}">
            <div class="fokus-liste-haupt">
              <span class="fokus-liste-name">${escapeHtml(s.name || "Fokus")}${s.kategorie ? ` <span class="fokus-liste-kat">🎯 ${escapeHtml(s.kategorie)}</span>` : ""}</span>
              <span class="fokus-liste-meta muted">${escapeHtml(formatDatum(s.startAt, true))}</span>
            </div>
            <span class="fokus-liste-dauer">${Number.isFinite(s.dauerMin) ? s.dauerMin : 0} Min</span>
            <button class="fokus-liste-del" data-del="${escapeHtml(s.id)}" type="button" title="Session löschen" aria-label="Session löschen">✕</button>
          </li>`).join("")}
      </ul>`;

    el.querySelectorAll(".fokus-liste-del").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-del");
        const s = sessions.find((x) => x.id === id);
        if (!confirm(`Session${s && s.name ? ` „${s.name}"` : ""} aus dem Verlauf löschen?`)) return;
        try { await loescheFokusSession(id); }   // Liste aktualisiert der Observer.
        catch (err) { console.warn("Session löschen fehlgeschlagen:", err); alert("Konnte die Session nicht löschen."); }
      });
    });
  }

  // ===================================================================
  // STATISTIK  (Firestore „fokussessions" — komplettes Fokus-Dashboard)
  // Alle Kennzahlen aus `dauerMin` (tatsächlich fokussierte Minuten),
  // Zeit-Achse aus `startAt` (via zuDate). Rein clientseitig aggregiert.
  // ===================================================================

  const heuteMitternacht = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const sessMin  = (s) => (Number.isFinite(s.dauerMin) ? s.dauerMin : 0);
  const sessDate = (s) => zuDate(s.startAt);
  // Minuten menschenlesbar: „2 h 15 min" / „45 min".
  function stdMin(min) {
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    return h ? `${h} h ${m} min` : `${m} min`;
  }

  // --- Kennzahlen ------------------------------------------------------
  function statKpis() {
    const heuteK = tagKey(heuteMitternacht());
    const wocheK = wochenKey(new Date());
    const monatK = monatKey(new Date());
    let gesamt = 0, nSess = 0, heute = 0, woche = 0, monat = 0;
    const proTag = new Map(), proWoche = new Map();
    sessions.forEach((s) => {
      const d = sessDate(s), m = sessMin(s);
      gesamt += m; nSess += 1;
      if (!d) return;
      const tk = tagKey(d);
      proTag.set(tk, (proTag.get(tk) || 0) + m);
      proWoche.set(wochenKey(d), (proWoche.get(wochenKey(d)) || 0) + m);
      if (tk === heuteK) heute += m;
      if (wochenKey(d) === wocheK) woche += m;
      if (monatKey(d) === monatK) monat += m;
    });
    const tage = new Set(proTag.keys());
    let bestTag = null, bestTagMin = 0;
    proTag.forEach((v, k) => { if (v > bestTagMin) { bestTagMin = v; bestTag = k; } });
    let bestWoche = null, bestWocheMin = 0;
    proWoche.forEach((v, k) => { if (v > bestWocheMin) { bestWocheMin = v; bestWoche = k; } });
    return {
      gesamt, nSess, avg: nSess ? Math.round(gesamt / nSess) : 0,
      heute, woche, monat,
      streak: berechneStreak(tage), longStreak: laengsterStreak(tage),
      bestTag, bestTagMin, bestWoche, bestWocheMin
    };
  }

  // --- Zeitverlauf: letzte N Buckets je Granularität -------------------
  function statZeitreihe(gran) {
    const proBucket = new Map();
    sessions.forEach((s) => {
      const d = sessDate(s); if (!d) return;
      const key = gran === "tag" ? tagKey(d) : gran === "woche" ? wochenKey(d) : monatKey(d);
      proBucket.set(key, (proBucket.get(key) || 0) + sessMin(s));
    });
    const n = gran === "tag" ? 30 : 12;
    const base = heuteMitternacht();
    const reihe = [];
    for (let i = n - 1; i >= 0; i--) {
      let key, label;
      if (gran === "tag") {
        const d = new Date(base); d.setDate(d.getDate() - i);
        key = tagKey(d); label = `${d.getDate()}.${d.getMonth() + 1}`;
      } else if (gran === "woche") {
        const d = new Date(base); d.setDate(d.getDate() - i * 7);
        key = wochenKey(d); label = `KW${isoKW(d).kw}`;
      } else {
        const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
        key = monatKey(d); label = `${MONATE_KURZ[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
      }
      reihe.push({ key, label, min: proBucket.get(key) || 0 });
    }
    return reihe;
  }

  // --- Fokus je Wochentag (Mo–So) --------------------------------------
  function statWochentag() {
    const namen = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
    const sum = new Array(7).fill(0), cnt = new Array(7).fill(0);
    sessions.forEach((s) => {
      const d = sessDate(s); if (!d) return;
      const idx = (d.getDay() + 6) % 7;      // So=0 → Mo=0-Raster
      sum[idx] += sessMin(s); cnt[idx] += 1;
    });
    return namen.map((name, i) => ({ name, min: sum[i], count: cnt[i], avg: cnt[i] ? Math.round(sum[i] / cnt[i]) : 0 }));
  }

  // --- Projekt-Verteilung: Gruppierung nach Name ODER Kategorie --------
  function statVerteilung(zeitraum, grupp) {
    const wocheGrenze = heuteMitternacht(); wocheGrenze.setDate(wocheGrenze.getDate() - 6);
    const heuteKey = tagKey(heuteMitternacht());
    const monatK = monatKey(new Date());
    const gruppen = new Map();
    let gesamtMin = 0;
    sessions.forEach((s) => {
      const d = sessDate(s);
      if (zeitraum === "heute") { if (!d || tagKey(d) !== heuteKey) return; }
      else if (zeitraum === "woche") { if (!d || d < wocheGrenze) return; }
      else if (zeitraum === "monat") { if (!d || monatKey(d) !== monatK) return; }
      const key = grupp === "kategorie"
        ? ((s.kategorie || "").trim() || "Ohne Kategorie")
        : ((s.name || "Fokus").trim() || "Fokus");
      const min = sessMin(s);
      let g = gruppen.get(key);
      if (!g) { g = { name: key, min: 0, count: 0, letzte: null }; gruppen.set(key, g); }
      g.min += min; g.count += 1;
      if (d && (!g.letzte || d > g.letzte)) g.letzte = d;
      gesamtMin += min;
    });
    const liste = [...gruppen.values()].sort((a, b) => (b.min - a.min) || (b.count - a.count) || a.name.localeCompare(b.name, "de"));
    return { liste, gesamtMin };
  }

  // --- Aktivitäts-Heatmap: letzte N Wochen (Mo-So-Spalten) -------------
  function statHeatmap(wochen) {
    const proTag = new Map();
    sessions.forEach((s) => {
      const d = sessDate(s); if (!d) return;
      proTag.set(tagKey(d), (proTag.get(tagKey(d)) || 0) + sessMin(s));
    });
    const base = heuteMitternacht();
    const montag = new Date(base); montag.setDate(base.getDate() - ((base.getDay() + 6) % 7));  // Montag dieser Woche
    const spalten = [];
    for (let w = wochen - 1; w >= 0; w--) {
      const wMontag = new Date(montag); wMontag.setDate(montag.getDate() - w * 7);
      const tage = [];
      for (let dow = 0; dow < 7; dow++) {
        const tag = new Date(wMontag); tag.setDate(wMontag.getDate() + dow);
        tage.push({ datum: tag, min: proTag.get(tagKey(tag)) || 0, zukunft: tag > base });
      }
      spalten.push(tage);
    }
    return spalten;
  }
  // Minuten → Intensitätsstufe 0–4 für die Heatmap-Farbe.
  function hmStufe(min) {
    if (min <= 0) return 0;
    if (min <= 20) return 1;
    if (min <= 45) return 2;
    if (min <= 90) return 3;
    return 4;
  }

  // --- Toggle-Leiste-Baustein ------------------------------------------
  function toggleHtml(typ, aktiv, optionen) {
    return `<div class="fokus-vt-toggle" role="tablist">${optionen.map(([val, lbl]) =>
      `<button class="fokus-vt-btn${val === aktiv ? " is-active" : ""}" data-stat-toggle="${typ}" data-val="${val}" type="button">${lbl}</button>`).join("")}</div>`;
  }

  // --- Render: Zeitverlauf ---------------------------------------------
  function zeitverlaufHtml() {
    const reihe = statZeitreihe(statGran);
    const maxMin = Math.max(1, ...reihe.map((b) => b.min));
    const gLbl = { tag: "Tag", woche: "Woche", monat: "Monat" };
    return `
      <div class="fokus-vt-head">
        <h2 class="fokusvid-title">Zeitverlauf</h2>
        ${toggleHtml("gran", statGran, STAT_GRAN.map((g) => [g, gLbl[g]]))}
      </div>
      <div class="fokus-chart" role="img" aria-label="Fokus-Minuten je ${gLbl[statGran]}">
        ${reihe.map((b) => `
          <div class="fokus-bar-col" title="${escapeHtml(b.label)}: ${b.min} Min">
            <div class="fokus-bar-wrap">
              <div class="fokus-bar${b.min > 0 ? " has-val" : ""}" style="height:${Math.round((b.min / maxMin) * 100)}%"></div>
            </div>
            <div class="fokus-bar-lbl">${escapeHtml(b.label)}</div>
          </div>`).join("")}
      </div>`;
  }

  // --- Render: Wochentag-Muster ----------------------------------------
  function wochentagHtml() {
    const tage = statWochentag();
    const maxMin = Math.max(1, ...tage.map((t) => t.min));
    return `
      <h2 class="fokusvid-title">Fokus nach Wochentag</h2>
      <div class="fokus-wd">
        ${tage.map((t) => `
          <div class="fokus-wd-row">
            <span class="fokus-wd-lbl">${t.name}</span>
            <div class="fokus-wd-track"><div class="fokus-wd-bar${t.min > 0 ? " has-val" : ""}" style="width:${Math.round((t.min / maxMin) * 100)}%"></div></div>
            <span class="fokus-wd-val muted">${t.min} min${t.count ? ` · Ø ${t.avg}` : ""}</span>
          </div>`).join("")}
      </div>`;
  }

  // --- Render: Projekt-Verteilung (2 Umschalter) -----------------------
  function verteilungHtml() {
    const { liste, gesamtMin } = statVerteilung(verteilZeitraum, vtGruppierung);
    const maxMin = Math.max(1, ...liste.map((g) => g.min));
    const koerper = liste.length
      ? liste.map((g) => {
          const anteil = gesamtMin > 0 ? Math.round((g.min / gesamtMin) * 100) : 0;
          const breite = Math.round((g.min / maxMin) * 100);
          const avg = g.count > 0 ? Math.round(g.min / g.count) : 0;
          const zuletzt = g.letzte ? formatDatum(g.letzte, false) : "–";
          return `
            <div class="fokus-vt-row">
              <div class="fokus-vt-top">
                <span class="fokus-vt-name">${escapeHtml(g.name)}</span>
                <span class="fokus-vt-min">${g.min} Min · ${anteil}%</span>
              </div>
              <div class="fokus-vt-track"><div class="fokus-vt-bar" style="width:${breite}%"></div></div>
              <div class="fokus-vt-meta muted">${g.count} Session${g.count === 1 ? "" : "s"} · Ø ${avg} Min · zuletzt ${escapeHtml(zuletzt)}</div>
            </div>`;
        }).join("")
      : `<p class="muted fokusvid-leer">Keine Sessions in diesem Zeitraum.</p>`;
    return `
      <div class="fokus-vt-head">
        <h2 class="fokusvid-title">Wo ging dein Fokus hin?</h2>
        ${toggleHtml("vtg", vtGruppierung, [["name", "Name"], ["kategorie", "Kategorie"]])}
      </div>
      ${toggleHtml("vtz", verteilZeitraum, [["heute", "Heute"], ["woche", "7 Tage"], ["monat", "Monat"], ["gesamt", "Gesamt"]])}
      <div class="fokus-vt-liste">${koerper}</div>`;
  }

  // --- Render: Heatmap -------------------------------------------------
  function heatmapHtml() {
    const wochen = 16;
    const spalten = statHeatmap(wochen);
    const zellen = spalten.map((tage) =>
      `<div class="fokus-hm-col">${tage.map((t) =>
        t.zukunft
          ? `<div class="fokus-hm-cell is-leer" data-level="-1"></div>`
          : `<div class="fokus-hm-cell" data-level="${hmStufe(t.min)}" title="${escapeHtml(formatDatum(t.datum, false))}: ${t.min} Min"></div>`
      ).join("")}</div>`).join("");
    return `
      <h2 class="fokusvid-title">Aktivität (letzte ${wochen} Wochen)</h2>
      <div class="fokus-hm">${zellen}</div>
      <div class="fokus-hm-legende muted">
        weniger
        <span class="fokus-hm-cell" data-level="0"></span>
        <span class="fokus-hm-cell" data-level="1"></span>
        <span class="fokus-hm-cell" data-level="2"></span>
        <span class="fokus-hm-cell" data-level="3"></span>
        <span class="fokus-hm-cell" data-level="4"></span>
        mehr
      </div>`;
  }

  // --- Render: gesamtes Dashboard --------------------------------------
  function zeichneStatistikInhalt() {
    const wrap = body.querySelector("#fokusStat");
    if (!wrap) return;
    if (!sessions.length) {
      wrap.innerHTML = `<p class="muted fokusvid-leer">Noch keine Sessions. Starte im Timer-Tab deine erste Fokus-Session — dann wächst hier dein Dashboard.</p>`;
      return;
    }
    const k = statKpis();
    const bestTagTxt = k.bestTag ? `${k.bestTagMin} min` : "–";
    const bestTagSub = k.bestTag ? formatDatum(new Date(k.bestTag + "T00:00:00"), false) : "";
    const bestWocheTxt = k.bestWoche ? `${k.bestWocheMin} min` : "–";
    const bestWocheSub = k.bestWoche ? k.bestWoche.replace("-W", " · KW") : "";

    wrap.innerHTML = `
      <div class="fokus-stat-cards fokus-kpi">
        <div class="fokus-stat-card"><span class="fokus-stat-zahl">${stdMin(k.gesamt)}</span><span class="fokus-stat-lbl">Gesamt fokussiert</span></div>
        <div class="fokus-stat-card"><span class="fokus-stat-zahl">${k.nSess}</span><span class="fokus-stat-lbl">Sessions</span></div>
        <div class="fokus-stat-card"><span class="fokus-stat-zahl">${k.avg}</span><span class="fokus-stat-lbl">Ø min / Session</span></div>
        <div class="fokus-stat-card"><span class="fokus-stat-zahl">${k.heute}</span><span class="fokus-stat-lbl">Min heute</span></div>
        <div class="fokus-stat-card"><span class="fokus-stat-zahl">${k.woche}</span><span class="fokus-stat-lbl">Min diese Woche</span></div>
        <div class="fokus-stat-card"><span class="fokus-stat-zahl">${k.monat}</span><span class="fokus-stat-lbl">Min diesen Monat</span></div>
        <div class="fokus-stat-card"><span class="fokus-stat-zahl">${k.streak} 🔥</span><span class="fokus-stat-lbl">Streak (Tage)</span></div>
        <div class="fokus-stat-card"><span class="fokus-stat-zahl">${k.longStreak}</span><span class="fokus-stat-lbl">Längster Streak</span></div>
        <div class="fokus-stat-card"><span class="fokus-stat-zahl">${bestTagTxt}</span><span class="fokus-stat-lbl">Bester Tag${bestTagSub ? ` · ${escapeHtml(bestTagSub)}` : ""}</span></div>
        <div class="fokus-stat-card"><span class="fokus-stat-zahl">${bestWocheTxt}</span><span class="fokus-stat-lbl">Beste Woche${bestWocheSub ? ` · ${escapeHtml(bestWocheSub)}` : ""}</span></div>
      </div>

      <section class="fokus-stat-sec fokus-zeitverlauf">${zeitverlaufHtml()}</section>
      <section class="fokus-stat-sec fokus-wochentag">${wochentagHtml()}</section>
      <section class="fokus-stat-sec fokus-verteilung">${verteilungHtml()}</section>
      <section class="fokus-stat-sec fokus-heatmap">${heatmapHtml()}</section>`;
  }

  function zeichneStatistik() {
    body.innerHTML = `
      <p class="muted view-intro">Dein Fokus-Dashboard — Kennzahlen und Diagramme über alle Sessions: pro Tag, Kalenderwoche und Monat, insgesamt und je Projekt. Nur du siehst das.</p>
      <div id="fokusStat"><p class="muted">Lädt…</p></div>`;

    // Ein delegierter Listener am bleibenden Container fängt alle Umschalter
    // (Granularität, Verteilungs-Gruppierung, Verteilungs-Zeitraum). Da er am
    // Container hängt, überlebt er das Neurendern per innerHTML.
    const wrap = body.querySelector("#fokusStat");
    if (wrap) wrap.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-stat-toggle]");
      if (!btn) return;
      const typ = btn.getAttribute("data-stat-toggle");
      const val = btn.getAttribute("data-val");
      if (typ === "gran" && STAT_GRAN.includes(val) && val !== statGran) {
        statGran = val; localStorage.setItem(LS_STAT_GRAN, val);
      } else if (typ === "vtz" && VERTEIL_ZR.includes(val) && val !== verteilZeitraum) {
        verteilZeitraum = val; localStorage.setItem(LS_VERTEIL, val);
      } else if (typ === "vtg" && VT_GRUPP.includes(val) && val !== vtGruppierung) {
        vtGruppierung = val; localStorage.setItem(LS_VT_GRUPP, val);
      } else { return; }
      zeichneStatistikInhalt();
    });

    stoppeSessions();
    sessionUnsub = beobachteFokusSessions(
      (liste) => { sessions = liste; zeichneStatistikInhalt(); },
      (err) => {
        console.warn("Fokus-Sessions laden fehlgeschlagen:", err);
        const el = body.querySelector("#fokusStat");
        if (el) el.innerHTML = `<p class="muted">Konnte die Statistik nicht laden.</p>`;
      }
    );
  }

  // --- Start -----------------------------------------------------------
  markiereTab();
  zeichneAktivenTab();

  // Gedanken beobachten → Sub-Kategorien fürs Dropdown + laufende To-Dos.
  gedankenUnsub = beobachteGedanken(
    (liste) => {
      alleGedanken = liste;
      if (aktiverTab === "timer") { aktualisiereKatDropdown(); aktualisiereTodoPanel(); }
    },
    (err) => console.warn("Gedanken (Fokus-Kategorien) laden fehlgeschlagen:", err)
  );

  // Beim View-Wechsel Listener aufräumen — der Mini-Player (floatEl an body)
  // bleibt aber bewusst bestehen und spielt weiter.
  beiViewWechsel(() => {
    stoppeTimer(); stoppeVideos(); stoppeSessions();
    if (gedankenUnsub) { try { gedankenUnsub(); } catch (_) { /* egal */ } gedankenUnsub = null; }
    document.removeEventListener("fokusfloat:change", onFloatChange);
    // Vollbild-Overlay entfernen (der Fokus-Mini-Player bleibt bewusst bestehen).
    schliesseVollbild();
    if (vollEl) { try { vollEl.remove(); } catch (_) { /* egal */ } vollEl = null; }
  });
}
