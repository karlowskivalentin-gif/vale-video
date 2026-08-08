// =====================================================================
// Aktiver-Kunde-Kontext (Mandanten-Umschalter).
//
// Das Arbeitsportal ist mandantenfähig: jeder kundenbezogene Datensatz
// (videos/objekte/termine/plaene/gedanken/mindmaps) trägt ein Feld `kundeId`.
// Dieses Modul hält fest, unter WELCHEM Kunden der Admin gerade arbeitet, und
// persistiert die Wahl in localStorage. Der Header-Umschalter (router.js)
// setzt sie; alle kundenbezogenen Admin-Views lesen sie und filtern danach.
//
// Für die Rolle „kunde" ist dieses Modul irrelevant — deren kundeId kommt fest
// aus der Auth (kundenmitglieder-Lookup) und wird direkt durchgereicht.
// =====================================================================
import { beobachteKunden } from "./db.js";

const LS_KEY = "vv_aktiver_kunde";

let _aktivId = null;
try { _aktivId = localStorage.getItem(LS_KEY) || null; } catch (_) { /* egal */ }

const wechselCbs = new Set();

// Zuletzt empfangene Kundenliste (Cache über Shell-Rebuilds hinweg) — damit
// Router/Views synchron ans volle Doc des aktiven Kunden kommen (z. B. kundenart).
let _kundenListe = [];

// Aktuell gewählter Kunde (Doc-ID) oder null, solange keiner geladen/gewählt ist.
export function getAktiv() {
  return _aktivId;
}

// Volles Doc des aktiven Kunden aus dem Cache (null vor dem ersten Snapshot).
export function getAktivKunde() {
  return _kundenListe.find((k) => k.id === _aktivId) || null;
}

// Setzt den aktiven Kunden, persistiert ihn und benachrichtigt Abonnenten.
export function setzeAktiv(id) {
  const neu = id || null;
  if (neu === _aktivId) return;
  _aktivId = neu;
  try {
    if (neu) localStorage.setItem(LS_KEY, neu);
    else     localStorage.removeItem(LS_KEY);
  } catch (_) { /* egal */ }
  wechselCbs.forEach((cb) => { try { cb(_aktivId); } catch (_) { /* egal */ } });
}

// Registriert einen Callback, der bei jedem Kundenwechsel feuert. Gibt eine
// Abmelde-Funktion zurück.
export function beiKundenwechsel(cb) {
  wechselCbs.add(cb);
  return () => wechselCbs.delete(cb);
}

// =====================================================================
// Beobachtungsmodus („durch die Augen des Kunden schauen")
//
// Der Admin sieht Nav, Routen und Views der Rolle „kunde" für EINEN Kunden —
// weiterhin mit seiner eigenen Auth. Die Ansicht ist bewusst read-only
// (Guard in styles.css: `body.is-beobachtung`), damit im Namen des Kunden
// nichts ausgelöst oder geschrieben wird.
//
// Bewusst sessionStorage statt localStorage: der Modus endet spätestens mit
// dem Tab und klebt nicht über Tage am Portal.
// =====================================================================
const SS_BEOB = "vv_beobachte_kunde";

let _beobachtet = null;
try { _beobachtet = sessionStorage.getItem(SS_BEOB) || null; } catch (_) { /* egal */ }

// Doc-ID des gerade beobachteten Kunden — oder null (Normalbetrieb).
export function getBeobachtet() {
  return _beobachtet;
}

// Volles Doc des beobachteten Kunden aus dem Cache (null vor dem ersten Snapshot).
export function getBeobachteterKunde() {
  return _kundenListe.find((k) => k.id === _beobachtet) || null;
}

// Beobachtung starten (id) bzw. beenden (null). Der Aufrufer rendert danach neu.
export function setzeBeobachtet(id) {
  _beobachtet = id || null;
  try {
    if (_beobachtet) sessionStorage.setItem(SS_BEOB, _beobachtet);
    else             sessionStorage.removeItem(SS_BEOB);
  } catch (_) { /* egal */ }
}

// Abonniert die Kundenliste (Realtime). Sorgt beim ersten Laden dafür, dass ein
// gültiger Kunde aktiv ist: fehlt einer oder wurde der aktive gelöscht, wird auf
// den ersten Kunden der Liste zurückgefallen. Gibt die onSnapshot-Abmeldung zurück.
export function abonniereKunden(callback, onError) {
  return beobachteKunden((kunden) => {
    _kundenListe = kunden;
    if (kunden.length && (!_aktivId || !kunden.some((k) => k.id === _aktivId))) {
      setzeAktiv(kunden[0].id);
    } else if (!kunden.length && _aktivId) {
      setzeAktiv(null);
    }
    callback(kunden);
  }, onError);
}
