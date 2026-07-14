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

// Aktuell gewählter Kunde (Doc-ID) oder null, solange keiner geladen/gewählt ist.
export function getAktiv() {
  return _aktivId;
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

// Abonniert die Kundenliste (Realtime). Sorgt beim ersten Laden dafür, dass ein
// gültiger Kunde aktiv ist: fehlt einer oder wurde der aktive gelöscht, wird auf
// den ersten Kunden der Liste zurückgefallen. Gibt die onSnapshot-Abmeldung zurück.
export function abonniereKunden(callback, onError) {
  return beobachteKunden((kunden) => {
    if (kunden.length && (!_aktivId || !kunden.some((k) => k.id === _aktivId))) {
      setzeAktiv(kunden[0].id);
    } else if (!kunden.length && _aktivId) {
      setzeAktiv(null);
    }
    callback(kunden);
  }, onError);
}
