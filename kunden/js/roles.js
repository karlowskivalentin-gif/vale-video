// Rollen-Allowlist (Quelle der Wahrheit für die UI).
// WICHTIG: Diese Liste MUSS mit der Allowlist in firestore.rules übereinstimmen,
// sonst weicht die UI von der echten Server-Sicherheit ab.
// E-Mails werden case-insensitive verglichen.

export const ADMIN_EMAILS = [
  "karlowskivalentin@gmail.com"
];

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

// Gibt 'admin', 'kunde' oder null (kein Zugang) zurück.
export function rolleVon(email) {
  const e = norm(email);
  if (ADMIN_EMAILS.map(norm).includes(e)) return "admin";
  if (KUNDE_EMAILS.map(norm).includes(e)) return "kunde";
  return null;
}

export function istErlaubt(email) {
  return rolleVon(email) !== null;
}
