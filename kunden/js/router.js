// SPA-Bootstrap + Hash-Router mit Rollen-Guard.
// Wird von index.html als Modul-Entry geladen.
import { beobachteAuth, logout, abgewieseneAdresse,
         istLoginLink, schliesseLoginLinkAb, setzePasswort } from "./auth.js";
import { loeseEinladungEin, beobachteBenachrichtigungen, markiereBenachrichtigungenGelesen } from "./db.js";
import { KOLLAB_MAP_ID, EINLADUNG_ID } from "./roles.js";
import { getAktiv, setzeAktiv, abonniereKunden, getAktivKunde,
         getBeobachtet, setzeBeobachtet, getBeobachteterKunde } from "./kunde-context.js";
import { kundenartVon } from "./status.js";
import { mountFeedbackWidget, unmountFeedbackWidget } from "./feedback-widget.js";
import { raeumeViewAuf, beiViewWechsel } from "./view-lifecycle.js";
import { renderLogin } from "./views/login.js";
import { renderAufgaben } from "./views/kunde-aufgaben.js";
import { renderMeineVideos } from "./views/kunde-videos.js";
import { renderObjektMelden } from "./views/kunde-objekt-melden.js";
import { renderVideoDetail } from "./views/kunde-video-detail.js";
import { renderKundeKalender } from "./views/kunde-kalender.js";
import { renderAdminPipeline } from "./views/admin-pipeline.js";
import { renderAdminArchiv } from "./views/admin-archiv.js";
import { renderAdminVideoEdit } from "./views/admin-video-edit.js";
import { renderAdminDrehtag } from "./views/admin-drehtag.js";
import { renderAdminObjekte } from "./views/admin-objekte.js";
import { renderAdminKalender } from "./views/admin-kalender.js";
import { renderAdminTermine } from "./views/admin-termine.js";
import { renderAdminPlaene } from "./views/admin-plaene.js";
import { renderAdminPlan } from "./views/admin-plan.js";
import { renderAdminFokus } from "./views/admin-fokus.js";
import { renderAdminGedanken } from "./views/admin-gedanken.js";
import { renderTodos } from "./views/todos.js";
import { renderAdminTranskript } from "./views/admin-transkript.js";
import { renderAdminInspiration } from "./views/admin-inspiration.js";
import { renderAdminMoodboard } from "./views/admin-moodboard.js";
import { renderAdminKunden } from "./views/admin-kunden.js";
import { renderAdminKundeFeed } from "./views/admin-kunde-feed.js";
import { renderAdminWebseite } from "./views/admin-webseite.js";
import { renderAdminBrand } from "./views/admin-brand.js";
import { renderAdminBrandSkript } from "./views/admin-brand-skript.js";
import { renderAdminShoot } from "./views/admin-shoot.js";
import { renderAdminFormate } from "./views/admin-formate.js";
import { renderAdminFonts } from "./views/admin-fonts.js";
import { renderAdminSpringseil } from "./views/admin-springseil.js";
import { renderAdminSocial } from "./views/admin-social.js";
import { renderKundeSocial } from "./views/kunde-social.js";
import { renderAdminRoadmap } from "./views/admin-roadmap.js";
import { renderAdminKurs } from "./views/admin-kurs.js";

// --- Zustand -----------------------------------------------------------
let _user = null;
let _rolle = null;
let _info = null;               // Zusatz: { mapId } (Kollaborator) | { codeNoetig }
let _authBereit = false;
let _linkEmailNoetig = false;   // E-Mail-Link auf anderem Gerät -> Eingabe nötig
let _linkFehler = null;         // Login-Link ungültig/abgelaufen

function appEl() {
  return document.getElementById("app");
}

// --- Routen-Tabelle ----------------------------------------------------
const ROUTES = {
  // Kunde
  "/aufgaben":       { rolle: "kunde", titel: "Aufgaben",        render: renderAufgaben },
  "/meine-videos":   { rolle: "kunde", titel: "Meine Videos",    render: renderMeineVideos },
  "/objekt-melden":  { rolle: "kunde", titel: "Objekt melden",   render: renderObjektMelden },
  "/kalender":       { rolle: "kunde", titel: "Kalender",        render: renderKundeKalender },
  "/meine-zahlen":   { rolle: "kunde", titel: "Meine Zahlen",    render: renderKundeSocial },
  "/video":          { rolle: "kunde", titel: "Video",           render: renderVideoDetail, param: true },
  // Admin
  // Eigene Geschaefts-Roadmap: Phasen, Meilensteine, Monatsumsatz. Steht
  // vorn, weil es die Frage "was ist als Naechstes dran" beantwortet.
  "/admin/roadmap":  { rolle: "admin", titel: "Roadmap",          render: renderAdminRoadmap },
  // Lernkurs: 8 Module, 36 Lektionen. Fortschritt liegt im kurs-Feld von
  // roadmap/valentin — daher direkt neben der Roadmap.
  "/admin/kurs":     { rolle: "admin", titel: "Kurs",             render: renderAdminKurs },
  "/admin/pipeline": { rolle: "admin", titel: "Pipeline",         render: renderAdminPipeline },
  "/admin/archiv":   { rolle: "admin", titel: "Archiv",           render: renderAdminArchiv },
  "/admin/video":    { rolle: "admin", titel: "Video bearbeiten", render: renderAdminVideoEdit, param: true },
  "/admin/drehtag":  { rolle: "admin", titel: "Drehtag",          render: renderAdminDrehtag, param: true },
  "/admin/objekte":  { rolle: "admin", titel: "Objekte",          render: renderAdminObjekte },
  "/admin/kalender": { rolle: "admin", titel: "Kalender",         render: renderAdminKalender },
  "/admin/termine":  { rolle: "admin", titel: "Termine",          render: renderAdminTermine },
  "/admin/plaene":   { rolle: "admin", titel: "Pläne",            render: renderAdminPlaene },
  "/admin/plan":     { rolle: "admin", titel: "Plan",             render: renderAdminPlan, param: true },
  "/admin/fokus":    { rolle: "admin", titel: "Fokus",            render: renderAdminFokus },
  "/admin/gedanken": { rolle: "admin", titel: "Gedanken",         render: renderAdminGedanken },
  "/admin/todos":    { rolle: "admin", titel: "To-Dos",           render: renderTodos },
  "/admin/stickies": { rolle: "admin", titel: "Sticky Notes",     render: (c, o) => renderTodos(c, { ...o, modus: "sticky" }) },
  "/admin/transkript": { rolle: "admin", titel: "Transkript",     render: renderAdminTranskript },
  "/admin/inspiration": { rolle: "admin", titel: "Inspiration",   render: renderAdminInspiration },
  "/admin/moodboard": { rolle: "admin", titel: "Moodboard",       render: renderAdminMoodboard },
  "/admin/kunden":   { rolle: "admin", titel: "Kunden",           render: renderAdminKunden },
  "/admin/kunde-feed": { rolle: "admin", titel: "Kunden-Feed",     render: renderAdminKundeFeed },
  "/admin/webseite": { rolle: "admin", titel: "Webseite",          render: renderAdminWebseite },
  "/admin/social":   { rolle: "admin", titel: "Social",            render: renderAdminSocial },
  // Personal Brand: eigene Videos planen (Skriptwerkstatt + Formate + Dreh)
  "/admin/brand":    { rolle: "admin", titel: "Skripte",           render: renderAdminBrand },
  "/admin/skript":   { rolle: "admin", titel: "Skript",            render: renderAdminBrandSkript, param: true },
  "/admin/shoot":    { rolle: "admin", titel: "Shoot-Modus",       render: renderAdminShoot, param: true },
  "/admin/formate":  { rolle: "admin", titel: "Formate",           render: renderAdminFormate },
  // Design: feste Arbeitsmittel für die Videos (Schriften, später mehr)
  "/admin/fonts":    { rolle: "admin", titel: "Fonts",             render: renderAdminFonts },
  // Privat: eigenes Training (Intervall-Timer + Historie), nur Valentin
  "/admin/springseil": { rolle: "admin", titel: "Springseil",      render: renderAdminSpringseil },
  // Kollaborator (externer Mitarbeiter: geteilte + eigene Mindmaps)
  "/gedanken":       { rolle: "kollaborator", titel: "Mindmap",   render: renderAdminGedanken },
  "/todos":          { rolle: "kollaborator", titel: "To-Dos",    render: renderTodos },
  "/stickies":       { rolle: "kollaborator", titel: "Sticky Notes", render: (c, o) => renderTodos(c, { ...o, modus: "sticky" }) }
};

const NAV = {
  kunde: [
    { href: "#/aufgaben",      label: "Aufgaben" },
    { href: "#/meine-videos",  label: "Meine Videos" },
    { href: "#/objekt-melden", label: "Objekt melden" },
    { href: "#/kalender",      label: "Kalender" },
    { href: "#/meine-zahlen",  label: "Meine Zahlen" }
  ],
  // Admin-Nav ist gruppiert: 16 gleichrangige Links waren keine Navigation
  // mehr, sondern eine Liste — bei schmalem Fenster nur noch horizontal
  // scrollbar erreichbar. Die Pipeline bleibt als tägliche Start-View direkt
  // sichtbar, alles andere liegt thematisch in Menüs.
  admin: [
    { href: "#/admin/roadmap",  label: "Roadmap"  },
    { href: "#/admin/kurs",     label: "Kurs"     },
    { href: "#/admin/pipeline", label: "Pipeline" },
    { gruppe: "Produktion", kinder: [
      { href: "#/admin/objekte",  label: "Objekte" },
      { href: "#/admin/plaene",   label: "Pläne" },
      { href: "#/admin/archiv",   label: "Archiv" }
    ]},
    { gruppe: "Planung", kinder: [
      { href: "#/admin/kalender", label: "Kalender" },
      { href: "#/admin/termine",  label: "Termine" },
      { href: "#/admin/fokus",    label: "Fokus" },
      { href: "#/admin/todos",    label: "To-Dos" },
      { href: "#/admin/stickies", label: "Stickies" }
    ]},
    { gruppe: "Ideen", kinder: [
      { href: "#/admin/gedanken",    label: "Gedanken" },
      { href: "#/admin/inspiration", label: "Inspiration" },
      { href: "#/admin/moodboard",   label: "Moodboard" },
      { href: "#/admin/transkript",  label: "Transkript" }
    ]},
    { gruppe: "Außen", kinder: [
      { href: "#/admin/kunden",     label: "Kunden" },
      { href: "#/admin/kunde-feed", label: "Kunden-Feed" },
      { href: "#/admin/webseite",   label: "Webseite" },
      { href: "#/admin/social",     label: "Social" }
    ]},
    // Eigene Sachen — nicht unter „Ideen", weil hier nicht gesammelt, sondern
    // produziert wird (und weil später Post-Planung/Zahlen dazukommen sollen).
    { gruppe: "Personal Brand", kinder: [
      { href: "#/admin/brand",   label: "Skripte" },
      { href: "#/admin/formate", label: "Formate" }
    ]},
    // Arbeitsmittel, keine Ideensammlung: was beim Bauen der Videos immer
    // gleich zur Hand sein muss. Später kommen Farben/LUTs/Presets dazu.
    { gruppe: "Design", kinder: [
      { href: "#/admin/fonts", label: "Fonts" }
    ]},
    // Privat, kein Arbeitskram — deshalb eine eigene Gruppe.
    { gruppe: "Training", kinder: [
      { href: "#/admin/springseil", label: "Springseil" }
    ]}
  ],
  kollaborator: [
    { href: "#/gedanken", label: "Mindmap" },
    { href: "#/todos",    label: "To-Dos" },
    { href: "#/stickies", label: "Stickies" }
  ]
};

function startRoute(rolle) {
  if (rolle === "admin") return "/admin/pipeline";
  if (rolle === "kollaborator") return "/gedanken";
  return "/aufgaben";
}

// --- Beobachtungsmodus -------------------------------------------------
// Der Admin schaut durch die Augen eines Kunden: Routing, Nav und Views
// verhalten sich wie für die Rolle „kunde", die Auth bleibt Admin. Die Ansicht
// ist read-only (CSS-Guard `body.is-beobachtung`) — es soll nichts im Namen des
// Kunden geschrieben werden.
function istBeobachtung() {
  return _rolle === "admin" && !!getBeobachtet();
}

// Rolle, nach der Routing/Nav/Startseite laufen (im Beobachtungsmodus: kunde).
function effRolle() {
  return istBeobachtung() ? "kunde" : _rolle;
}

// E-Mail, aus deren Sicht Feeds/Glocke gelesen werden. Im Beobachtungsmodus die
// erste hinterlegte Adresse des Kunden — sonst die eigene.
function sichtEmail() {
  if (!istBeobachtung()) return _user && _user.email;
  const k = getBeobachteterKunde();
  const mail = k && Array.isArray(k.emails) && k.emails[0];
  return mail || (_user && _user.email);
}

// Beobachtung beenden und zurück ins Arbeitsportal.
function beendeBeobachtung() {
  setzeBeobachtet(null);
  // Hash-Wechsel rendert über hashchange; steht er schon richtig, selbst rendern.
  if (location.hash === "#/admin/kunden") render();
  else location.hash = "/admin/kunden";
}

// Kundenart (Branche) für Wording/Optionen: beim Admin die des aktiven Kunden
// (aus dem kunde-context-Cache), beim Kunden die eigene (aus der Auth geladen).
// Fallback ist immer "immobilien" (Bestandskunden ohne Feld, Cache noch leer).
function aktuelleKundenart() {
  if (istBeobachtung()) return kundenartVon(getBeobachteterKunde());
  if (_rolle === "admin") return kundenartVon(getAktivKunde());
  return kundenartVon(_info);
}

// --- Hash auflösen (inkl. Param-Routen + optionalem ?query) ------------
// „#/admin/kalender?m=2026-09&mark=vd_abc" → pfad ohne Query matchen, die
// Parameter landen als Plain-Object in den Render-Opts (opts.query).
function resolve(hash) {
  const path = (hash || "").replace(/^#/, "");
  const qIdx = path.indexOf("?");
  const pfad = qIdx === -1 ? path : path.slice(0, qIdx);
  const query = {};
  if (qIdx !== -1) new URLSearchParams(path.slice(qIdx + 1)).forEach((v, k) => { query[k] = v; });
  if (pfad.startsWith("/video/"))       return { route: ROUTES["/video"],       id: decodeURIComponent(pfad.slice("/video/".length)), query };
  if (pfad.startsWith("/admin/video/")) return { route: ROUTES["/admin/video"], id: decodeURIComponent(pfad.slice("/admin/video/".length)), query };
  if (pfad.startsWith("/admin/drehtag/")) return { route: ROUTES["/admin/drehtag"], id: decodeURIComponent(pfad.slice("/admin/drehtag/".length)), query };
  if (pfad.startsWith("/admin/plan/"))  return { route: ROUTES["/admin/plan"],  id: decodeURIComponent(pfad.slice("/admin/plan/".length)), query };
  if (pfad.startsWith("/admin/skript/")) return { route: ROUTES["/admin/skript"], id: decodeURIComponent(pfad.slice("/admin/skript/".length)), query };
  if (pfad.startsWith("/admin/shoot/"))  return { route: ROUTES["/admin/shoot"],  id: decodeURIComponent(pfad.slice("/admin/shoot/".length)), query };
  return { route: ROUTES[pfad] || null, id: null, query };
}

// --- Branded Shell (Header + Nav + Logout) ----------------------------
function renderShell(aktiverPfad) {
  // Branchen-abhängige Nav-Labels: die Objekt-Welt heißt bei Gastro „Filialen".
  const art = aktuelleKundenart();
  const label = (l) => {
    if (art !== "gastro") return l.label;
    if (l.href === "#/objekt-melden") return "Filiale melden";
    if (l.href === "#/admin/objekte") return "Filialen";
    return l.label;
  };
  const rolleJetzt = effRolle();
  const beob = istBeobachtung();
  const beobKunde = beob ? getBeobachteterKunde() : null;
  const beobName = (beobKunde && (beobKunde.name || beobKunde.id)) || getBeobachtet() || "Kunde";

  // Nav-Einträge sind entweder direkte Links oder Gruppen mit Untermenü.
  // Kunden- und Kollaborator-Nav bleiben flach — dort sind es nur 3–4 Punkte.
  const linkHtml = (l) => {
    const aktiv = ("#" + aktiverPfad) === l.href ? " is-active" : "";
    return `<a class="topnav-link${aktiv}" href="${l.href}">${label(l)}</a>`;
  };
  const links = (NAV[rolleJetzt] || [])
    .map(l => {
      if (!l.gruppe) return linkHtml(l);
      // Enthält die Gruppe die aktuelle Route, wird sie mitmarkiert — sonst
      // sieht man im zugeklappten Zustand nicht, wo man gerade ist.
      const drin = l.kinder.some(k => ("#" + aktiverPfad) === k.href);
      const unter = l.kinder.map(k => {
        const aktiv = ("#" + aktiverPfad) === k.href ? " is-active" : "";
        return `<a class="topnav-sub${aktiv}" href="${k.href}">${label(k)}</a>`;
      }).join("");
      return `
        <div class="topnav-gruppe${drin ? " has-active" : ""}">
          <button class="topnav-link topnav-gruppe-btn" type="button" aria-expanded="false">
            ${escapeHtmlR(l.gruppe)}<span class="topnav-chevron" aria-hidden="true">▾</span>
          </button>
          <div class="topnav-panel" hidden>${unter}</div>
        </div>`;
    })
    .join("");

  const rollenLabel = rolleJetzt === "admin" ? "Admin" : rolleJetzt === "kollaborator" ? "Mitarbeiter" : "Kunde";

  appEl().innerHTML = `
    ${beob ? `
    <div class="beob-rahmen" aria-hidden="true"></div>
    <div class="beob-banner" role="status">
      <span class="beob-punkt" aria-hidden="true"></span>
      <span class="beob-text">
        <strong>Beobachtungsmodus</strong> — du siehst das Portal als
        <strong>${escapeHtmlR(beobName)}</strong>. Nur Ansicht, Aktionen sind gesperrt.
      </span>
      <button class="btn btn--sm beob-zurueck" id="beobZurueck" type="button">← Zurück zur Admin-Ansicht</button>
    </div>` : ``}
    <header class="topbar">
      <a class="brand" href="#${startRoute(rolleJetzt)}">vale<span>—</span>video</a>
      <nav class="topnav">${links}</nav>
      <div class="topbar-right">
        ${rolleJetzt === "admin" ? `
        <span class="kunde-switch">
          <select id="kundeSwitch" class="kunde-switch-sel field-inline" title="Aktiver Kunde" aria-label="Aktiver Kunde"></select>
          <a class="btn btn--ghost btn--sm" href="#/admin/kunden" title="Kunden verwalten / neuen anlegen">＋</a>
        </span>` : ``}
        <button class="btn btn--ghost btn--sm glocke-btn" id="glockeBtn" type="button" title="Benachrichtigungen">🔔<span class="glocke-zahl" id="glockeZahl" hidden></span></button>
        <div class="user-menu">
          <button class="user-menu-btn" id="userMenuBtn" type="button" aria-expanded="false" title="${_user.email}">
            <span class="role-pill">${rollenLabel}</span>
            <span class="topnav-chevron" aria-hidden="true">▾</span>
          </button>
          <div class="user-menu-panel" id="userMenuPanel" hidden>
            <div class="user-menu-mail">${_user.email}</div>
            <button class="user-menu-item" id="pwBtn" type="button">Passwort ändern</button>
            <button class="user-menu-item" id="logoutBtn" type="button">Abmelden</button>
          </div>
        </div>
      </div>

      <div class="glocke-panel" id="glockePanel" hidden></div>

      <div class="pw-panel" id="pwPanel" hidden>
        <h2 class="pw-panel-title">Passwort festlegen</h2>
        <p class="muted pw-panel-sub">Danach kannst du dich mit E-Mail + Passwort anmelden — kein Link mehr nötig.</p>
        <div class="notice notice--error" id="pwPanelErr" hidden role="alert"></div>
        <div class="notice notice--ok"    id="pwPanelOk"  hidden role="status"></div>
        <form id="pwPanelForm" novalidate>
          <div class="field">
            <label for="pwNew">Neues Passwort</label>
            <input id="pwNew" type="password" autocomplete="new-password" placeholder="mind. 6 Zeichen" />
          </div>
          <div class="field">
            <label for="pwNew2">Passwort bestätigen</label>
            <input id="pwNew2" type="password" autocomplete="new-password" placeholder="nochmal eingeben" />
          </div>
          <div class="action-btns">
            <button class="btn btn--accent btn--sm" id="pwSave" type="submit">Speichern</button>
            <button class="btn btn--ghost btn--sm" id="pwCancel" type="button">Abbrechen</button>
          </div>
        </form>
      </div>
    </header>
    <main class="view" id="view"></main>`;

  document.getElementById("logoutBtn").addEventListener("click", () => logout());
  const beobBtn = document.getElementById("beobZurueck");
  if (beobBtn) beobBtn.addEventListener("click", beendeBeobachtung);
  wirePasswortPanel();
  wireGlocke();
  wireKundenSwitch();
  wireNavGruppen();
  return document.getElementById("view");
}

// --- Menüs im Kopf (Nav-Gruppen + Benutzer-Menü) -----------------------
// Immer nur eins offen; schließt bei Klick daneben, bei ESC und nach der
// Navigation. Die Document-Listener werden beim Routenwechsel wieder
// abgemeldet, sonst sammeln sie sich mit jedem Shell-Neuaufbau an.
// Läuft auch für Kunde/Kollaborator: deren Nav ist flach (keine Gruppen),
// das Benutzer-Menü rechts haben sie aber genauso.
function wireNavGruppen() {
  const nav = document.querySelector(".topnav");
  if (!nav) return;
  const gruppen = [...nav.querySelectorAll(".topnav-gruppe")];
  // Panels werden beim Öffnen aus der Nav gehängt (s.u.) — deshalb hier
  // einmal merken, welches Panel zu welcher Gruppe gehört.
  const panelVon = new Map(gruppen.map((g) => [g, g.querySelector(".topnav-panel")]));

  function schliesse() {
    gruppen.forEach((g) => {
      const panel = panelVon.get(g);
      panel.hidden = true;
      panel.classList.remove("topnav-panel--frei");
      panel.style.top = "";
      panel.style.left = "";
      if (panel.parentNode !== g) g.appendChild(panel);   // zurück in die Gruppe
      g.querySelector(".topnav-gruppe-btn").setAttribute("aria-expanded", "false");
      g.classList.remove("is-offen");
    });
  }

  // Das Panel wird an <body> gehängt und fest am Viewport positioniert.
  //
  // Vorher lag es absolut IN der Nav. Die scrollt bei schmalen Fenstern
  // horizontal (overflow-x), was das Panel abgeschnitten hätte — dagegen
  // wurde beim Öffnen auf overflow:visible umgeschaltet. Genau das war der
  // Fehler: Ein Container, der sein overflow verliert, verliert auch seine
  // Scroll-Position. Die Nav sprang also im Moment des Antippens zurück an
  // den Anfang, und die weiter rechts liegenden Menüs („Außen", „Personal
  // Brand") rutschten unter dem Finger weg — auf dem Handy unbenutzbar.
  // Außerhalb der Nav gibt es weder Clipping noch Scroll-Sprung, und die
  // x-Position lässt sich am Fensterrand begrenzen.
  function oeffne(g) {
    const btn   = g.querySelector(".topnav-gruppe-btn");
    const panel = panelVon.get(g);
    document.body.appendChild(panel);
    panel.classList.add("topnav-panel--frei");
    panel.hidden = false;
    const r = btn.getBoundingClientRect();
    const breite = panel.offsetWidth;
    panel.style.top  = Math.round(r.bottom + 6) + "px";
    panel.style.left = Math.round(Math.max(8, Math.min(r.left, window.innerWidth - breite - 8))) + "px";
    btn.setAttribute("aria-expanded", "true");
    g.classList.add("is-offen");
  }

  gruppen.forEach((g) => {
    const btn   = g.querySelector(".topnav-gruppe-btn");
    const panel = panelVon.get(g);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const oeffnen = panel.hidden;
      schliesse();
      if (oeffnen) oeffne(g);
    });
    panel.addEventListener("click", schliesse);   // Unterpunkt gewählt → zu
  });

  // Ein fest positioniertes Panel wandert nicht mit, wenn darunter gescrollt
  // oder das Fenster gedreht wird — dann lieber zu.
  const beiBewegung = () => schliesse();
  nav.addEventListener("scroll", beiBewegung, { passive: true });
  window.addEventListener("scroll", beiBewegung, { passive: true });
  window.addEventListener("resize", beiBewegung);
  beiViewWechsel(() => {
    window.removeEventListener("scroll", beiBewegung);
    window.removeEventListener("resize", beiBewegung);
    // Beim Routenwechsel wird die Shell neu gebaut. Ein Panel, das gerade am
    // <body> hängt, wäre sonst verwaist und bliebe sichtbar stehen.
    document.querySelectorAll("body > .topnav-panel").forEach((p) => p.remove());
  });

  // Benutzer-Menü rechts (E-Mail, Passwort, Abmelden) — hängt an derselben
  // Schließ-Logik, damit nie zwei Menüs gleichzeitig offen stehen. E-Mail und
  // die beiden Buttons kosteten in der Topbar zusammen fast 400 px; die
  // fehlten der Nav, die deshalb dauerhaft horizontal scrollen musste.
  const userBtn   = document.getElementById("userMenuBtn");
  const userPanel = document.getElementById("userMenuPanel");
  function schliesseAlles() {
    schliesse();
    if (userPanel) {
      userPanel.hidden = true;
      userBtn.setAttribute("aria-expanded", "false");
      userBtn.classList.remove("is-offen");
    }
  }
  if (userBtn && userPanel) {
    userBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const oeffnen = userPanel.hidden;
      schliesseAlles();
      if (oeffnen) {
        userPanel.hidden = false;
        userBtn.setAttribute("aria-expanded", "true");
        userBtn.classList.add("is-offen");
      }
    });
  }

  const aufKlick = () => schliesseAlles();
  const aufTaste = (e) => { if (e.key === "Escape") schliesseAlles(); };
  document.addEventListener("click", aufKlick);
  document.addEventListener("keydown", aufTaste);
  beiViewWechsel(() => {
    document.removeEventListener("click", aufKlick);
    document.removeEventListener("keydown", aufTaste);
  });
}

// --- Kunden-Umschalter (nur Admin) -------------------------------------
// Füllt das Dropdown live aus der Kunden-Collection und setzt beim Wechsel den
// aktiven Kunden (kunde-context) → render() baut die aktuelle View mit dem neuen
// kundeId-Filter neu auf. Beim Erststart wählt abonniereKunden automatisch den
// ersten Kunden; weicht der dann vom Bau-Zustand ab, wird einmalig neu gebaut.
function wireKundenSwitch() {
  const sel = document.getElementById("kundeSwitch");
  const beob = istBeobachtung();
  if (_rolle !== "admin") return;
  // Im Beobachtungsmodus fehlt das Dropdown (Kunden-Shell) — die Kundenliste
  // wird trotzdem abonniert, sonst kennt das Banner nur die Doc-ID und die
  // Kundenart bliebe auf dem Default stehen.
  if (!sel && !beob) return;

  const gebautMit     = beob ? getBeobachtet() : getAktiv();
  const gebautMitArt  = aktuelleKundenart();
  const gebautMitName = beob ? ((getBeobachteterKunde() || {}).name || null) : null;

  const unsub = abonniereKunden((kunden) => {
    const aktiv = getAktiv();
    if (sel) {
      sel.innerHTML = kunden.length
        ? kunden.map((k) =>
            `<option value="${escapeHtmlR(k.id)}"${k.id === aktiv ? " selected" : ""}>${escapeHtmlR(k.name || k.id)}</option>`).join("")
        : `<option value="">— noch kein Kunde —</option>`;
      sel.value = aktiv || "";
    }
    // Neu bauen, wenn der Default-Kunde gerade gesetzt wurde ODER die Shell noch
    // mit unbekannter Kundenart/Namen gebaut wurde (Cache war beim ersten Paint leer).
    const nameJetzt = beob ? ((getBeobachteterKunde() || {}).name || null) : null;
    if ((beob ? getBeobachtet() : aktiv) !== gebautMit
        || aktuelleKundenart() !== gebautMitArt
        || nameJetzt !== gebautMitName) render();
  }, () => {});
  beiViewWechsel(unsub);

  if (sel) sel.addEventListener("change", () => { setzeAktiv(sel.value || null); render(); });
}

// --- Benachrichtigungs-Glocke (Admin + Kollaborator) --------------------
// Zähler = ungelesene Nachrichten; Öffnen zeigt die Liste und markiert alles
// als gelesen. Abo wird bei jedem Routenwechsel neu aufgebaut (beiViewWechsel).
function escapeHtmlR(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function wireGlocke() {
  const btn   = document.getElementById("glockeBtn");
  const panel = document.getElementById("glockePanel");
  const zahl  = document.getElementById("glockeZahl");
  if (!btn || !panel || !_user) return;

  // Im Beobachtungsmodus zeigt die Glocke die Nachrichten des Kunden (Admin darf
  // sie per Rules lesen) — aber NICHTS wird als gelesen markiert, sonst räumt
  // das Zuschauen dem Kunden die ungelesenen News ab.
  const beob = istBeobachtung();
  const mail = sichtEmail();

  let alle = [];
  function renderPanel() {
    panel.innerHTML = alle.length
      ? alle.slice(0, 30).map((n) => {
          const inhalt = escapeHtmlR(n.text || "");
          // Erledigte Freigabe-News (grün/durchgestrichen) haben Vorrang vor „neu".
          const zustand = n.erledigt ? " is-erledigt" : (n.gelesen ? "" : " is-neu");
          const klasse = `glocke-item${zustand}`;
          const haken = n.erledigt ? "✓ " : "";
          // Mit videoId → klickbar direkt zum betreffenden Video. Der Kunde landet
          // in seiner eigenen Video-Ansicht (#/video/…), Admin/Kollaborator im Backoffice.
          const videoBasis = effRolle() === "kunde" ? "#/video/" : "#/admin/video/";
          return n.videoId
            ? `<a class="${klasse} glocke-item--link" href="${videoBasis}${encodeURIComponent(n.videoId)}">${haken}${inhalt}</a>`
            : `<div class="${klasse}">${haken}${inhalt}</div>`;
        }).join("")
      : `<div class="glocke-leer">Keine Benachrichtigungen.</div>`;
  }
  // Klick auf einen verlinkten Eintrag → Panel schließen (Navigation läuft via href).
  panel.addEventListener("click", (e) => {
    if (e.target.closest("a.glocke-item")) panel.hidden = true;
  });
  const unsub = beobachteBenachrichtigungen(mail, (liste) => {
    alle = liste.sort((a, b) => {
      const ta = (a.erstelltAm && a.erstelltAm.seconds) || 0;
      const tb = (b.erstelltAm && b.erstelltAm.seconds) || 0;
      return tb - ta;
    });
    const neu = alle.filter((n) => !n.gelesen).length;
    zahl.hidden = !neu;
    zahl.textContent = neu > 9 ? "9+" : String(neu);
    if (!panel.hidden) renderPanel();
  }, () => {});
  beiViewWechsel(unsub);

  btn.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      renderPanel();
      if (beob) return;   // Zuschauen darf den Gelesen-Status des Kunden nicht ändern
      const ungelesen = alle.filter((n) => !n.gelesen).map((n) => n.id);
      if (ungelesen.length) markiereBenachrichtigungenGelesen(ungelesen).catch(() => {});
    }
  });
}

// Topbar-Passwort-Panel: ein-/ausklappen + Passwort setzen (updatePassword).
function wirePasswortPanel() {
  const btn    = document.getElementById("pwBtn");
  const panel  = document.getElementById("pwPanel");
  const form   = document.getElementById("pwPanelForm");
  const cancel = document.getElementById("pwCancel");
  const save   = document.getElementById("pwSave");
  const errBox = document.getElementById("pwPanelErr");
  const okBox  = document.getElementById("pwPanelOk");
  if (!btn || !panel || !form) return;

  function schliesse() { panel.hidden = true; errBox.hidden = true; okBox.hidden = true; form.reset(); }

  btn.addEventListener("click", () => {
    if (panel.hidden) { panel.hidden = false; document.getElementById("pwNew").focus(); }
    else { schliesse(); }
  });
  cancel.addEventListener("click", schliesse);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.hidden = true; okBox.hidden = true;
    const pw  = document.getElementById("pwNew").value;
    const pw2 = document.getElementById("pwNew2").value;
    if (pw.length < 6)  { errBox.textContent = "Bitte mindestens 6 Zeichen."; errBox.hidden = false; return; }
    if (pw !== pw2)     { errBox.textContent = "Die Passwörter stimmen nicht überein."; errBox.hidden = false; return; }
    save.disabled = true;
    const r = await setzePasswort(pw);
    save.disabled = false;
    if (r.status === "ok") {
      form.reset();
      okBox.textContent = "Passwort gespeichert. Beim nächsten Mal kannst du dich damit anmelden.";
      okBox.hidden = false;
    } else if (r.status === "neu-anmelden") {
      errBox.textContent = "Aus Sicherheitsgründen bitte einmal abmelden und neu anmelden, dann das Passwort setzen.";
      errBox.hidden = false;
    } else if (r.status === "schwach") {
      errBox.textContent = "Passwort zu schwach. Bitte ein längeres/komplexeres wählen.";
      errBox.hidden = false;
    } else {
      errBox.textContent = "Passwort konnte nicht gesetzt werden. Bitte erneut versuchen.";
      errBox.hidden = false;
    }
  });
}

// --- Haupt-Render ------------------------------------------------------
function render() {
  // Listener der vorherigen View (onSnapshot) abbestellen.
  raeumeViewAuf();

  // Orangener Rahmen + read-only-Guard, solange durch die Augen eines Kunden
  // geschaut wird. Hier (nicht in renderShell), damit die Klasse auch auf dem
  // Login-/Code-Screen sauber verschwindet.
  document.body.classList.toggle("is-beobachtung", istBeobachtung());

  // Einladungs-Link (#/einladung/<mapId>): Ziel-Map merken, dann normaler
  // Ablauf (Login → Zugangscode-Screen löst gegen genau diese Map ein).
  const einladung = location.hash.match(/^#\/einladung\/([^/?#]+)/);
  if (einladung) {
    try { localStorage.setItem("vv_einladung_map", decodeURIComponent(einladung[1])); } catch (_) { /* egal */ }
    location.hash = "";   // löst erneutes render() aus
    return;
  }

  if (!_authBereit) {
    appEl().innerHTML = `<div class="boot">Lädt…</div>`;
    return;
  }

  // Nicht eingeloggt -> Login-Screen
  if (!_user) {
    unmountFeedbackWidget();
    renderLogin(appEl(), {
      abgewiesen: abgewieseneAdresse(),
      linkEmailNoetig: _linkEmailNoetig,
      linkFehler: _linkFehler
    });
    return;
  }

  // Eingeloggt, aber (noch) keine Rolle -> Zugangscode eingeben
  if (!_rolle) {
    renderCodeScreen(appEl());
    return;
  }

  // Eingeloggt -> Routing
  let { route, id, query } = resolve(location.hash);

  // Im Beobachtungsmodus gelten Routen/Nav der Rolle „kunde".
  const rolleJetzt = effRolle();

  // Keine/unbekannte Route -> auf Startseite der Rolle
  if (!route) {
    location.hash = startRoute(rolleJetzt);
    return;
  }
  // Falsche Rolle für diese Route -> auf eigene Startseite
  if (route.rolle !== rolleJetzt) {
    location.hash = startRoute(rolleJetzt);
    return;
  }

  // Aktiver Nav-Pfad: Param-Routen auf ihre Listen-Route zurückführen, sonst
  // ist beim Bearbeiten kein Menüpunkt markiert (Skript/Shoot → „Skripte").
  const viewContainer = renderShell(location.hash.replace(/^#/, "").replace(/\?.*$/, "")
    .replace(/^(\/video|\/admin\/video).*/, "$1")
    .replace(/^\/admin\/(skript|shoot).*/, "/admin/brand"));
  // Aktiver Kunde (kundeId): Admin wählt ihn über den Umschalter; der Kunde
  // bekommt seinen eigenen fest aus der Auth (kundenmitglieder-Lookup);
  // im Beobachtungsmodus ist es der beobachtete Kunde.
  const kundeId = istBeobachtung()
    ? getBeobachtet()
    : (_rolle === "admin" ? getAktiv() : ((_info && _info.kundeId) || null));

  // Die Views lesen aus `user` nur die E-Mail (Feeds, „meine Uploads"). Im
  // Beobachtungsmodus ist das die des Kunden, damit die Sicht wirklich seine
  // ist — geschrieben wird dabei nichts (read-only-Guard in der Shell).
  const sichtUser = istBeobachtung()
    ? { email: sichtEmail(), uid: _user.uid, beobachtung: true }
    : _user;

  route.render(viewContainer, { id, query, user: sichtUser, rolle: rolleJetzt, kollabMapId: (_info && _info.mapId) || null, kundeId, kundenart: aktuelleKundenart() });

  // Schwebende Feedback-Box nur für Kunden (Singleton, überlebt Routenwechsel).
  if (rolleJetzt === "kunde") mountFeedbackWidget({ user: sichtUser, kundeId });
  else unmountFeedbackWidget();
}

// Eingeloggt, aber keine Rolle: Zugangscode einlösen (Kollaborator freischalten)
// oder abmelden. Die Sicherheit steckt in den Firestore-Rules.
function renderCodeScreen(root) {
  root.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="brand login-brand">vale<span>—</span>video</div>
        <h1 class="login-title">Zugangscode</h1>
        <p class="muted">Angemeldet als <strong>${_user.email}</strong>. Gib deinen Zugangscode ein, um freigeschaltet zu werden.</p>
        <div class="notice notice--error" id="codeErr" hidden role="alert"></div>
        <form id="codeForm" novalidate>
          <div class="field">
            <label for="codeInput">Zugangscode</label>
            <input id="codeInput" type="text" inputmode="numeric" autocomplete="off" placeholder="Code" />
          </div>
          <div class="action-btns">
            <button class="btn btn--accent" id="codeSubmit" type="submit">Freischalten</button>
            <button class="btn btn--ghost" id="codeLogout" type="button">Abmelden</button>
          </div>
        </form>
      </div>
    </div>`;

  const form = document.getElementById("codeForm");
  const inp  = document.getElementById("codeInput");
  const err  = document.getElementById("codeErr");
  const btn  = document.getElementById("codeSubmit");
  document.getElementById("codeLogout").addEventListener("click", () => logout());
  inp.focus();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.hidden = true;
    const code = (inp.value || "").trim();
    if (!code) { inp.focus(); return; }
    btn.disabled = true; btn.textContent = "Prüfe…";
    // Ziel-Map: aus dem geöffneten Einladungs-Link (#/einladung/<mapId>);
    // Fallback = die klassische Johannvale-Einladung.
    let mapId = null;
    try { mapId = localStorage.getItem("vv_einladung_map"); } catch (_) { /* egal */ }
    if (!mapId) mapId = KOLLAB_MAP_ID;
    try {
      await loeseEinladungEin(mapId === KOLLAB_MAP_ID ? EINLADUNG_ID : mapId, code, _user.email, mapId);
      try { localStorage.removeItem("vv_einladung_map"); } catch (_) { /* egal */ }
      // Erfolg → neu laden: beobachteAuth erkennt jetzt den Kollaborator.
      location.reload();
    } catch (ex) {
      console.warn("Code-Einlösung fehlgeschlagen:", ex);
      btn.disabled = false; btn.textContent = "Freischalten";
      err.textContent = "Code ungültig oder bereits verwendet.";
      err.hidden = false;
    }
  });
}

// --- Bootstrap ---------------------------------------------------------
async function bootstrap() {
  // Wurde das Portal über einen E-Mail-Login-Link geöffnet? Dann zuerst
  // abschließen — signInWithEmailLink löst danach onAuthStateChanged aus.
  if (istLoginLink()) {
    appEl().innerHTML = `<div class="boot">Anmeldung wird abgeschlossen…</div>`;
    const r = await schliesseLoginLinkAb();
    if (r.status === "email-benoetigt") {
      _linkEmailNoetig = true;
    } else if (r.status === "fehler") {
      _linkFehler = "Der Login-Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an.";
    }
    // bei "angemeldet" übernimmt der Auth-Beobachter unten.
  }

  beobachteAuth((user, rolle, info) => {
    if (user) { _linkEmailNoetig = false; _linkFehler = null; } // erledigt
    _user = user;
    _rolle = rolle;
    _info = info || null;
    _authBereit = true;
    render();
  });
}

bootstrap();

window.addEventListener("hashchange", render);
