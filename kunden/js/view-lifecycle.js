// Mini-Lebenszyklus für Views: erlaubt das Aufräumen von Firestore-
// onSnapshot-Listenern beim Wechsel der Route. Der Router ruft
// raeumeViewAuf() vor jedem Render auf; Views registrieren ihre
// Unsubscribe-Funktion via beiViewWechsel().
let _cleanups = [];

export function beiViewWechsel(fn) {
  if (typeof fn === "function") _cleanups.push(fn);
}

export function raeumeViewAuf() {
  const liste = _cleanups;
  _cleanups = [];
  liste.forEach((fn) => { try { fn(); } catch (_) { /* egal */ } });
}
