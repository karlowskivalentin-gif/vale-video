// Kleine, view-übergreifende Helfer.

export function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// Firestore-Timestamp | Date | ms | null  →  "TT.MM.JJJJ" (optional mit Uhrzeit)
export function formatDatum(ts, mitZeit = false) {
  if (!ts) return "—";
  const d = ts && ts.toDate ? ts.toDate() : (ts instanceof Date ? ts : new Date(ts));
  if (isNaN(d.getTime())) return "—";
  const opt = mitZeit
    ? { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "2-digit", year: "numeric" };
  return d.toLocaleString("de-DE", opt);
}

// Timestamp/Date → "YYYY-MM-DD" für <input type="date">
export function tsZuDateInput(ts) {
  if (!ts) return "";
  const d = ts && ts.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return "";
  const off = d.getTimezoneOffset();
  const lokal = new Date(d.getTime() - off * 60000);
  return lokal.toISOString().slice(0, 10);
}

// "YYYY-MM-DD" (aus date-input) → JS-Date (lokale Mitternacht) oder null
export function dateInputZuDate(value) {
  if (!value) return null;
  const d = new Date(value + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}
