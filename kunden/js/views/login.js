// Login-View: zentrierte, gebrandete Karte mit Google-Anmeldung.
import { loginMitGoogle } from "../auth.js";

export function renderLogin(container, opts = {}) {
  const abgewiesen = opts.abgewiesen;

  container.innerHTML = `
    <div class="login-wrap">
      <div class="login-card card">
        <span class="brand brand--lg">vale<span>—</span>video</span>
        <p class="login-eyebrow">Kundenportal</p>
        <h1 class="login-title">Anmelden</h1>
        <p class="muted login-sub">
          Melde dich mit deinem Google-Konto an. Der Zugang ist auf freigeschaltete
          Adressen beschränkt.
        </p>

        ${abgewiesen ? `
          <div class="notice notice--error" role="alert">
            Kein Zugang für <strong>${escapeHtml(abgewiesen)}</strong>.
            Bitte melde dich mit einer freigeschalteten Adresse an oder
            wende dich an Valentin.
          </div>` : ``}

        <div class="notice notice--error" id="loginError" hidden role="alert"></div>

        <button class="btn btn--accent btn--block" id="googleLoginBtn" type="button">
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#FFC107" d="M17.6 9.2c0-.6-.05-1.18-.16-1.74H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.64-3.88 2.64-6.72z"/>
            <path fill="#FF3D00" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.85.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.94v2.33A9 9 0 0 0 9 18z" transform="translate(0 0)"/>
            <path fill="#4CAF50" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.94A9 9 0 0 0 0 9c0 1.45.35 2.82.94 4.05l3.03-2.33z"/>
            <path fill="#1976D2" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .94 4.95l3.03 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>
          </svg>
          <span class="btn-label">Mit Google anmelden</span>
        </button>

        <p class="login-foot muted">vale-video.de · Kundenbereich</p>
      </div>
    </div>`;

  const btn = container.querySelector("#googleLoginBtn");
  const label = btn.querySelector(".btn-label");
  const errBox = container.querySelector("#loginError");

  btn.addEventListener("click", async () => {
    errBox.hidden = true;
    btn.disabled = true;
    label.textContent = "Anmeldung läuft…";
    try {
      await loginMitGoogle();
      // Erfolg -> auth.js feuert onAuthStateChanged -> router rendert weiter.
    } catch (e) {
      btn.disabled = false;
      label.textContent = "Mit Google anmelden";
      if (e && e.code === "auth/popup-closed-by-user") {
        errBox.textContent = "Anmeldung abgebrochen. Bitte erneut versuchen.";
      } else {
        errBox.textContent = "Anmeldung fehlgeschlagen. Bitte erneut versuchen.";
      }
      errBox.hidden = false;
    }
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
