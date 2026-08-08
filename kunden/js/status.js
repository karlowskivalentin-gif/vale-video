// =====================================================================
// Status-Logik: die 10 internen Pipeline-Stufen, das kundenfreundliche
// Mapping und die 4 erlaubten Kunden-Übergänge.
//
// Zusätzlich: die Monats-Logik der gemeldeten Objekte (Anlage-Monat →
// Produktionsmonat), siehe objektProduktionsMonat() weiter unten.
//
// WICHTIG: Die Übergangs-Whitelist (kundenFreigabeZiel / kundenAenderungZiel /
// kundenVerwerfenZiel) MUSS exakt mit der Funktion `erlaubterUebergang` in
// firestore.rules übereinstimmen. Wird hier etwas geändert, auch dort anpassen.
// =====================================================================
import { monatKey, monatPlus, monatsLabel } from "./util.js";

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

// --- Pipeline-Parkplatz „Später" --------------------------------------
// Videos, die als Idee/Skript existieren, aber noch keinen Drehmonat haben.
// Statt eines zweiten Feldes ein Sentinel im vorhandenen `monat`-Feld: die
// Monats-Gruppierung der Pipeline greift dadurch unverändert weiter, und das
// Umhängen ist derselbe Dropdown-Wechsel wie zwischen zwei echten Monaten.
// Der Wert kollidiert bewusst nie mit dem "YYYY-MM"-Format.
export const MONAT_SPAETER = "spaeter";

export function istSpaeter(monat) {
  return monat === MONAT_SPAETER;
}

// Label für Pipeline-Sektionen und Monats-Dropdowns — kennt zusätzlich zu den
// echten Monaten den Parkplatz.
export function pipelineMonatsLabel(key) {
  return istSpaeter(key) ? "🅿️ Irgendwann" : monatsLabel(key);
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

// --- Objekt-Monate: gemeldet im Juli → Produktion im August -----------
// Der Produktionsmonat steht als "YYYY-MM" im Feld `produktionsMonat` und ist
// im Admin jederzeit umhängbar. Beide Helfer haben einen Read-side-Fallback auf
// `erstelltAm`, damit Bestandsobjekte ohne Feld ohne Migration/Backfill sauber
// einsortiert werden — geschrieben wird das Feld erst beim Anlegen oder wenn der
// Admin den Monat ändert.

// Monat, in dem das Objekt gemeldet wurde ("YYYY-MM").
export function objektMeldeMonat(o) {
  const ts = o && o.erstelltAm;
  const d = ts && typeof ts.toDate === "function" ? ts.toDate() : new Date();
  return monatKey(d);
}

// Produktionsmonat des Objekts ("YYYY-MM") = Melde-Monat + 1, sofern nicht gesetzt.
export function objektProduktionsMonat(o) {
  if (o && o.produktionsMonat) return o.produktionsMonat;
  return monatPlus(objektMeldeMonat(o), 1);
}

// --- Kundenarten ------------------------------------------------------
// Jeder Kunde hat eine Branche (kunden/{id}.kundenart). Bestandskunden ohne
// Feld gelten als "immobilien" — deshalb überall über kundenartVon() lesen.
export const KUNDENARTEN = {
  immobilien: { label: "Immobilien", emoji: "🏠" },
  gastro:     { label: "Gastro",     emoji: "☕" }
};
export function kundenartVon(kunde) {
  const art = kunde && kunde.kundenart;
  return KUNDENARTEN[art] ? art : "immobilien";
}

// --- Objekt-/Filial-Typen (je Kundenart) --------------------------------
// Immobilien melden Objekte, Gastro meldet Filialen/Standorte — gleiche
// Collection `objekte`, nur andere Typ-Listen und Wording.
const OBJEKT_TYPEN_JE_ART = {
  immobilien: ["Wohnung", "Haus", "Gewerbe", "Grundstück"],
  gastro:     ["Café", "Rösterei", "Restaurant", "Bar/Lounge", "Sonstiges"]
};
export function objektTypenFuer(kundenart) {
  return OBJEKT_TYPEN_JE_ART[kundenart] || OBJEKT_TYPEN_JE_ART.immobilien;
}

// --- Video-Typen (je Kundenart) ----------------------------------------
const VIDEO_TYPEN_JE_ART = {
  immobilien: [
    "Social Reel",
    "Imagefilm",
    "Cinematic Film",
    "Objektvideo",
    "Drohnenvideo",
    "Real Estate (wortloses Edit)"
  ],
  gastro: [
    "Social Reel",
    "Food-/Produkt-Reel",
    "Behind the Scenes",
    "Imagefilm",
    "Cinematic Film",
    "Drohnenvideo",
    "Ambiente-Film (wortloses Edit)",
    "Interview/Team-Porträt"
  ]
};
export function videoTypenFuer(kundenart) {
  return VIDEO_TYPEN_JE_ART[kundenart] || VIDEO_TYPEN_JE_ART.immobilien;
}
// Rückwärtskompatibler Default (historischer Konsument: admin-video-edit).
export const VIDEO_TYPEN = VIDEO_TYPEN_JE_ART.immobilien;

// Typen, bei denen es KEINE separate Skript-Freigabe gibt (nur Schnitt-Freigabe):
// reine Edit-/Cinematic-Formate ohne Sprechertext/Skript. Union über ALLE
// Kundenarten — der Lookup läuft über gespeicherte Strings und muss auch für
// Alt-Videos jeder Branche stimmen.
const TYPEN_OHNE_SKRIPT = ["Cinematic Film", "Real Estate (wortloses Edit)", "Ambiente-Film (wortloses Edit)"];

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

// --- Fortschritt für den Kunden (4 Schritte) --------------------------
// Die 10 internen Stufen sind für den Kunden zu fein — er will wissen: „wo
// steht mein Video?". Deshalb ein grobes Vier-Schritt-Raster. Formate ohne
// Skript (wortlose Edits) starten mit „Konzept" statt „Skript".
export function kundenSchritte(typ) {
  return [skriptFreigabeNoetig(typ) ? "Skript" : "Konzept", "Dreh", "Schnitt", "Fertig"];
}

// Index des aktuellen Schritts (0..3). „Verworfen" hat keinen Fortschritt und
// wird von der View gesondert behandelt (Rückgabe -1).
export function kundenSchrittIndex(status) {
  switch (status) {
    case STATUS.IDEE:
    case STATUS.SKRIPT:
    case STATUS.FREIGABE_SKRIPT:  return 0;
    case STATUS.DREHBEREIT:
    case STATUS.GEDREHT:          return 1;
    case STATUS.SCHNITT:
    case STATUS.FREIGABE_SCHNITT: return 2;
    case STATUS.FREIGEGEBEN:
    case STATUS.GEPLANT:
    case STATUS.GEPOSTET:         return 3;
    case STATUS.VERWORFEN:        return -1;
    default:                      return 0;
  }
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
