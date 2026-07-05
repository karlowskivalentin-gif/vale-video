// =====================================================================
// ics.js — clientseitige .ics-Erzeugung (RFC 5545) + Download.
//
// 100 % im Browser, kein Backend (Spark-Plan). Erzeugt eine VCALENDAR
// mit genau einem VEVENT und lädt sie als Datei herunter. Die Datei ist
// universell: Outlook / Microsoft 365, Apple Kalender und Google Kalender
// können sie importieren.
//
// Zeit-Logik:
//   - uhrzeitVon gesetzt → Zeit-Event (floating local time, ohne TZID):
//     DTSTART:YYYYMMDDTHHMMSS / DTEND = uhrzeitBis bzw. +1 h.
//   - keine Uhrzeit       → Ganztags-Event:
//     DTSTART;VALUE=DATE=YYYYMMDD / DTEND = Folgetag.
// =====================================================================

// Text-Werte escapen (RFC 5545 3.3.11): \ ; , und Zeilenumbruch.
function esc(text) {
  return String(text == null ? "" : text)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function pad(n) { return String(n).padStart(2, "0"); }

// Date → "YYYYMMDD" (lokal)
function datumBasic(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

// Date → "YYYYMMDDTHHMMSS" (lokal, floating)
function datumZeitBasic(d) {
  return `${datumBasic(d)}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// Date → "YYYYMMDDTHHMMSSZ" (UTC) — für DTSTAMP
function utcStamp(d) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
       + `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

// "HH:MM" → {h, m} oder null
function parseUhrzeit(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}

// Lange Content-Lines nach 73 Oktetten falten (CRLF + Leerzeichen).
function fold(line) {
  if (line.length <= 73) return line;
  const teile = [];
  let rest = line;
  teile.push(rest.slice(0, 73));
  rest = rest.slice(73);
  while (rest.length > 72) { teile.push(" " + rest.slice(0, 72)); rest = rest.slice(72); }
  if (rest.length) teile.push(" " + rest);
  return teile.join("\r\n");
}

function uid(seed) {
  const rnd = Math.random().toString(36).slice(2, 10);
  return `${(seed || "termin")}-${Date.now()}-${rnd}@vale-video.de`;
}

// Dateinamen-tauglich machen.
function slug(s) {
  return String(s || "termin").toLowerCase()
    .replace(/[äàá]/g, "a").replace(/[öòó]/g, "o").replace(/[üùú]/g, "u").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "termin";
}

// ---------------------------------------------------------------------
// Haupt-API: baut den .ics-Text für ein Event.
//   evt = { titel, datum (Date), uhrzeitVon, uhrzeitBis, ort, notiz, uid }
// ---------------------------------------------------------------------
export function baueIcs(evt) {
  const d = evt.datum instanceof Date ? evt.datum
          : (evt.datum && evt.datum.toDate ? evt.datum.toDate() : new Date(evt.datum));
  if (!d || isNaN(d.getTime())) throw new Error("Ungültiges Datum für .ics-Export.");

  const von = parseUhrzeit(evt.uhrzeitVon);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//vale-video//Kundenportal//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid(evt.uid)}`,
    `DTSTAMP:${utcStamp(new Date())}`
  ];

  if (von) {
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), von.h, von.m, 0);
    const bis = parseUhrzeit(evt.uhrzeitBis);
    let ende;
    if (bis) {
      ende = new Date(d.getFullYear(), d.getMonth(), d.getDate(), bis.h, bis.m, 0);
      if (ende <= start) ende = new Date(start.getTime() + 60 * 60000); // Sicherung: min. +1 h
    } else {
      ende = new Date(start.getTime() + 60 * 60000);
    }
    lines.push(`DTSTART:${datumZeitBasic(start)}`);
    lines.push(`DTEND:${datumZeitBasic(ende)}`);
  } else {
    const ende = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    lines.push(`DTSTART;VALUE=DATE:${datumBasic(d)}`);
    lines.push(`DTEND;VALUE=DATE:${datumBasic(ende)}`);
  }

  lines.push(`SUMMARY:${esc(evt.titel || "Termin")}`);
  if (evt.ort)   lines.push(`LOCATION:${esc(evt.ort)}`);
  if (evt.notiz) lines.push(`DESCRIPTION:${esc(evt.notiz)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");

  return lines.map(fold).join("\r\n") + "\r\n";
}

// .ics als Datei herunterladen.
export function ladeIcsHerunter(evt) {
  const text = baueIcs(evt);
  const blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slug(evt.titel)}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
