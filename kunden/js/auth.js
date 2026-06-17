// Authentifizierung via Google-Sign-in (Popup) + E-Mail-Allowlist-Guard.
// Jede Google-Adresse, die NICHT in roles.js steht, wird nach dem Login sofort
// wieder ausgeloggt ("Kein Zugang"). Die echte Datensicherheit liegt zusätzlich
// in den Firestore Security Rules.
import { auth } from "./firebase-init.js";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { rolleVon } from "./roles.js";

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

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

// Beobachtet den Auth-Status. callback(user, rolle):
//   nicht eingeloggt        -> callback(null, null)
//   eingeloggt + erlaubt    -> callback(user, 'admin'|'kunde')
//   eingeloggt + NICHT erlaubt -> sofortiger Logout, danach callback(null, null)
//                                 (abgewieseneAdresse() liefert dann die E-Mail)
export function beobachteAuth(callback) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      callback(null, null);
      return;
    }
    const rolle = rolleVon(user.email);
    if (!rolle) {
      _abgewiesen = user.email || "unbekannt";
      await signOut(auth); // löst erneutes onAuthStateChanged(null) aus
      return;
    }
    _abgewiesen = null;
    callback(user, rolle);
  });
}
