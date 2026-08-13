// =====================================================================
// Kernlogik der Personal-Brand-Skriptwerkstatt — geteilt von Liste
// (admin-brand.js), Editor (admin-brand-skript.js) und Shoot-Modus
// (admin-shoot.js). Rein rechnend, kein DOM, kein Firestore.
//
// Die drei Ansichten müssen zwingend DIESELBE Fortschrittsformel benutzen:
// sonst zeigt die Liste 90 %, der Editor sperrt aber das Abschicken.
// =====================================================================
import { escapeHtml } from "./util.js";

// --- Auswahllisten -----------------------------------------------------
export const PLATTFORMEN = [
  { id: "reel",     label: "Instagram Reel" },
  { id: "short",    label: "YouTube Short" },
  { id: "tiktok",   label: "TikTok" },
  { id: "youtube",  label: "YouTube (lang)" },
  { id: "linkedin", label: "LinkedIn" }
];

export const STATUS_LABEL = {
  idee:            { txt: "Idee",            cls: "idee" },
  rohfassung:      { txt: "Rohfassung",      cls: "rohfassung" },
  drehreif:        { txt: "Drehreif",        cls: "drehreif" },
  gedreht:         { txt: "Gedreht",         cls: "gedreht" },
  veroeffentlicht: { txt: "Veröffentlicht",  cls: "veroeffentlicht" }
};

// Ab „drehreif" ist der Plan abgeschickt: Editor read-only, Shoot-Modus frei.
export function istAbgeschickt(skript) {
  return ["drehreif", "gedreht", "veroeffentlicht"].includes((skript && skript.status) || "");
}

export const GROESSEN = [
  { id: "total",     label: "Total" },
  { id: "halbtotal", label: "Halbtotal" },
  { id: "halbnah",   label: "Halbnah" },
  { id: "nah",       label: "Nah" },
  { id: "detail",    label: "Detail" }
];

export const PERSPEKTIVEN = [
  { id: "augenhoehe",   label: "Augenhöhe" },
  { id: "frosch",       label: "Froschperspektive" },
  { id: "vogel",        label: "Vogelperspektive" },
  { id: "ueberschulter", label: "Over-Shoulder" },
  { id: "pov",          label: "POV" }
];

export const BEWEGUNGEN = [
  { id: "statisch", label: "Statisch" },
  { id: "gimbal",   label: "Gimbal" },
  { id: "handheld", label: "Handheld" },
  { id: "schwenk",  label: "Schwenk" },
  { id: "zoom",     label: "Zoom" },
  { id: "slider",   label: "Slider" }
];

export const BROLL_QUELLEN = [
  { id: "selbst",  label: "Selbst drehen" },
  { id: "archiv",  label: "Aus dem Archiv" },
  { id: "stock",   label: "Stock/Fremdmaterial" },
  { id: "screen",  label: "Screen-Recording" }
];

// Checklisten-Merkmale, die an einer Take-Passage HÄNGEN müssen.
export const STORY_ITEMS = [
  { id: "hook",        label: "Hook (erste 3 Sek.)", hinweis: "Der Satz, der das Wegwischen verhindert." },
  { id: "kernaussage", label: "Kernaussage / Mehrwert", hinweis: "Wofür der Zuschauer bleibt." },
  { id: "cta",         label: "Call-to-Action", hinweis: "Was er danach tun soll." }
];

// Checklisten-Punkte auf Skript-Ebene (keine Take-Zuordnung, nur ausfüllen).
export const POST_ITEMS = [
  { id: "caption",   label: "Caption / Beschreibung" },
  { id: "hashtags",  label: "Hashtags / Keywords" },
  { id: "postDatum", label: "Geplantes Post-Datum" }
];

export const STANDARD_PROMPT =
  "Du bist Skript-Doktor für kurze Social-Media-Videos. Schreibe das folgende Rohskript "
  + "um: schärfere Hook in den ersten 3 Sekunden, gesprochene Sprache statt Schriftdeutsch, "
  + "kurze Sätze, kein Füllwort-Ballast, klarer Call-to-Action am Schluss. Behalte meine "
  + "Aussage und meinen Ton bei — gib NUR den fertigen Skripttext zurück, ohne Vorrede und "
  + "ohne Erklärungen.";

// --- IDs ---------------------------------------------------------------
export function neueId(praefix) {
  return `${praefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function leererTake(text, von, bis) {
  return {
    tid: neueId("t"),
    von: Number.isFinite(von) ? von : null,
    bis: Number.isFinite(bis) ? bis : null,
    text: text || "",
    label: "",
    // Kamera-Basis
    groesse: "", perspektive: "", bewegung: "",
    // Ort & Zeit
    location: "", tageszeit: "", dauer: null,
    // Look & Ton
    brennweite: "", licht: "", ton: "", overlay: "",
    // Produktion
    gedreht: false, requisiten: "", notiz: ""
  };
}

export function leeresBroll(vonTid, bisTid) {
  return {
    bid: neueId("b"),
    vonTid: vonTid || null,
    bisTid: bisTid || null,
    beschreibung: "",
    groesse: "", bewegung: "", quelle: "selbst",
    gedreht: false, notiz: ""
  };
}

// =====================================================================
// Takes an den Text nachführen („Selbstheilung")
//
// Sobald eine KI den Text umschreibt, stimmen die gespeicherten Offsets
// nicht mehr. Statt die Takes wegzuwerfen (dort stecken alle Kamera-Infos)
// wird ihre Passage im neuen Text gesucht:
//   1. Offsets passen noch exakt  → festnageln
//   2. Passage kommt vor          → nächstgelegenes freies Vorkommen nehmen
//   3. Passage ist weg            → von/bis = null (Take bleibt, wird als
//                                    „losgelöst" markiert und ist neu
//                                    zuordenbar)
// Zwei Takes mit identischem Wortlaut dürfen dabei nicht auf dieselbe
// Stelle fallen — deshalb die Belegt-Liste.
// =====================================================================
export function syncTakes(text, takes) {
  const t = String(text == null ? "" : text);
  const liste = (takes || []).map((x) => ({ ...x }));
  const belegt = [];
  const frei = (von, bis) => !belegt.some((b) => von < b.bis && bis > b.von);

  // Runde 1: unveränderte Takes zuerst festnageln.
  liste.forEach((take) => {
    const p = String(take.text || "");
    if (!p) return;
    if (Number.isFinite(take.von) && Number.isFinite(take.bis)
        && t.slice(take.von, take.bis) === p && frei(take.von, take.bis)) {
      belegt.push({ von: take.von, bis: take.bis });
      take._fest = true;
    }
  });

  // Runde 2: verschobene Takes wiederfinden.
  liste.forEach((take) => {
    if (take._fest) return;
    const p = String(take.text || "");
    if (!p) { take.von = null; take.bis = null; return; }
    const treffer = [];
    let i = t.indexOf(p);
    while (i !== -1 && treffer.length < 200) {
      if (frei(i, i + p.length)) treffer.push(i);
      i = t.indexOf(p, i + 1);
    }
    if (!treffer.length) { take.von = null; take.bis = null; return; }
    const ziel = Number.isFinite(take.von) ? take.von : 0;
    const beste = treffer.reduce((a, b) => (Math.abs(b - ziel) < Math.abs(a - ziel) ? b : a));
    take.von = beste;
    take.bis = beste + p.length;
    belegt.push({ von: take.von, bis: take.bis });
  });

  liste.forEach((take) => { delete take._fest; });
  return liste;
}

// =====================================================================
// Takes beim TIPPEN mitziehen
//
// syncTakes() sucht Passagen — das ist richtig, wenn ein kompletter Text
// ausgetauscht wird, aber falsch beim Tippen: schreibt man MITTEN in eine
// Take-Passage, wäre ihr alter Wortlaut nicht mehr auffindbar und der Take
// würde sich grundlos lösen. Deshalb hier der billige Diff-Weg: gemeinsamen
// Anfang und gemeinsames Ende bestimmen, daraus den geänderten Bereich
// ableiten und alle Offsets darauf abbilden.
//
// Wird ein Take komplett weggelöscht, bleibt er mit seinem Text erhalten
// und gilt als losgelöst — die Kamera-Infos sind zu wertvoll zum Wegwerfen.
// =====================================================================
export function verschiebeTakes(altText, neuText, takes) {
  const a = String(altText == null ? "" : altText);
  const b = String(neuText == null ? "" : neuText);
  if (a === b) return (takes || []).map((x) => ({ ...x }));

  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;

  const aVon = p;                 // Beginn der Änderung (in beiden Texten gleich)
  const aBis = a.length - s;      // Ende des ersetzten Bereichs im ALTEN Text
  const bBis = b.length - s;      // Ende des neuen Bereichs im NEUEN Text
  const delta = b.length - a.length;

  const abbilden = (pos) => {
    if (pos <= aVon) return pos;
    if (pos >= aBis) return pos + delta;
    return Math.min(pos, bBis);   // Position lag im ersetzten Stück → ans neue Ende klemmen
  };

  return (takes || []).map((take) => {
    const t = { ...take };
    if (istLosgeloest(t)) return t;
    const von = abbilden(t.von);
    const bis = abbilden(t.bis);
    if (bis <= von) { t.von = null; t.bis = null; return t; }   // Passage komplett gelöscht
    t.von = von;
    t.bis = bis;
    t.text = b.slice(von, bis);
    return t;
  });
}

// Takes in Textreihenfolge; losgelöste (ohne Fundstelle) ans Ende.
export function sortierteTakes(takes) {
  return (takes || []).slice().sort((a, b) => {
    const av = Number.isFinite(a.von) ? a.von : Infinity;
    const bv = Number.isFinite(b.von) ? b.von : Infinity;
    return av - bv;
  });
}

export function istLosgeloest(take) {
  return !Number.isFinite(take && take.von) || !Number.isFinite(take && take.bis);
}

// Ein Take ohne Fundstelle ist zweierlei — und das muss die UI unterscheiden:
//   • aus einem Format-Gerüst erzeugt, noch nie an Text gehängt (text === "")
//     → völlig normal, wartet nur auf seine Passage
//   • hatte mal eine Passage, die beim Umschreiben verschwunden ist
//     → das ist der Warnfall
export function istVerwaist(take) {
  return istLosgeloest(take) && !!String((take && take.text) || "").trim();
}

export function istGeruest(take) {
  return istLosgeloest(take) && !String((take && take.text) || "").trim();
}

// --- Text mit Take-Markierungen als HTML (Editor-Overlay) --------------
// Baut denselben Text wie die Textarea, nur mit <mark> um jede Take-Passage.
// Das abschließende "\n" verhindert, dass die letzte Zeile im Overlay
// wegfällt (Browser schlucken einen Zeilenumbruch am Blockende).
export function markiertesHtml(text, takes, aktiveTid) {
  const t = String(text == null ? "" : text);
  const bereiche = sortierteTakes(takes).filter((x) => !istLosgeloest(x));
  let out = "";
  let pos = 0;
  bereiche.forEach((take, i) => {
    const von = Math.max(pos, Math.min(take.von, t.length));
    const bis = Math.max(von, Math.min(take.bis, t.length));
    if (von > pos) out += escapeHtml(t.slice(pos, von));
    const aktiv = aktiveTid && take.tid === aktiveTid ? " is-aktiv" : "";
    out += `<mark class="bs-mark bs-mark--${(i % 4) + 1}${aktiv}" data-tid="${escapeHtml(take.tid)}">`
         + escapeHtml(t.slice(von, bis)) + `</mark>`;
    pos = bis;
  });
  out += escapeHtml(t.slice(pos)) + "\n";
  return out;
}

// =====================================================================
// Fortschritt
//
//   Checkliste (60 %) — 3 Story-Merkmale einem Take zugeordnet
//                       + Caption/Hashtags/Post-Datum ausgefüllt
//   Technik    (40 %) — jeder Take hat Größe, Perspektive, Bewegung, Dauer
//
// Ohne Takes ist der Technik-Anteil 0 — ein leeres Skript kann also nie
// 100 % erreichen, egal wie voll die Checkliste ist.
// =====================================================================
const TECHNIK_FELDER = [
  { id: "groesse",     label: "Einstellungsgröße" },
  { id: "perspektive", label: "Perspektive" },
  { id: "bewegung",    label: "Kamerabewegung" },
  { id: "dauer",       label: "Dauer" }
];

export function takeFehlendeFelder(take) {
  const offen = TECHNIK_FELDER.filter((f) => {
    const wert = take ? take[f.id] : null;
    if (f.id === "dauer") return !(Number(wert) > 0);
    return !String(wert || "").trim();
  });
  // Ein Take, der an keiner Textstelle hängt, ist nicht fertig geplant —
  // sonst käme ein Skript auf 100 %, dessen Format-Gerüst noch leer ist.
  if (istLosgeloest(take)) offen.unshift({ id: "passage", label: "Textstelle" });
  return offen;
}

export function takeVollstaendig(take) {
  return takeFehlendeFelder(take).length === 0;
}

// Liefert { gesamt, checkliste:{erledigt,gesamt}, technik:{erledigt,gesamt}, fehlt:[…] }
export function berechneFortschritt(skript) {
  const s = skript || {};
  const cl = s.checkliste || {};
  const takes = Array.isArray(s.takes) ? s.takes : [];
  const bekannteTids = new Set(takes.map((t) => t.tid));
  const fehlt = [];

  let clErledigt = 0;
  STORY_ITEMS.forEach((item) => {
    // Eine Zuordnung auf einen gelöschten Take zählt nicht.
    if (cl[item.id] && bekannteTids.has(cl[item.id])) clErledigt++;
    else fehlt.push(`${item.label} ist noch keiner Take-Passage zugeordnet`);
  });
  POST_ITEMS.forEach((item) => {
    if (String(cl[item.id] || "").trim()) clErledigt++;
    else fehlt.push(`${item.label} fehlt`);
  });
  const clGesamt = STORY_ITEMS.length + POST_ITEMS.length;

  const reihenfolge = sortierteTakes(takes);
  let techErledigt = 0;
  reihenfolge.forEach((take, i) => {
    const offen = takeFehlendeFelder(take);
    if (!offen.length) { techErledigt++; return; }
    const name = take.label ? `Take ${i + 1} (${take.label})` : `Take ${i + 1}`;
    fehlt.push(`${name}: ${offen.map((f) => f.label).join(", ")} fehlt`);
  });
  if (!takes.length) fehlt.push("Noch keine Takes — markiere im Skript eine Passage und mach eine Take daraus");

  const clAnteil   = clGesamt ? clErledigt / clGesamt : 0;
  const techAnteil = takes.length ? techErledigt / takes.length : 0;

  return {
    gesamt: Math.round((clAnteil * 0.6 + techAnteil * 0.4) * 100),
    checkliste: { erledigt: clErledigt, gesamt: clGesamt },
    technik:    { erledigt: techErledigt, gesamt: takes.length },
    fehlt
  };
}

// =====================================================================
// FORMATE — wiederverwendbare Baupläne
//
// Ein Format ist ein Rezept, keine Linksammlung: seine „Beats" sind das
// Take-Gerüst, das beim Anlegen eines Skripts direkt erzeugt wird. Deshalb
// tragen Beats schon Kamera-Vorgaben — man füllt nur noch Text nach.
// =====================================================================
export const AUFWAND = [
  { id: "schnell", label: "Schnell (unter 1 h)" },
  { id: "mittel",  label: "Mittel (halber Tag)" },
  { id: "gross",   label: "Groß (Drehtag)" }
];

export function leererBeat(label) {
  return {
    bid: neueId("beat"),
    label: label || "",
    hinweis: "",
    groesse: "", perspektive: "", bewegung: "", dauer: null
  };
}

// Beats → fertige (noch textlose) Takes. Sie gelten als „Gerüst", nicht als
// verwaist: text bleibt leer, bis Valentin ihnen eine Passage zuweist.
export function takesAusFormat(format) {
  const beats = (format && Array.isArray(format.beats)) ? format.beats : [];
  return beats.map((b) => {
    const take = leererTake("", null, null);
    take.label       = b.label || "";
    take.groesse     = b.groesse || "";
    take.perspektive = b.perspektive || "";
    take.bewegung    = b.bewegung || "";
    take.dauer       = Number(b.dauer) > 0 ? Number(b.dauer) : null;
    take.notiz       = b.hinweis || "";
    return take;
  });
}

// --- Kleinkram --------------------------------------------------------
export function gesamtDauer(takes) {
  return (takes || []).reduce((s, t) => s + (Number(t.dauer) > 0 ? Number(t.dauer) : 0), 0);
}

export function dauerLabel(sek) {
  const s = Math.round(Number(sek) || 0);
  if (!s) return "—";
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} min`;
}

export function labelVon(liste, id) {
  const e = (liste || []).find((x) => x.id === id);
  return e ? e.label : "";
}

// Take-Chips („Nah · Augenhöhe · Statisch") für Karten und Shoot-Modus.
export function takeChips(take) {
  const t = take || {};
  return [
    labelVon(GROESSEN, t.groesse),
    labelVon(PERSPEKTIVEN, t.perspektive),
    labelVon(BEWEGUNGEN, t.bewegung),
    t.location,
    t.tageszeit,
    Number(t.dauer) > 0 ? `${t.dauer} s` : "",
    t.brennweite,
    t.licht,
    t.ton ? `♪ ${t.ton}` : "",
    t.overlay ? `Overlay: ${t.overlay}` : "",
    t.requisiten ? `Requisite: ${t.requisiten}` : ""
  ].filter((x) => String(x || "").trim());
}

// Welche Story-Merkmale hängen an diesem Take?
export function merkmaleVonTake(skript, tid) {
  const cl = (skript && skript.checkliste) || {};
  return STORY_ITEMS.filter((item) => cl[item.id] === tid);
}

// B-Roll-Band → Index-Spanne in der sortierten Take-Liste.
// Fehlt eine Referenz (Take gelöscht), wird die vorhandene Seite genommen;
// fehlen beide, liefert die Funktion null (Band hängt in der Luft).
export function brollSpanne(broll, sortiert) {
  const idx = (tid) => sortiert.findIndex((t) => t.tid === tid);
  let a = idx(broll && broll.vonTid);
  let b = idx(broll && broll.bisTid);
  if (a === -1 && b === -1) return null;
  if (a === -1) a = b;
  if (b === -1) b = a;
  return { von: Math.min(a, b), bis: Math.max(a, b) };
}

// --- Drehplan als Text (Zwischenablage) -------------------------------
export function drehplanText(skript) {
  const s = skript || {};
  const sortiert = sortierteTakes(s.takes);
  const zeilen = [];
  zeilen.push(`${s.titel || "Ohne Titel"} — ${labelVon(PLATTFORMEN, s.plattform) || "Video"}`);
  zeilen.push(`Gesamtlänge ca. ${dauerLabel(gesamtDauer(s.takes))} · ${sortiert.length} Takes`);
  zeilen.push("");
  sortiert.forEach((take, i) => {
    const merkmale = merkmaleVonTake(s, take.tid).map((m) => m.label);
    zeilen.push(`TAKE ${i + 1}${take.label ? " · " + take.label : ""}${merkmale.length ? " · " + merkmale.join(" + ") : ""}`);
    const chips = takeChips(take);
    if (chips.length) zeilen.push(`  [${chips.join(" · ")}]`);
    if (take.text) zeilen.push(`  „${take.text.replace(/\s*\n\s*/g, " ").trim()}"`);
    if (take.notiz) zeilen.push(`  Notiz: ${take.notiz}`);
    zeilen.push("");
  });
  const broll = Array.isArray(s.broll) ? s.broll : [];
  if (broll.length) {
    zeilen.push("B-ROLL");
    broll.forEach((b) => {
      const sp = brollSpanne(b, sortiert);
      const ueber = sp
        ? (sp.von === sp.bis ? `über Take ${sp.von + 1}` : `über Take ${sp.von + 1}–${sp.bis + 1}`)
        : "ohne Zuordnung";
      const teile = [labelVon(GROESSEN, b.groesse), labelVon(BEWEGUNGEN, b.bewegung), labelVon(BROLL_QUELLEN, b.quelle)]
        .filter(Boolean).join(" · ");
      zeilen.push(`  • ${b.beschreibung || "B-Roll"} (${ueber})${teile ? " [" + teile + "]" : ""}`);
    });
    zeilen.push("");
  }
  const cl = s.checkliste || {};
  if (cl.caption)  zeilen.push(`CAPTION: ${cl.caption}`);
  if (cl.hashtags) zeilen.push(`HASHTAGS: ${cl.hashtags}`);
  if (cl.postDatum) zeilen.push(`POST AM: ${cl.postDatum}`);
  return zeilen.join("\n").trim();
}

// --- Zwischenablage ---------------------------------------------------
// navigator.clipboard braucht einen sicheren Kontext (https/localhost).
// Der Fallback über ein temporäres Textfeld deckt ältere/blockierte Fälle ab.
export async function kopiere(text) {
  const s = String(text == null ? "" : text);
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(s);
      return true;
    }
  } catch (_) { /* Fallback unten */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = s;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch (_) {
    return false;
  }
}
