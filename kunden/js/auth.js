// Authentifizierung für das Kundenportal — zwei Wege, eine Allowlist:
//   1) Google-Sign-in (Popup)     -> v. a. Admin (Gmail)
//   2) E-Mail-Link (passwortlos)  -> v. a. Kunde (Microsoft/Outlook, kein Google-Konto)
// Jede Adresse, die NICHT in roles.js steht, wird nach dem Login sofort wieder
// ausgeloggt ("Kein Zugang"). Die echte Datensicherheit liegt zusätzlich in den
// Firestore Security Rules (dort: email_verified == true + Allowlist).
import { auth } from "./firebase-init.js";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signInWithEmailAndPassword,
  updatePassword,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { rolleVon, KUNDE_EMAILS } from "./roles.js";
import { ladeKollaborator, ladeKundenmitglied } from "./db.js";

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

// localStorage-Schlüssel: merkt sich die E-Mail zwischen "Link anfordern" und
// "Link anklicken" (gleiches Gerät -> kein erneutes Tippen nötig).
const LS_EMAIL = "vv_login_email";

// Merkt sich die zuletzt abgewiesene E-Mail, damit die Login-View
// "Kein Zugang für X" anzeigen kann.
let _abgewiesen = null;
export function abgewieseneAdresse() {
  return _abgewiesen;
}

export async function loginMitGoogle() {
  _abgewiesen = null;
  return signInWithPopup(auth, provider);
}

export async function logout() {
  _abgewiesen = null;
  return signOut(auth);
}

// --- Passwort-Anmeldung -----------------------------------------------
// Neuer Standard-Weg: E-Mail + Passwort. Die Konten existieren bereits
// (per Link angelegt + verifiziert); das Passwort setzt man im Portal
// (setzePasswort) — dadurch bleibt email_verified erhalten und die
// Firestore-Regeln (email_verified == true) greifen weiter.
// Kein Vorab-Gate mehr: Ob eine E-Mail Kunde ist, steht in Firestore und ist
// UNAUTHENTIFIZIERT nicht lesbar (Rules) — ein Vorab-Check würde legitime Kunden
// fälschlich abweisen. Firebase prüft die Anmeldedaten; beobachteAuth entscheidet
// danach über Rolle/Zugriff (ohne Rolle → Zugangscode-Screen, keine Daten).
export async function loginMitPasswort(email, pw) {
  _abgewiesen = null;
  const e = (email || "").trim().toLowerCase();
  return signInWithEmailAndPassword(auth, e, pw);
}

// Setzt/ändert das Passwort des aktuell eingeloggten Nutzers.
// Rückgabe-Status: "ok" | "neu-anmelden" | "schwach" | "fehler".
export async function setzePasswort(pw) {
  const user = auth.currentUser;
  if (!user) return { status: "fehler", code: "kein-user" };
  try {
    await updatePassword(user, pw);
    return { status: "ok" };
  } catch (err) {
    const code = (err && err.code) || "unbekannt";
    if (code === "auth/requires-recent-login") return { status: "neu-anmelden", code };
    if (code === "auth/weak-password")          return { status: "schwach", code };
    return { status: "fehler", code };
  }
}

// Schickt eine Passwort-zurücksetzen-Mail (nur an freigeschaltete Adressen).
export async function sendePasswortReset(email) {
  const e = (email || "").trim().toLowerCase();
  // Kein Vorab-Gate (s. loginMitPasswort). Firebase versendet die Reset-Mail nur
  // für tatsächlich existierende Konten.
  await sendPasswordResetEmail(auth, e);
  return e;
}

// --- E-Mail-Link (passwortlos) ----------------------------------------
// Continue-URL = aktuelle Portalseite ohne Hash/Query. Muss eine autorisierte
// Domain sein (vale-video.de bzw. localhost) — sonst lehnt Firebase den Link ab.
function actionCodeSettings() {
  return { url: location.origin + location.pathname, handleCodeInApp: true };
}

// Schickt den Login-Link an JEDE Adresse. Freigeschaltete Nutzer (Admin/Kunde)
// landen direkt in ihrem Bereich; alle anderen im Zugangscode-Screen (externe
// Mitarbeiter lösen dort ihren Einmal-Code ein). Die echte Grenze bleiben die
// Firestore Rules — ein Login ohne Rolle gibt keinerlei Datenzugriff.
export async function sendeLoginLink(email) {
  const e = (email || "").trim().toLowerCase();
  await sendSignInLinkToEmail(auth, e, actionCodeSettings());
  try { window.localStorage.setItem(LS_EMAIL, e); } catch (_) {}
  return e;
}

// Schickt einem (frisch angelegten) Kunden seinen Anmelde-Link. Der Kunde
// klickt ihn, ist eingeloggt (die Rolle „kunde" ergibt sich aus dem
// kundenmitglieder-Lookup) und setzt danach im Portal sein Passwort → ab dann
// Login mit E-Mail + Passwort (Selbstläufer). Anders als sendeLoginLink wird
// hier bewusst KEINE E-Mail in localStorage gemerkt: Empfänger ist der Kunde,
// nicht der gerade eingeloggte Admin (sonst würde dessen Login-Merker
// überschrieben). Der Kunde tippt seine E-Mail beim ersten Klick selbst ein.
export async function sendeKundenZugang(email) {
  const e = (email || "").trim().toLowerCase();
  if (!e) throw new Error("E-Mail fehlt");
  await sendSignInLinkToEmail(auth, e, actionCodeSettings());
  return e;
}

// Ist die aktuell geöffnete URL ein Firebase-Login-Link?
export function istLoginLink() {
  return isSignInWithEmailLink(auth, location.href);
}

// Schließt den Login per Link ab (E-Mail aus localStorage, gleiches Gerät).
// Rückgabe-Status: "kein-link" | "angemeldet" | "email-benoetigt" | "fehler".
export async function schliesseLoginLinkAb() {
  if (!istLoginLink()) return { status: "kein-link" };
  let e = "";
  try { e = window.localStorage.getItem(LS_EMAIL) || ""; } catch (_) {}
  if (!e) return { status: "email-benoetigt" };
  return _signInMitLink(e);
}

// Variante mit manuell eingegebener E-Mail (Link auf anderem Gerät geöffnet).
export async function schliesseLoginLinkAbMit(email) {
  const e = (email || "").trim().toLowerCase();
  if (!e) return { status: "email-benoetigt" };
  return _signInMitLink(e);
}

async function _signInMitLink(e) {
  try {
    await signInWithEmailLink(auth, e, location.href);
    try { window.localStorage.removeItem(LS_EMAIL); } catch (_) {}
    // Lange oob-Query aus der Adresszeile entfernen, damit ein Reload den Link
    // nicht erneut (und dann ungültig) zu verarbeiten versucht.
    history.replaceState({}, document.title, location.origin + location.pathname);
    return { status: "angemeldet" }; // onAuthStateChanged übernimmt den Rest
  } catch (err) {
    return { status: "fehler", code: (err && err.code) || "unbekannt" };
  }
}

// Beobachtet den Auth-Status. callback(user, rolle, info):
//   nicht eingeloggt          -> callback(null, null, null)
//   eingeloggt + Admin        -> callback(user, 'admin', null)
//   eingeloggt + Kunde        -> callback(user, 'kunde', { kundeId })   (Mandant)
//   eingeloggt + Kollaborator -> callback(user, 'kollaborator', { mapId })
//   eingeloggt + keine Rolle  -> callback(user, null, { codeNoetig: true })
//                                (NICHT ausloggen — der Code-Screen bietet Eingabe/Logout)
export function beobachteAuth(callback) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      callback(null, null, null);
      return;
    }
    // Admin (statisch)?
    if (rolleVon(user.email) === "admin") {
      _abgewiesen = null;
      callback(user, "admin", null);
      return;
    }
    // Kunde (dynamisch, Mandant)? kundenmitglieder/<email> → { kundeId }
    try {
      const km = await ladeKundenmitglied(user.email);
      if (km && km.kundeId) {
        _abgewiesen = null;
        callback(user, "kunde", { kundeId: km.kundeId });
        return;
      }
    } catch (e) {
      console.warn("Kunden-Prüfung fehlgeschlagen:", e);
    }
    // ÜBERGANG: ursprüngliche Deussen-/Test-Adressen gelten bis zur Migration als
    // Kunde (Mandant „deussen"), auch ohne kundenmitglieder-Eintrag — passend zum
    // altKundeEmails-Fallback in firestore.rules. NACH der Migration entfernen.
    if (KUNDE_EMAILS.map((x) => x.toLowerCase()).includes((user.email || "").toLowerCase())) {
      _abgewiesen = null;
      callback(user, "kunde", { kundeId: "deussen" });
      return;
    }
    // Sonst evtl. freigeschalteter Kollaborator (Firestore)?
    try {
      const k = await ladeKollaborator(user.email);
      if (k && k.mapId) {
        _abgewiesen = null;
        callback(user, "kollaborator", { mapId: k.mapId });
        return;
      }
    } catch (e) {
      console.warn("Kollaborator-Prüfung fehlgeschlagen:", e);
    }
    // Eingeloggt, aber (noch) keine Rolle → Zugangscode anbieten.
    _abgewiesen = null;
    callback(user, null, { codeNoetig: true });
  });
}
