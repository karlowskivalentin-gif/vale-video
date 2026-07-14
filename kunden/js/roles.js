// Rollen-Allowlist (Quelle der Wahrheit für die UI).
// WICHTIG: Nur die ADMIN-Liste MUSS mit firestore.rules (adminEmails)
// übereinstimmen. Die KUNDEN sind seit dem Mandanten-Umbau DYNAMISCH: sie
// stehen in der Firestore-Collection kundenmitglieder (angelegt über die
// Kundenverwaltung), NICHT mehr hier. E-Mails werden case-insensitive verglichen.

export const ADMIN_EMAILS = [
  "karlowskivalentin@gmail.com"
];

// Nur noch MIGRATIONS-SEED: die ursprünglichen Deussen-/Test-Adressen, die der
// Migrationslauf (migriereAltbestand) dem Kunden „deussen" als Login-E-Mails
// zuordnet. Danach ist die Zugehörigkeit allein durch kundenmitglieder bestimmt.
// NICHT mehr für die Rollenauflösung verwenden (siehe rolleVon/beobachteAuth).
export const KUNDE_EMAILS = [
  "n.berghaus@deussen-immobilien.de",
  "c.deussen@deussen-immobilien.de",
  "valentinkolja@icloud.com",  // Test-Zugang (Valentin) – iCloud (Firebase-Mails kommen dort oft nicht an)
  "valentinkolja@gmail.com"    // Test-Zugang (Valentin) – Gmail, zuverlässige Zustellung
];

// Kollaborator-Rolle: externer Mitarbeiter mit Zugriff auf GENAU EINE geteilte
// Mindmap (via Einmal-Code freigeschaltet). Die Zuordnung E-Mail→Map liegt in
// Firestore (kollaboratoren/<email>), nicht hier — diese Konstanten definieren
// nur die geteilte Map + den zugehörigen Einladungscode-Datensatz.
export const KOLLAB_MAP_ID = "johannvale";   // Doc-ID der geteilten Mindmap „Johannvale"
export const EINLADUNG_ID  = "johannvale";   // einladung/<EINLADUNG_ID> (= mapId, so referenziert die Rule)

function norm(email) {
  return (email || "").trim().toLowerCase();
}

// Synchrone Rollenauflösung — deckt nur noch den (statischen) Admin ab.
// Gibt 'admin' oder null zurück. Die Kunden-Rolle ist dynamisch und wird in
// auth.js (beobachteAuth) per kundenmitglieder-Lookup aufgelöst.
export function rolleVon(email) {
  const e = norm(email);
  if (ADMIN_EMAILS.map(norm).includes(e)) return "admin";
  return null;
}

// Nur noch „ist Admin?" — für „ist irgendein erlaubter Nutzer?" muss zusätzlich
// der asynchrone kundenmitglieder-Lookup herangezogen werden (siehe auth.js).
export function istErlaubt(email) {
  return rolleVon(email) === "admin";
}
