// Rollen-Allowlist (Quelle der Wahrheit für die UI).
// WICHTIG: Diese Liste MUSS mit der Allowlist in firestore.rules übereinstimmen,
// sonst weicht die UI von der echten Server-Sicherheit ab.
// E-Mails werden case-insensitive verglichen.

export const ADMIN_EMAILS = [
  "karlowskivalentin@gmail.com"
];

export const KUNDE_EMAILS = [
  "n.berghaus@deussen-immobilien.de",
  "c.deussen@deussen-immobilien.de"
];

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
