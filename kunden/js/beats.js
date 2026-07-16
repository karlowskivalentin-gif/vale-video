// =====================================================================
// Beat-Parser — zerlegt einen Skript-Text in einzelne „Beats" (Dreh-Einheiten)
// für die Drehtag-Checkliste. Rein clientseitig, kein Netzwerk.
//
// Valentins Skripte markieren jeden Beat mit einer Zeile `BEAT <Nr>`, z. B.
//   BEAT 1   HOOK — Nicolai vor dem Haus   0–4s
//   „Dieses Stadthaus in Wersten hat …"          ← Sprechtext
// Die Kopfzeile wird zum Checkbox-Titel, die Folgezeilen bis zum nächsten
// BEAT-Marker zum (aufklappbaren) Sprechtext.
//
// Fallback ohne BEAT-Marker: jeder durch Leerzeile getrennte Absatz = ein Beat,
// damit auch fremd formatierte Skripte irgendein Ergebnis liefern.
// =====================================================================

const BEAT_ZEILE = /^\s*BEAT\s+(\d+)\b(.*)$/i;

// Führende/abschließende „typografische" Anführungszeichen entfernen.
function trimZitat(s) {
  return String(s || "").trim().replace(/^[„“"']+/, "").replace(/[”“"']+$/, "").trim();
}

export function parseBeats(text) {
  const roh = String(text || "").replace(/\r\n?/g, "\n");
  const zeilen = roh.split("\n");

  const beats = [];
  let aktuell = null;
  let hatMarker = false;

  for (const zeile of zeilen) {
    const m = zeile.match(BEAT_ZEILE);
    if (m) {
      hatMarker = true;
      if (aktuell) beats.push(aktuell);
      const nr = parseInt(m[1], 10);
      const rest = (m[2] || "").replace(/^[\s·—–-]+/, "").trim();   // Trenner nach „BEAT n" weg
      aktuell = { nr, titel: `BEAT ${nr}${rest ? " · " + rest : ""}`, sprechtextZeilen: [] };
    } else if (aktuell) {
      if (zeile.trim()) aktuell.sprechtextZeilen.push(zeile.trim());
    }
  }
  if (aktuell) beats.push(aktuell);

  if (hatMarker) {
    return beats.map((b) => ({
      nr: b.nr,
      titel: b.titel,
      sprechtext: trimZitat(b.sprechtextZeilen.join("\n"))
    }));
  }

  // Fallback: Absätze (Leerzeilen-getrennte Blöcke).
  const bloecke = roh.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  return bloecke.map((block, i) => {
    const zeilen2 = block.split("\n");
    const titel = zeilen2[0].trim().slice(0, 80);
    const sprechtext = trimZitat(zeilen2.slice(1).join("\n")) || trimZitat(block);
    return { nr: i + 1, titel: titel || `Beat ${i + 1}`, sprechtext };
  });
}

// Beats → Checklisten-Einträge (Feld `erledigt` steuert die Checkbox).
export function beatsZuChecklist(beats) {
  return (Array.isArray(beats) ? beats : []).map((b) => ({
    text:       b.titel || (b.nr ? `Beat ${b.nr}` : "Beat"),
    sprechtext: b.sprechtext || "",
    erledigt:   false
  }));
}
