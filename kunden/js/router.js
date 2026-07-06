// SPA-Bootstrap + Hash-Router mit Rollen-Guard.
// Wird von index.html als Modul-Entry geladen.
import { beobachteAuth, logout, abgewieseneAdresse,
         istLoginLink, schliesseLoginLinkAb, setzePasswort } from "./auth.js";
import { loeseEinladungEin, beobachteBenachrichtigungen, markiereBenachrichtigungenGelesen } from "./db.js";
import { KOLLAB_MAP_ID, EINLADUNG_ID } from "./roles.js";
import { raeumeViewAuf, beiViewWechsel } from "./view-lifecycle.js";
import { renderLogin } from "./views/login.js";
import { renderAufgaben } from "./views/kunde-aufgaben.js";
import { renderObjektMelden } from "./views/kunde-objekt-melden.js";
import { renderVideoDetail } from "./views/kunde-video-detail.js";
import { renderKundeKalender } from "./views/kunde-kalender.js";
import { renderAdminPipeline } from "./views/admin-pipeline.js";
import { renderAdminVideoEdit } from "./views/admin-video-edit.js";
import { renderAdminObjekte } from "./views/admin-objekte.js";
import { renderAdminKalender } from "./views/admin-kalender.js";
import { renderAdminTermine } from "./views/admin-termine.js";
import { renderAdminPlaene } from "./views/admin-plaene.js";
import { renderAdminPlan } from "./views/admin-plan.js";
import { renderAdminFokus } from "./views/admin-fokus.js";
import { renderAdminGedanken } from "./views/admin-gedanken.js";
import { renderTodos } from "./views/todos.js";
import { renderAdminTranskript } from "./views/admin-transkript.js";

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
  "/objekt-melden":  { rolle: "kunde", titel: "Objekt melden",   render: renderObjektMelden },
  "/kalender":       { rolle: "kunde", titel: "Kalender",        render: renderKundeKalender },
  "/video":          { rolle: "kunde", titel: "Video",           render: renderVideoDetail, param: true },
  // Admin
  "/admin/pipeline": { rolle: "admin", titel: "Pipeline",         render: renderAdminPipeline },
  "/admin/video":    { rolle: "admin", titel: "Video bearbeiten", render: renderAdminVideoEdit, param: true },
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
  // Kollaborator (externer Mitarbeiter: geteilte + eigene Mindmaps)
  "/gedanken":       { rolle: "kollaborator", titel: "Mindmap",   render: renderAdminGedanken },
  "/todos":          { rolle: "kollaborator", titel: "To-Dos",    render: renderTodos },
  "/stickies":       { rolle: "kollaborator", titel: "Sticky Notes", render: (c, o) => renderTodos(c, { ...o, modus: "sticky" }) }
};

const NAV = {
  kunde: [
    { href: "#/aufgaben",      label: "Aufgaben" },
    { href: "#/objekt-melden", label: "Objekt melden" },
    { href: "#/kalender",      label: "Kalender" }
  ],
  admin: [
    { href: "#/admin/pipeline", label: "Pipeline" },
    { href: "#/admin/objekte",  label: "Objekte" },
    { href: "#/admin/kalender", label: "Kalender" },
    { href: "#/admin/termine",  label: "Termine" },
    { href: "#/admin/plaene",   label: "Pläne" },
    { href: "#/admin/fokus",    label: "Fokus" },
    { href: "#/admin/gedanken", label: "Gedanken" },
    { href: "#/admin/todos",    label: "To-Dos" },
    { href: "#/admin/stickies", label: "Stickies" },
    { href: "#/admin/transkript", label: "Transkript" }
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

// --- Hash auflösen (inkl. Param-Routen) -------------------------------
function resolve(hash) {
  const path = (hash || "").replace(/^#/, "");
  if (path.startsWith("/video/"))       return { route: ROUTES["/video"],       id: decodeURIComponent(path.slice("/video/".length)) };
  if (path.startsWith("/admin/video/")) return { route: ROUTES["/admin/video"], id: decodeURIComponent(path.slice("/admin/video/".length)) };
  if (path.startsWith("/admin/plan/"))  return { route: ROUTES["/admin/plan"],  id: decodeURIComponent(path.slice("/admin/plan/".length)) };
  return { route: ROUTES[path] || null, id: null };
}

// --- Branded Shell (Header + Nav + Logout) ----------------------------
function renderShell(aktiverPfad) {
  const links = (NAV[_rolle] || [])
    .map(l => {
      const aktiv = ("#" + aktiverPfad) === l.href ? " is-active" : "";
      return `<a class="topnav-link${aktiv}" href="${l.href}">${l.label}</a>`;
    })
    .join("");

  const rollenLabel = _rolle === "admin" ? "Admin" : _rolle === "kollaborator" ? "Mitarbeiter" : "Kunde";

  appEl().innerHTML = `
    <header class="topbar">
      <a class="brand" href="#${startRoute(_rolle)}">vale<span>—</span>video</a>
      <nav class="topnav">${links}</nav>
      <div class="topbar-right">
        <span class="topbar-user" title="${_user.email}">
          <span class="role-pill">${rollenLabel}</span>
          <span class="user-email">${_user.email}</span>
        </span>
        ${(_rolle === "admin" || _rolle === "kollaborator") ? `<button class="btn btn--ghost btn--sm glocke-btn" id="glockeBtn" type="button" title="Benachrichtigungen">🔔<span class="glocke-zahl" id="glockeZahl" hidden></span></button>` : ``}
        <button class="btn btn--ghost btn--sm" id="pwBtn" type="button">Passwort</button>
        <button class="btn btn--ghost btn--sm" id="logoutBtn">Abmelden</button>
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
  wirePasswortPanel();
  wireGlocke();
  return document.getElementById("view");
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

  let alle = [];
  function renderPanel() {
    panel.innerHTML = alle.length
      ? alle.slice(0, 30).map((n) => `<div class="glocke-item${n.gelesen ? "" : " is-neu"}">${escapeHtmlR(n.text || "")}</div>`).join("")
      : `<div class="glocke-leer">Keine Benachrichtigungen.</div>`;
  }
  const unsub = beobachteBenachrichtigungen(_user.email, (liste) => {
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
  let { route, id } = resolve(location.hash);

  // Keine/unbekannte Route -> auf Startseite der Rolle
  if (!route) {
    location.hash = startRoute(_rolle);
    return;
  }
  // Falsche Rolle für diese Route -> auf eigene Startseite
  if (route.rolle !== _rolle) {
    location.hash = startRoute(_rolle);
    return;
  }

  const viewContainer = renderShell(location.hash.replace(/^#/, "").replace(/^(\/video|\/admin\/video).*/, "$1"));
  route.render(viewContainer, { id, user: _user, rolle: _rolle, kollabMapId: (_info && _info.mapId) || null });
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
