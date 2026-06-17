// SPA-Bootstrap + Hash-Router mit Rollen-Guard.
// Wird von index.html als Modul-Entry geladen.
import { beobachteAuth, logout, abgewieseneAdresse } from "./auth.js";
import { raeumeViewAuf } from "./view-lifecycle.js";
import { renderLogin } from "./views/login.js";
import { renderAufgaben } from "./views/kunde-aufgaben.js";
import { renderObjektMelden } from "./views/kunde-objekt-melden.js";
import { renderVideoDetail } from "./views/kunde-video-detail.js";
import { renderAdminPipeline } from "./views/admin-pipeline.js";
import { renderAdminVideoEdit } from "./views/admin-video-edit.js";
import { renderAdminObjekte } from "./views/admin-objekte.js";
import { renderAdminKalender } from "./views/admin-kalender.js";

// --- Zustand -----------------------------------------------------------
let _user = null;
let _rolle = null;
let _authBereit = false;

function appEl() {
  return document.getElementById("app");
}

// --- Routen-Tabelle ----------------------------------------------------
const ROUTES = {
  // Kunde
  "/aufgaben":       { rolle: "kunde", titel: "Aufgaben",        render: renderAufgaben },
  "/objekt-melden":  { rolle: "kunde", titel: "Objekt melden",   render: renderObjektMelden },
  "/video":          { rolle: "kunde", titel: "Video",           render: renderVideoDetail, param: true },
  // Admin
  "/admin/pipeline": { rolle: "admin", titel: "Pipeline",         render: renderAdminPipeline },
  "/admin/video":    { rolle: "admin", titel: "Video bearbeiten", render: renderAdminVideoEdit, param: true },
  "/admin/objekte":  { rolle: "admin", titel: "Objekte",          render: renderAdminObjekte },
  "/admin/kalender": { rolle: "admin", titel: "Kalender",         render: renderAdminKalender }
};

const NAV = {
  kunde: [
    { href: "#/aufgaben",      label: "Aufgaben" },
    { href: "#/objekt-melden", label: "Objekt melden" }
  ],
  admin: [
    { href: "#/admin/pipeline", label: "Pipeline" },
    { href: "#/admin/objekte",  label: "Objekte" },
    { href: "#/admin/kalender", label: "Kalender" }
  ]
};

function startRoute(rolle) {
  return rolle === "admin" ? "/admin/pipeline" : "/aufgaben";
}

// --- Hash auflösen (inkl. Param-Routen) -------------------------------
function resolve(hash) {
  const path = (hash || "").replace(/^#/, "");
  if (path.startsWith("/video/"))       return { route: ROUTES["/video"],       id: decodeURIComponent(path.slice("/video/".length)) };
  if (path.startsWith("/admin/video/")) return { route: ROUTES["/admin/video"], id: decodeURIComponent(path.slice("/admin/video/".length)) };
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

  const rollenLabel = _rolle === "admin" ? "Admin" : "Kunde";

  appEl().innerHTML = `
    <header class="topbar">
      <a class="brand" href="#${startRoute(_rolle)}">vale<span>—</span>video</a>
      <nav class="topnav">${links}</nav>
      <div class="topbar-right">
        <span class="topbar-user" title="${_user.email}">
          <span class="role-pill">${rollenLabel}</span>
          <span class="user-email">${_user.email}</span>
        </span>
        <button class="btn btn--ghost btn--sm" id="logoutBtn">Abmelden</button>
      </div>
    </header>
    <main class="view" id="view"></main>`;

  document.getElementById("logoutBtn").addEventListener("click", () => logout());
  return document.getElementById("view");
}

// --- Haupt-Render ------------------------------------------------------
function render() {
  // Listener der vorherigen View (onSnapshot) abbestellen.
  raeumeViewAuf();

  if (!_authBereit) {
    appEl().innerHTML = `<div class="boot">Lädt…</div>`;
    return;
  }

  // Nicht eingeloggt -> Login-Screen
  if (!_user) {
    renderLogin(appEl(), { abgewiesen: abgewieseneAdresse() });
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
  route.render(viewContainer, { id, user: _user, rolle: _rolle });
}

// --- Bootstrap ---------------------------------------------------------
beobachteAuth((user, rolle) => {
  _user = user;
  _rolle = rolle;
  _authBereit = true;
  render();
});

window.addEventListener("hashchange", render);
