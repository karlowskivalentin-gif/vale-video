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
import { escapeHtml, formatDatum } from "../util.js";
import { fokusvideoAnlegen, aktualisiereFokusvideo, beobachteFokusvideos, loescheFokusvideo,
         fokusSessionAnlegen, beobachteFokusSessions, loescheFokusSession } from "../db.js";

const LS_SESSION = "vale_fokus_session";   // laufende/pausierte Session
const LS_STATS   = "vale_fokus_stats";     // Tages-Zähler (Sessions + Minuten)
const LS_TAB     = "vale_fokus_tab";       // zuletzt aktiver Tab ('timer'|'videos'|'verlauf')
const TABS       = ["timer", "videos", "verlauf"];
const PRESETS    = [25, 45, 60, 90];
const R = 120;                             // Ring-Radius (SVG-Einheiten)
const C = 2 * Math.PI * R;                 // Umfang für stroke-dasharray

export function renderAdminFokus(container) {
  // --- gemeinsamer State ----------------------------------------------
  let ticker = null;        // Timer: setInterval-Handle
  let audioCtx = null;      // Timer: WebAudio (erst bei Start → User-Geste)
  let gewaehltMin = 25;     // Timer: aktuell gewählte Dauer im Idle-Zustand

  let videoUnsub = null;    // Videos: Firestore-onSnapshot-Abbestellung
  let videos = [];          // Videos: zuletzt bekannte Liste
  let aktivesVideoId = null;// Videos: gerade im Player geladenes Video
  let formOffen = false;    // Videos: ist das „+"-Formular offen?

  let sessionUnsub = null;  // Verlauf: Firestore-onSnapshot-Abbestellung
  let sessions = [];        // Verlauf: zuletzt bekannte Session-Liste
  let gewaehlterName = "";  // Timer: benannter Session-Titel im Idle-Zustand

  let aktiverTab = TABS.includes(localStorage.getItem(LS_TAB)) ? localStorage.getItem(LS_TAB) : "timer";

  container.innerHTML = `
    <div class="admin-head">
      <h1 class="view-title" style="margin:0">Fokus</h1>
    </div>
    <div class="fokus-tabs" role="tablist">
      <button class="fokus-tab" data-tab="timer"   type="button" role="tab">Timer</button>
      <button class="fokus-tab" data-tab="videos"  type="button" role="tab">Videos</button>
      <button class="fokus-tab" data-tab="verlauf" type="button" role="tab">Verlauf</button>
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

  function zeichneIdle() {
    if (ticker) { clearInterval(ticker); ticker = null; }
    const stats = ladeStats();
    body.innerHTML = `
      <section class="card card--pad fokus-card">
        <div class="fokus-ring-wrap">${ringSvg(0, "🌱", "--:--")}</div>
        <input id="fokusName" class="fokus-name" type="text" maxlength="60"
          placeholder="Woran arbeitest du? (z. B. Deussen-Schnitt)" value="${escapeHtml(gewaehlterName)}"
          aria-label="Name der Fokus-Session" />
        <div class="fokus-presets">
          ${PRESETS.map((m) => `<button class="btn btn--ghost btn--sm fokus-preset${m === gewaehltMin ? " is-active" : ""}" data-min="${m}" type="button">${m} Min</button>`).join("")}
          <span class="fokus-custom"><input id="fokusCustom" type="number" min="1" max="180" value="${gewaehltMin}" aria-label="Dauer in Minuten" /> Min</span>
        </div>
        <button class="btn btn--accent btn--block" id="fokusStart" type="button">Fokus starten</button>
        <p class="fokus-stats muted">Heute: ${stats.sessions} Session${stats.sessions === 1 ? "" : "s"} · ${stats.minuten} Min fokussiert</p>
      </section>`;

    const nameEl = body.querySelector("#fokusName");
    if (nameEl) nameEl.addEventListener("input", () => { gewaehlterName = nameEl.value; });

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
    body.querySelector("#fokusStart").addEventListener("click", starte);
  }

  function zeichneLauf(sess) {
    const rest = aktuellerRest(sess);
    const f = sess.dauerSek > 0 ? (sess.dauerSek - rest) / sess.dauerSek : 0;
    const paused = sess.status === "paused";
    body.innerHTML = `
      <section class="card card--pad fokus-card">
        ${sess.name ? `<div class="fokus-laufname">${escapeHtml(sess.name)}</div>` : ""}
        <div class="fokus-ring-wrap${paused ? " is-paused" : ""}">${ringSvg(f, pflanze(f), mmss(rest))}</div>
        <div class="fokus-laufzeit muted">${paused ? "Pausiert" : "Bleib dran — du fokussierst gerade"} · ${Math.round(sess.dauerSek / 60)} Min Session</div>
        <div class="action-btns fokus-actions">
          <button class="btn btn--ghost" id="fokusToggle" type="button">${paused ? "Fortsetzen" : "Pause"}</button>
          <button class="btn btn--accent" id="fokusEnde" type="button">Beenden</button>
          <button class="btn btn--ghost fokus-abbrechen" id="fokusStop" type="button">Abbrechen</button>
        </div>
      </section>`;
    body.querySelector("#fokusToggle").addEventListener("click", toggle);
    body.querySelector("#fokusEnde").addEventListener("click", beende);
    body.querySelector("#fokusStop").addEventListener("click", stoppe);
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
      fokusSessionAnlegen({ name: sess.name || "Fokus", dauerMin, startAt: start, endeAt: new Date() })
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
    zeichneDone(min);
  }

  // „Beenden": laufende Session vorzeitig abschließen UND zählen.
  function beende() {
    const sess = ladeSession();
    if (!sess) { zeichne(); return; }
    if (ticker) { clearInterval(ticker); ticker = null; }
    const fokussiertSek = Math.max(0, sess.dauerSek - aktuellerRest(sess));
    const min = Math.round(fokussiertSek / 60);
    addStat(min);
    protokolliere(sess, min);
    loescheSession();
    piep();
    zeichneDone(min);
  }

  function tick() {
    const sess = ladeSession();
    if (!sess || sess.status !== "running") { if (ticker) { clearInterval(ticker); ticker = null; } return; }
    const rest = aktuellerRest(sess);
    if (rest <= 0) { finalisiere(sess); return; }
    aktualisiereRing(rest, sess.dauerSek);
  }

  function starte() {
    const min = Math.min(180, Math.max(1, parseInt(gewaehltMin, 10) || 25));
    // User-Geste: AudioContext anlegen/aufwecken + Benachrichtigung anfragen.
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch (_) { /* egal */ }
    if ("Notification" in window && Notification.permission === "default") {
      try { Notification.requestPermission(); } catch (_) { /* egal */ }
    }
    const dauerSek = min * 60;
    const name = (gewaehlterName || "").trim() || "Fokus";
    speichereSession({ status: "running", dauerSek, endeAt: Date.now() + dauerSek * 1000, name, startAt: Date.now() });
    zeichne();
  }

  function toggle() {
    const sess = ladeSession();
    if (!sess) { zeichne(); return; }
    const meta = { name: sess.name, startAt: sess.startAt };  // Name/Start über Pause hinweg erhalten
    if (sess.status === "running") {
      speichereSession({ status: "paused", dauerSek: sess.dauerSek, restSek: aktuellerRest(sess), ...meta });
    } else {
      speichereSession({ status: "running", dauerSek: sess.dauerSek, endeAt: Date.now() + sess.restSek * 1000, ...meta });
    }
    zeichne();
  }

  function stoppe() {
    if (!confirm("Fokus-Session abbrechen? Sie wird nicht gezählt.")) return;
    loescheSession();
    zeichneIdle();
  }

  // --- Einstieg Timer: Zustand aus localStorage ableiten ---------------
  function zeichne() {
    if (ticker) { clearInterval(ticker); ticker = null; }
    const sess = ladeSession();
    if (!sess) { zeichneIdle(); return; }
    if (sess.status === "running" && aktuellerRest(sess) <= 0) { finalisiere(sess); return; }
    zeichneLauf(sess);
    if (sess.status === "running") ticker = setInterval(tick, 250);
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
      <p class="muted view-intro">Deine YouTube-Videos zum Fokussieren — Klick auf eine Karte spielt sie oben ab (läuft in Schleife). Neue über „+ Video" hinzufügen. Nur du siehst das.</p>
      <div class="fokusvid-player" id="fvPlayer">
        <div class="fokusvid-player-empty">Wähle unten ein Video aus, um es hier abzuspielen.</div>
      </div>
      <div class="fokusvid-head">
        <h2 class="fokusvid-title">Anspiel-Videos</h2>
        <button class="btn btn--accent btn--sm" id="fvAdd" type="button">+ Video</button>
      </div>
      <div class="fokusvid-form" id="fvForm" hidden></div>
      <div class="fokusvid-grid" id="fvGrid"><p class="muted">Lädt…</p></div>`;

    body.querySelector("#fvAdd").addEventListener("click", toggleForm);

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
      const aktiv = v.id === aktivesVideoId ? " is-active" : "";
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
          if (id === aktivesVideoId && v) spieleVideo(id, v.videoId);  // Player mit neuem Loop-Modus neu laden
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
          if (id === aktivesVideoId) leerePlayer();   // Grid aktualisiert der Observer.
        } catch (err) {
          console.warn("Löschen fehlgeschlagen:", err);
          alert("Konnte das Video nicht entfernen.");
        }
      });
    });
  }

  function spieleVideo(id, vid) {
    aktivesVideoId = id;
    const v = videos.find((x) => x.id === id);
    const loop = v ? v.loop !== false : true;
    const player = body.querySelector("#fvPlayer");
    if (player) {
      player.innerHTML = `<div class="embed-wrap"><iframe src="${escapeHtml(embedUrl(vid, loop))}"
        title="Fokus-Video" loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
      player.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    body.querySelectorAll(".fokusvid-card").forEach((c) =>
      c.classList.toggle("is-active", c.getAttribute("data-id") === id));
  }

  function leerePlayer() {
    aktivesVideoId = null;
    const player = body.querySelector("#fvPlayer");
    if (player) player.innerHTML = `<div class="fokusvid-player-empty">Wähle unten ein Video aus, um es hier abzuspielen.</div>`;
    body.querySelectorAll(".fokusvid-card").forEach((c) => c.classList.remove("is-active"));
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
  // Lokaler Kalendertag als "JJJJ-MM-TT" (NICHT toISOString → das rechnet in
  // UTC und schöbe die lokale Mitternacht auf den Vortag).
  function tagKey(d) {
    if (!d) return "";
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

  function zeichneVerlauf() {
    body.innerHTML = `
      <p class="muted view-intro">Dein Fokus-Verlauf — jede abgeschlossene Session (voll durchgelaufen oder per „Beenden"). „Abbrechen" zählt nicht. Nur du siehst das.</p>
      <div id="fokusVerlauf"><p class="muted">Lädt…</p></div>`;

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

  function zeichneVerlaufInhalt() {
    const el = body.querySelector("#fokusVerlauf");
    if (!el) return;

    if (!sessions.length) {
      el.innerHTML = `<p class="muted fokusvid-leer">Noch keine Sessions. Starte im Timer-Tab deine erste Fokus-Session.</p>`;
      return;
    }

    // Aufbereiten
    const heuteKey = tagKey((() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })());
    const wocheGrenze = new Date(); wocheGrenze.setHours(0, 0, 0, 0); wocheGrenze.setDate(wocheGrenze.getDate() - 6);
    let sumHeute = 0, sumWoche = 0, sumGesamt = 0;
    const tageMitSession = new Set();
    const proTag = new Map();  // tagKey -> Minuten
    sessions.forEach((s) => {
      const d = zuDate(s.startAt);
      const min = Number.isFinite(s.dauerMin) ? s.dauerMin : 0;
      sumGesamt += min;
      if (d) {
        const k = tagKey(d);
        tageMitSession.add(k);
        proTag.set(k, (proTag.get(k) || 0) + min);
        if (k === heuteKey) sumHeute += min;
        if (d >= wocheGrenze) sumWoche += min;
      }
    });
    const streak = berechneStreak(tageMitSession);

    // Balken: letzte 14 Tage (alt → neu)
    const TAGE = 14;
    const balken = [];
    for (let i = TAGE - 1; i >= 0; i--) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      balken.push({ key: tagKey(d), min: proTag.get(tagKey(d)) || 0,
                    label: `${d.getDate()}.${d.getMonth() + 1}` });
    }
    const maxMin = Math.max(1, ...balken.map((b) => b.min));

    el.innerHTML = `
      <div class="fokus-stat-cards">
        <div class="fokus-stat-card"><span class="fokus-stat-zahl">${sumHeute}</span><span class="fokus-stat-lbl">Min heute</span></div>
        <div class="fokus-stat-card"><span class="fokus-stat-zahl">${sumWoche}</span><span class="fokus-stat-lbl">Min diese Woche</span></div>
        <div class="fokus-stat-card"><span class="fokus-stat-zahl">${sumGesamt}</span><span class="fokus-stat-lbl">Min gesamt</span></div>
        <div class="fokus-stat-card"><span class="fokus-stat-zahl">${streak} 🔥</span><span class="fokus-stat-lbl">Tage Streak</span></div>
      </div>

      <h2 class="fokusvid-title">Letzte 14 Tage</h2>
      <div class="fokus-chart" role="img" aria-label="Fokus-Minuten der letzten 14 Tage">
        ${balken.map((b) => `
          <div class="fokus-bar-col" title="${b.label}: ${b.min} Min">
            <div class="fokus-bar-wrap">
              <div class="fokus-bar${b.min > 0 ? " has-val" : ""}" style="height:${Math.round((b.min / maxMin) * 100)}%"></div>
            </div>
            <div class="fokus-bar-lbl">${b.label}</div>
          </div>`).join("")}
      </div>

      <h2 class="fokusvid-title">Alle Sessions</h2>
      <ul class="fokus-liste">
        ${sessions.map((s) => `
          <li class="fokus-liste-item" data-id="${escapeHtml(s.id)}">
            <div class="fokus-liste-haupt">
              <span class="fokus-liste-name">${escapeHtml(s.name || "Fokus")}</span>
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

  // --- Start -----------------------------------------------------------
  markiereTab();
  zeichneAktivenTab();
  beiViewWechsel(() => { stoppeTimer(); stoppeVideos(); stoppeSessions(); });
}
