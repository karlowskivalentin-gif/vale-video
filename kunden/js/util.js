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

// ---------------------------------------------------------------------------
// Kalender-Buckets für Auswertungen (Tag / ISO-Kalenderwoche / Monat).
// Alle bewusst LOKAL (getFullYear/getMonth/getDate), nicht über toISOString,
// damit Buckets nicht durch die UTC-Verschiebung auf den Vor-/Folgetag rutschen.
// ---------------------------------------------------------------------------
export const MONATE_KURZ = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun",
                            "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

// Lokaler Kalendertag als "YYYY-MM-DD".
export function tagKey(d) {
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ISO-8601-Kalenderwoche (Woche beginnt Montag; KW1 enthält den 4. Januar).
// Rückgabe: { jahr, kw } — jahr ist das ISO-Wochenjahr (kann am Jahreswechsel
// vom Kalenderjahr abweichen, z. B. 31.12. → KW1 des Folgejahres).
export function isoKW(d) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const tag = (t.getDay() + 6) % 7;           // Mo=0 … So=6
  t.setDate(t.getDate() - tag + 3);           // auf den Donnerstag dieser Woche
  const jahr = t.getFullYear();
  const jan4 = new Date(jahr, 0, 4);
  const kw = 1 + Math.round(((t - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return { jahr, kw };
}

// ISO-Wochen-Gruppierungs-Key, chronologisch sortierbar: "YYYY-Www".
export function wochenKey(d) {
  const { jahr, kw } = isoKW(d);
  return `${jahr}-W${String(kw).padStart(2, "0")}`;
}

// Monats-Gruppierungs-Key "YYYY-MM".
export function monatKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Kleines, sicheres Markdown → HTML (alles wird zuerst escaped). Wird von der
// Gedanken-Mindmap, dem Fokus-To-Do-Panel und der To-Do-Detailansicht geteilt.
export function mdZuHtml(src) {
  let out = escapeHtml(src || "");
  out = out
    .replace(/^###\s+(.*)$/gm, "<h3>$1</h3>")
    .replace(/^##\s+(.*)$/gm, "<h2>$1</h2>")
    .replace(/^#\s+(.*)$/gm, "<h1>$1</h1>");
  out = out.replace(/(?:^|\n)((?:\s*-\s+.*(?:\n|$))+)/g, (m, block) => {
    const items = block.trim().split("\n")
      .map((l) => l.replace(/^\s*-\s+/, "").trim())
      .filter(Boolean)
      .map((t) => `<li>${t}</li>`).join("");
    return `\n<ul>${items}</ul>\n`;
  });
  out = out
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>');
  out = out.replace(/\n/g, "<br>");
  // <br> direkt um Blockelemente wieder entfernen (kosmetisch)
  out = out.replace(/<br>\s*(<\/?(?:h1|h2|h3|ul|li)>)/g, "$1")
           .replace(/(<\/?(?:h1|h2|h3|ul|li)>)\s*<br>/g, "$1");
  return out;
}
