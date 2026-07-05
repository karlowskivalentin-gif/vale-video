// Login-View: zentrierte, gebrandete Karte.
// Hauptweg: E-Mail + Passwort. Ausweichwege: E-Mail-Link (passwortlos) + Google.
import { loginMitGoogle, loginMitPasswort, sendeLoginLink,
         sendePasswortReset, schliesseLoginLinkAbMit } from "../auth.js";

export function renderLogin(container, opts = {}) {
  const abgewiesen      = opts.abgewiesen;
  const linkEmailNoetig = opts.linkEmailNoetig;   // Link auf anderem Gerät -> E-Mail erneut bestätigen
  const linkFehler      = opts.linkFehler;        // Link ungültig/abgelaufen

  // --- Sonderfall: Link-Anmeldung abschließen (E-Mail fehlt) -----------
  if (linkEmailNoetig) {
    container.innerHTML = `
      <div class="login-wrap">
        <div class="login-card card">
          <span class="brand brand--lg">vale<span>—</span>video</span>
          <p class="login-eyebrow">Kundenportal</p>
          <h1 class="login-title">Anmeldung bestätigen</h1>
          <p class="muted login-sub">
            Bitte gib zur Sicherheit nochmal die E-Mail-Adresse ein, an die der
            Login-Link geschickt wurde.
          </p>
          <div class="notice notice--error" id="loginError" hidden role="alert"></div>
          <form id="confirmForm" novalidate>
            <div class="field">
              <label for="confirmEmail">E-Mail-Adresse</label>
              <input id="confirmEmail" name="confirmEmail" type="email" required
                     placeholder="name@firma.de" autocomplete="email" />
            </div>
            <button class="btn btn--accent btn--block" id="confirmBtn" type="submit">
              <span class="btn-label">Anmeldung abschließen</span>
            </button>
          </form>
          <p class="login-foot muted">vale-video.de · Kundenbereich</p>
        </div>
      </div>`;

    const form  = container.querySelector("#confirmForm");
    const btn   = container.querySelector("#confirmBtn");
    const label = btn.querySelector(".btn-label");
    const err   = container.querySelector("#loginError");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      err.hidden = true;
      const email = form.confirmEmail.value.trim();
      if (!email) { err.textContent = "Bitte E-Mail-Adresse eingeben."; err.hidden = false; return; }
      btn.disabled = true; label.textContent = "Anmeldung läuft…";
      const r = await schliesseLoginLinkAbMit(email);
      if (r.status === "angemeldet") return; // onAuthStateChanged rendert weiter
      btn.disabled = false; label.textContent = "Anmeldung abschließen";
      err.textContent = r.status === "fehler"
        ? "Der Login-Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an."
        : "Bitte E-Mail-Adresse eingeben.";
      err.hidden = false;
    });
    return;
  }

  // --- Normalfall: Passwort (primär) + Link + Google -------------------
  container.innerHTML = `
    <div class="login-wrap">
      <div class="login-card card">
        <span class="brand brand--lg">vale<span>—</span>video</span>
        <p class="login-eyebrow">Kundenportal</p>
        <h1 class="login-title">Anmelden</h1>
        <p class="muted login-sub">
          Melde dich an, um deine Objekte und Videos zu sehen. Der Zugang ist auf
          freigeschaltete Adressen beschränkt.
        </p>

        ${abgewiesen ? `
          <div class="notice notice--error" role="alert">
            Kein Zugang für <strong>${escapeHtml(abgewiesen)}</strong>.
            Bitte melde dich mit einer freigeschalteten Adresse an oder
            wende dich an Valentin.
          </div>` : ``}

        ${linkFehler ? `
          <div class="notice notice--error" role="alert">${escapeHtml(linkFehler)}</div>` : ``}

        <div class="notice notice--error" id="loginError" hidden role="alert"></div>
        <div class="notice notice--ok"    id="loginOk"    hidden role="status"></div>

        <form id="pwForm" novalidate>
          <div class="field">
            <label for="pwEmail">E-Mail-Adresse</label>
            <input id="pwEmail" name="pwEmail" type="email" required
                   placeholder="name@firma.de" autocomplete="email" />
          </div>
          <div class="field">
            <label for="pwPass">Passwort</label>
            <input id="pwPass" name="pwPass" type="password" required
                   placeholder="••••••••" autocomplete="current-password" />
          </div>
          <button class="btn btn--accent btn--block" id="pwBtn" type="submit">
            <span class="btn-label">Anmelden</span>
          </button>
          <button class="btn-link" id="pwForgot" type="button">Passwort vergessen?</button>
        </form>

        <div class="login-divider"><span>oder</span></div>

        <button class="btn btn--ghost btn--block" id="googleLoginBtn" type="button">
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#FFC107" d="M17.6 9.2c0-.6-.05-1.18-.16-1.74H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.64-3.88 2.64-6.72z"/>
            <path fill="#FF3D00" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.85.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.94v2.33A9 9 0 0 0 9 18z" transform="translate(0 0)"/>
            <path fill="#4CAF50" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.94A9 9 0 0 0 0 9c0 1.45.35 2.82.94 4.05l3.03-2.33z"/>
            <path fill="#1976D2" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .94 4.95l3.03 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>
          </svg>
          <span class="btn-label">Mit Google anmelden</span>
        </button>

        <form id="linkForm" novalidate>
          <div class="field" style="margin-top:1rem">
            <label for="linkEmail">Oder per E-Mail-Link anmelden</label>
            <input id="linkEmail" name="linkEmail" type="email" required
                   placeholder="name@firma.de" autocomplete="email" />
            <p class="field-hint muted">
              Kein Passwort nötig — wir schicken dir einen Anmelde-Link in dein Postfach.
              <br>Externe Mitarbeiter: hier mit eigener E-Mail anmelden und danach den Zugangscode eingeben.
            </p>
          </div>
          <button class="btn btn--ghost btn--block" id="linkBtn" type="submit">
            <span class="btn-label">Login-Link senden</span>
          </button>
        </form>

        <p class="login-foot muted">vale-video.de · Kundenbereich</p>
      </div>
    </div>`;

  const errBox  = container.querySelector("#loginError");
  const okBox   = container.querySelector("#loginOk");

  // --- Passwort-Anmeldung ---------------------------------------------
  const pwForm   = container.querySelector("#pwForm");
  const pwBtn    = container.querySelector("#pwBtn");
  const pwLabel  = pwBtn.querySelector(".btn-label");
  const pwForgot = container.querySelector("#pwForgot");

  pwForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.hidden = true; okBox.hidden = true;
    const email = pwForm.pwEmail.value.trim();
    const pass  = pwForm.pwPass.value;
    if (!email || !pass) { errBox.textContent = "Bitte E-Mail und Passwort eingeben."; errBox.hidden = false; return; }
    pwBtn.disabled = true; pwLabel.textContent = "Anmeldung läuft…";
    try {
      await loginMitPasswort(email, pass);
      // Erfolg -> onAuthStateChanged -> router rendert weiter.
    } catch (err) {
      pwBtn.disabled = false; pwLabel.textContent = "Anmelden";
      const code = err && err.code;
      if (code === "vv/nicht-freigeschaltet") {
        errBox.textContent = "Diese Adresse ist nicht freigeschaltet. Bitte wende dich an Valentin.";
      } else if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
        errBox.textContent = "E-Mail oder Passwort stimmt nicht. Noch kein Passwort? Melde dich per Link an und lege im Portal eines fest.";
      } else if (code === "auth/user-not-found") {
        errBox.textContent = "Kein Konto mit dieser Adresse. Bitte per E-Mail-Link anmelden.";
      } else if (code === "auth/too-many-requests") {
        errBox.textContent = "Zu viele Versuche. Bitte später erneut versuchen oder Passwort zurücksetzen.";
      } else {
        errBox.textContent = "Anmeldung fehlgeschlagen. Bitte erneut versuchen.";
      }
      errBox.hidden = false;
    }
  });

  // --- Passwort vergessen ---------------------------------------------
  pwForgot.addEventListener("click", async () => {
    errBox.hidden = true; okBox.hidden = true;
    const email = pwForm.pwEmail.value.trim();
    if (!email) { errBox.textContent = "Bitte zuerst deine E-Mail-Adresse oben eingeben."; errBox.hidden = false; return; }
    try {
      await sendePasswortReset(email);
      okBox.innerHTML = `Wir haben dir eine E-Mail zum Zurücksetzen des Passworts an <strong>${escapeHtml(email)}</strong> geschickt.`;
      okBox.hidden = false;
    } catch (err) {
      if (err && err.code === "vv/nicht-freigeschaltet") {
        errBox.textContent = "Diese Adresse ist nicht freigeschaltet. Bitte wende dich an Valentin.";
      } else {
        errBox.textContent = "E-Mail konnte nicht gesendet werden. Bitte später erneut versuchen.";
      }
      errBox.hidden = false;
    }
  });

  const gBtn    = container.querySelector("#googleLoginBtn");
  const gLabel  = gBtn.querySelector(".btn-label");

  gBtn.addEventListener("click", async () => {
    errBox.hidden = true; okBox.hidden = true;
    gBtn.disabled = true;
    gLabel.textContent = "Anmeldung läuft…";
    try {
      await loginMitGoogle();
      // Erfolg -> auth.js feuert onAuthStateChanged -> router rendert weiter.
    } catch (e) {
      gBtn.disabled = false;
      gLabel.textContent = "Mit Google anmelden";
      errBox.textContent = (e && e.code === "auth/popup-closed-by-user")
        ? "Anmeldung abgebrochen. Bitte erneut versuchen."
        : "Anmeldung fehlgeschlagen. Bitte erneut versuchen.";
      errBox.hidden = false;
    }
  });

  // --- E-Mail-Link anfordern ------------------------------------------
  const linkForm  = container.querySelector("#linkForm");
  const linkBtn   = container.querySelector("#linkBtn");
  const linkLabel = linkBtn.querySelector(".btn-label");

  linkForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.hidden = true; okBox.hidden = true;
    const email = linkForm.linkEmail.value.trim();
    if (!email) { errBox.textContent = "Bitte E-Mail-Adresse eingeben."; errBox.hidden = false; return; }

    linkBtn.disabled = true;
    linkLabel.textContent = "Link wird gesendet…";
    try {
      await sendeLoginLink(email);
      okBox.innerHTML = `Wir haben dir einen Anmelde-Link an <strong>${escapeHtml(email)}</strong>
        geschickt. Öffne ihn <strong>auf diesem Gerät</strong> — danach bist du eingeloggt.`;
      okBox.hidden = false;
      linkLabel.textContent = "Link gesendet ✓";
    } catch (err) {
      linkBtn.disabled = false;
      linkLabel.textContent = "Login-Link senden";
      if (err && err.code === "vv/nicht-freigeschaltet") {
        errBox.textContent = "Diese Adresse ist nicht freigeschaltet. Bitte wende dich an Valentin.";
      } else if (err && err.code === "auth/operation-not-allowed") {
        errBox.textContent = "E-Mail-Link-Anmeldung ist noch nicht aktiviert. Bitte kurz Valentin Bescheid geben.";
      } else {
        errBox.textContent = "Link konnte nicht gesendet werden. Bitte später erneut versuchen.";
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
