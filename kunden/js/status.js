// =====================================================================
// Status-Logik: die 10 internen Pipeline-Stufen, das kundenfreundliche
// Mapping und die 4 erlaubten Kunden-Übergänge.
//
// WICHTIG: Die Übergangs-Whitelist (kundenFreigabeZiel / kundenAenderungZiel /
// kundenVerwerfenZiel) MUSS exakt mit der Funktion `erlaubterUebergang` in
// firestore.rules übereinstimmen. Wird hier etwas geändert, auch dort anpassen.
// =====================================================================

// --- Die internen Pipeline-Stufen (in Reihenfolge) --------------------
// VERWORFEN ist ein terminaler Seiten-Status (nicht Teil der linearen Kette):
// der Kunde hat das Skript abgelehnt („wird nicht gemacht"). Steht am Ende der
// Reihenfolge, damit es im Admin-Dropdown wählbar/reaktivierbar bleibt.
export const STATUS = {
  IDEE:             "💡 Idee",
  SKRIPT:           "📝 Skript",
  FREIGABE_SKRIPT:  "🔍 Freigabe Skript",
  DREHBEREIT:       "🎬 Drehbereit",
  GEDREHT:          "🎥 Gedreht",
  SCHNITT:          "✂️ Schnitt",
  FREIGABE_SCHNITT: "🔎 Freigabe Schnitt",
  FREIGEGEBEN:      "✅ Freigegeben",
  GEPLANT:          "📅 Geplant",
  GEPOSTET:         "🚀 Gepostet",
  VERWORFEN:        "🚫 Verworfen"
};

// Reihenfolge für Dropdowns / Pipeline-Sortierung.
export const STATUS_REIHENFOLGE = [
  STATUS.IDEE,
  STATUS.SKRIPT,
  STATUS.FREIGABE_SKRIPT,
  STATUS.DREHBEREIT,
  STATUS.GEDREHT,
  STATUS.SCHNITT,
  STATUS.FREIGABE_SCHNITT,
  STATUS.FREIGEGEBEN,
  STATUS.GEPLANT,
  STATUS.GEPOSTET,
  STATUS.VERWORFEN
];

export function statusIndex(status) {
  return STATUS_REIHENFOLGE.indexOf(status);
}

// --- Objekt-Status (kundenfreundlich, direkt gespeichert) -------------
export const OBJEKT_STATUS = {
  EINGEGANGEN:   "Eingegangen",
  IN_PRODUKTION: "In Produktion",
  ERLEDIGT:      "Erledigt"
};
export const OBJEKT_STATUS_LISTE = [
  OBJEKT_STATUS.EINGEGANGEN,
  OBJEKT_STATUS.IN_PRODUKTION,
  OBJEKT_STATUS.ERLEDIGT
];

// --- Video-Typen ------------------------------------------------------
export const VIDEO_TYPEN = [
  "Social Reel",
  "Imagefilm",
  "Cinematic Film",
  "Objektvideo",
  "Drohnenvideo",
  "Real Estate (wortloses Edit)"
];

// Typen, bei denen es KEINE separate Skript-Freigabe gibt (nur Schnitt-Freigabe):
// reine Edit-/Cinematic-Formate ohne Sprechertext/Skript.
const TYPEN_OHNE_SKRIPT = ["Cinematic Film", "Real Estate (wortloses Edit)"];

export function skriptFreigabeNoetig(typ) {
  return !TYPEN_OHNE_SKRIPT.includes(typ);
}

// =====================================================================
// Kundenfreundliches Mapping — interne Stufen werden NIE gezeigt.
// Liefert: { label, aktion (bool), art ('skript'|'schnitt'|null), ton }
// `ton` steuert nur die optische Einfärbung in der Kunden-UI.
// =====================================================================
export function kundenStatus(intern) {
  switch (intern) {
    case STATUS.IDEE:
    case STATUS.SKRIPT:
      return { label: "In Vorbereitung", aktion: false, art: null, ton: "neutral" };

    case STATUS.FREIGABE_SKRIPT:
      return { label: "⏳ Skript wartet auf deine Freigabe", aktion: true, art: "skript", ton: "aktion" };

    case STATUS.DREHBEREIT:
    case STATUS.GEDREHT:
    case STATUS.SCHNITT:
      return { label: "In Produktion", aktion: false, art: null, ton: "neutral" };

    case STATUS.FREIGABE_SCHNITT:
      return { label: "⏳ Video wartet auf deine Freigabe", aktion: true, art: "schnitt", ton: "aktion" };

    case STATUS.FREIGEGEBEN:
    case STATUS.GEPLANT:
      return { label: "Fertig – wird veröffentlicht", aktion: false, art: null, ton: "ok" };

    case STATUS.GEPOSTET:
      return { label: "Veröffentlicht", aktion: false, art: null, ton: "ok" };

    case STATUS.VERWORFEN:
      return { label: "Wird nicht produziert", aktion: false, art: null, ton: "rot" };

    default:
      return { label: "In Vorbereitung", aktion: false, art: null, ton: "neutral" };
  }
}

export function istFreigabeStufe(status) {
  return status === STATUS.FREIGABE_SKRIPT || status === STATUS.FREIGABE_SCHNITT;
}

// =====================================================================
// „Gebongt" — intern fixiert, dass dieses Video wirklich kommt
// (Umgangssprache vom Kassen-„Bon": abgehakt/beschlossen). Rein Admin-
// intern, der Kunde sieht das nie.
// =====================================================================

// Ab dieser Stufe gilt ein Video AUTOMATISCH als gebongt: sobald es gedreht
// ist (oder weiter — Schnitt/Freigabe/Geplant/Gepostet), ist die Produktion
// faktisch beschlossen.
export const GEBONGT_AB_STATUS = STATUS.GEDREHT;

// Automatisch gebongt = allein wegen des Status (ohne manuelles Flag).
// „Verworfen" steht am Listenende und hat einen hohen Reihenfolge-Index —
// darf aber NIE als gebongt gelten, daher explizit ausgeschlossen.
export function autoGebongt(video) {
  return !!video
      && video.status !== STATUS.VERWORFEN
      && statusIndex(video.status) >= statusIndex(GEBONGT_AB_STATUS);
}

// Gebongt = manuell markiert (Flag) ODER automatisch per Status.
export function istGebongt(video) {
  return !!video
      && video.status !== STATUS.VERWORFEN
      && (video.gebongt === true || autoGebongt(video));
}

// =====================================================================
// Die erlaubten Kunden-Übergänge (= Sicherheitskern, gespiegelt in Rules)
// =====================================================================

// Kunde GIBT FREI → Auto-Sprung vorwärts. null = in diesem Status nicht erlaubt.
export function kundenFreigabeZiel(status) {
  if (status === STATUS.FREIGABE_SKRIPT)  return STATUS.DREHBEREIT;
  if (status === STATUS.FREIGABE_SCHNITT) return STATUS.FREIGEGEBEN;
  return null;
}

// Kunde FORDERT ÄNDERUNGEN → eine Stufe zurück. null = nicht erlaubt.
export function kundenAenderungZiel(status) {
  if (status === STATUS.FREIGABE_SKRIPT)  return STATUS.SKRIPT;
  if (status === STATUS.FREIGABE_SCHNITT) return STATUS.SCHNITT;
  return null;
}

// Kunde VERWIRFT das Skript („wird nicht gemacht") → Verworfen. Nur aus der
// Skript-Freigabe erlaubt (die Ampel gibt es nur beim Skript). null = nicht erlaubt.
export function kundenVerwerfenZiel(status) {
  if (status === STATUS.FREIGABE_SKRIPT) return STATUS.VERWORFEN;
  return null;
}
