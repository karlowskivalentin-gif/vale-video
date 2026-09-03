// =====================================================================
// Social-Kennzahlen: die gesamte Rechenlogik der Social-Ansichten.
//
// Rein rechnend — kein DOM, kein Firestore. Grund (wie bei brandplan.js):
// Admin-Ansicht und Kunden-Ansicht MUESSEN dieselben Zahlen zeigen. Gaebe
// es die Formeln zweimal, wuerden sie irgendwann auseinanderlaufen und der
// Kunde saehe eine andere Wirkung als Valentin.
//
// Datenformen, die hier hereinkommen:
//   snapshots = [{ tag:"YYYY-MM-DD", follower, reichweite, profilaufrufe }]
//               Bestandswerte (Follower-STAND), ein Dokument pro Tag.
//   posts     = [{ externeId, veroeffentlichtAm, likes, kommentare, ... , videoId }]
//   videos    = [{ id, titel, status, geplantesDatum }]  aus der videos-Collection
// =====================================================================
import { tagKey, wochenKey, monatKey, monatsLabel, MONATE_KURZ } from "./util.js";
import { STATUS } from "./status.js";

// --- Tages-Arithmetik auf "YYYY-MM-DD"-Schluesseln --------------------
// util.js liefert Keys aus Date-Objekten, aber kein Rechnen auf den Keys.
// Bewusst ueber lokale Date-Objekte statt String-Arithmetik: Monatslaengen
// und Schaltjahre sind sonst eine Fehlerquelle.
export function tagZuDate(key) {
  const [j, m, t] = String(key).split("-").map(Number);
  if (!j || !m || !t) return null;
  return new Date(j, m - 1, t);
}

export function tagPlus(key, tage) {
  const d = tagZuDate(key);
  if (!d) return key;
  d.setDate(d.getDate() + tage);
  return tagKey(d);
}

// Differenz in Tagen (b - a). Ueber Mittag gerechnet, damit die Sommerzeit-
// Umstellung (23-/25-Stunden-Tage) nicht auf +-1 Tag durchschlaegt.
export function tageZwischen(a, b) {
  const da = tagZuDate(a), db = tagZuDate(b);
  if (!da || !db) return 0;
  da.setHours(12); db.setHours(12);
  return Math.round((db - da) / 86400000);
}

// --- Snapshots aufbereiten --------------------------------------------
// Faellt der Cron einen Tag aus, fehlt der Snapshot. Fuer jede Auswertung
// wird die Luecke mit dem letzten bekannten Stand gefuellt (forward fill) —
// ein fehlender Tag bedeutet "keine neue Messung", nicht "0 Follower".
// Rueckgabe: lueckenlose, aufsteigend sortierte Reihe.
export function reiheAuffuellen(snapshots) {
  const gueltig = (snapshots || [])
    .filter((s) => s && s.tag && Number.isFinite(Number(s.follower)))
    .sort((a, b) => String(a.tag).localeCompare(String(b.tag)));
  if (!gueltig.length) return [];

  const proTag = new Map();
  gueltig.forEach((s) => proTag.set(s.tag, s));

  const reihe = [];
  const ende = gueltig[gueltig.length - 1].tag;
  let cursor = gueltig[0].tag;
  let letzter = null;
  // Sicherheitsnetz gegen kaputte Tages-Keys: hoechstens 10 Jahre.
  let schutz = 3700;

  while (tageZwischen(cursor, ende) >= 0 && schutz-- > 0) {
    const s = proTag.get(cursor);
    if (s) {
      letzter = s;
      reihe.push({ ...s, gemessen: true });
    } else if (letzter) {
      reihe.push({
        ...letzter,
        tag: cursor,
        reichweite: 0,      // Tageswerte gelten NICHT fort — nur der Bestand.
        profilaufrufe: 0,
        gemessen: false
      });
    }
    cursor = tagPlus(cursor, 1);
  }
  return reihe;
}

// Follower-Stand je Tag als Map, Luecken gefuellt.
export function standProTag(snapshots) {
  const m = new Map();
  reiheAuffuellen(snapshots).forEach((s) => m.set(s.tag, Number(s.follower)));
  return m;
}

// --- Zeitreihe fuer die Diagramme -------------------------------------
// gran: "tag" | "woche" | "monat".
// Der Follower-Wert eines Buckets ist der STAND AM ENDE des Buckets (letzter
// Messwert), nicht die Summe — anders als bei den Fokus-Minuten. Reichweite
// und Profilaufrufe sind dagegen Tagesereignisse und werden summiert.
export function zeitreihe(snapshots, gran = "tag", anzahl = 30) {
  const reihe = reiheAuffuellen(snapshots);
  if (!reihe.length) return [];

  const buckets = new Map();
  reihe.forEach((s) => {
    const d = tagZuDate(s.tag);
    if (!d) return;
    const key = gran === "woche" ? wochenKey(d) : gran === "monat" ? monatKey(d) : s.tag;
    const b = buckets.get(key) || {
      key, follower: 0, reichweite: 0, profilaufrufe: 0, erster: null, letzter: null
    };
    b.follower = Number(s.follower);          // laeuft mit → am Ende der letzte
    b.reichweite += Number(s.reichweite || 0);
    b.profilaufrufe += Number(s.profilaufrufe || 0);
    if (b.erster === null) b.erster = Number(s.follower);
    b.letzter = s.tag;
    buckets.set(key, b);
  });

  const liste = [...buckets.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(-anzahl);

  // Zuwachs = Differenz zum jeweils vorigen Bucket.
  return liste.map((b, i) => ({
    ...b,
    label: bucketLabel(b.key, gran),
    zuwachs: i === 0 ? (b.follower - b.erster) : (b.follower - liste[i - 1].follower)
  }));
}

function bucketLabel(key, gran) {
  if (gran === "monat") return monatsLabel(key);
  if (gran === "woche") return "KW " + key.slice(-2);
  const d = tagZuDate(key);
  return d ? `${d.getDate()}. ${MONATE_KURZ[d.getMonth()]}` : key;
}

// --- Wachstum ueber einen Zeitraum ------------------------------------
// Rueckgabe: { start, ende, absolut, prozent, tage } — null, wenn zu wenig Daten.
export function wachstum(snapshots, tage = 30) {
  const reihe = reiheAuffuellen(snapshots);
  if (reihe.length < 2) return null;

  const letzterTag = reihe[reihe.length - 1].tag;
  const zielTag = tagPlus(letzterTag, -tage);
  // Der erste Messpunkt, der nicht vor dem Zielzeitraum liegt.
  const start = reihe.find((s) => tageZwischen(zielTag, s.tag) >= 0) || reihe[0];
  const ende = reihe[reihe.length - 1];

  const a = Number(start.follower), b = Number(ende.follower);
  return {
    start: a,
    ende: b,
    absolut: b - a,
    prozent: a > 0 ? Math.round(((b - a) / a) * 1000) / 10 : 0,
    tage: Math.max(1, tageZwischen(start.tag, ende.tag))
  };
}

// --- Der Wirkungs-Nachweis --------------------------------------------
// Die Kernfrage des ganzen Features: waechst der Account nach einem Video
// staerker als sonst?
//
// Methode: fuer jeden Tag t wird der Follower-Zuwachs im Fenster [t, t+fenster]
// gebildet und einer von drei Gruppen zugeordnet:
//   "mit Video"  — im Fenster wurde mindestens ein eigenes Video veroeffentlicht
//   "ohne Video" — im Fenster UND im Fenster davor lag kein Video
//   verworfen    — kein Video im Fenster, aber eines kurz davor
//
// Die dritte Gruppe ist der Punkt, an dem eine naive Rechnung falsch wird:
// ein Fenster unmittelbar NACH einem Video enthaelt selbst kein Video, laeuft
// aber noch in dessen Nachwirkung. Zaehlt man es als Vergleichswert, hebt der
// Effekt seinen eigenen Referenzwert an und macht sich damit unsichtbar. In
// einer Testreihe mit +1 Follower Grundrauschen und +5 nach einem Video kam
// so 10,2 statt der wahren 7 heraus — die Wirkung erschien um ein Drittel
// kleiner, als sie war. Deshalb braucht "ohne Video" einen Sicherheitsabstand
// von einem vollen Fenster nach hinten.
//
// Rueckgabe null, wenn eine der beiden Gruppen leer bleibt — dann gibt es
// schlicht noch keine belastbare Aussage.
export function wirkung(snapshots, videos, fenster = 7) {
  const stand = standProTag(snapshots);
  if (stand.size < fenster + 2) return null;

  const videoTage = new Set(
    (videos || [])
      .filter((v) => v && v.status === STATUS.GEPOSTET && v.geplantesDatum)
      .map((v) => tagKey(zuDate(v.geplantesDatum)))
      .filter(Boolean)
  );
  if (!videoTage.size) return null;

  const tage = [...stand.keys()].sort();
  const mit = [], ohne = [];

  let verworfen = 0;

  tage.forEach((t) => {
    const bis = tagPlus(t, fenster);
    if (!stand.has(bis)) return;                       // Fenster ragt ueber das Ende
    const delta = stand.get(bis) - stand.get(t);

    // Liegt ein Video IM Fenster?
    for (let i = 0; i < fenster; i++) {
      if (videoTage.has(tagPlus(t, i))) { mit.push(delta); return; }
    }
    // Nein — aber liegt eines kurz davor? Dann ist das Fenster Nachwirkung
    // und taugt nicht als unbelasteter Vergleichswert.
    for (let i = 1; i <= fenster; i++) {
      if (videoTage.has(tagPlus(t, -i))) { verworfen++; return; }
    }
    ohne.push(delta);
  });

  if (!mit.length || !ohne.length) return null;

  const schnitt = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const mitS = schnitt(mit), ohneS = schnitt(ohne);

  return {
    fenster,
    mitVideo: Math.round(mitS * 10) / 10,
    ohneVideo: Math.round(ohneS * 10) / 10,
    unterschied: Math.round((mitS - ohneS) * 10) / 10,
    faktor: ohneS > 0 ? Math.round((mitS / ohneS) * 10) / 10 : null,
    anzahlMit: mit.length,
    anzahlOhne: ohne.length,
    anzahlVerworfen: verworfen,
    videoTage: videoTage.size
  };
}

// --- Posts -------------------------------------------------------------
// Engagement = alles, was ein Mensch aktiv getan hat. Views bleiben aussen
// vor: sie zaehlen passiven Konsum und wuerden Reels gegenueber Feed-Posts
// unfair bevorteilen.
export function engagement(post) {
  return Number(post.likes || 0) + Number(post.kommentare || 0)
       + Number(post.saves || 0) + Number(post.shares || 0);
}

export function engagementRate(post, follower) {
  if (!follower || follower <= 0) return null;
  return Math.round((engagement(post) / follower) * 1000) / 10;
}

const SORTIERUNG = {
  datum:      (a, b) => zuMs(b.veroeffentlichtAm) - zuMs(a.veroeffentlichtAm),
  likes:      (a, b) => Number(b.likes || 0) - Number(a.likes || 0),
  reichweite: (a, b) => Number(b.reichweite || 0) - Number(a.reichweite || 0),
  views:      (a, b) => Number(b.views || 0) - Number(a.views || 0),
  engagement: (a, b) => engagement(b) - engagement(a)
};

export function postsSortiert(posts, feld = "datum") {
  return [...(posts || [])].sort(SORTIERUNG[feld] || SORTIERUNG.datum);
}

// Verknuepft Posts mit den eigenen Videos ueber `videoId`. Ergaenzt jeden
// Post um `video` (das Objekt oder null) — die Basis dafuer, im Portal
// „dieser Post ist eins meiner Videos" anzuzeigen.
export function postsMitVideo(posts, videos) {
  const nachId = new Map((videos || []).map((v) => [v.id, v]));
  return (posts || []).map((p) => ({
    ...p,
    video: p.videoId ? (nachId.get(p.videoId) || null) : null
  }));
}

// Kennzahlen ueber eine Postmenge — getrennt nach „von mir" und „selbst
// gepostet". Genau der Vergleich, den ein Kunde sehen will.
export function postKennzahlen(posts, follower) {
  const roh = posts || [];
  const teil = (liste) => {
    if (!liste.length) return null;
    const summe = (f) => liste.reduce((s, p) => s + Number(p[f] || 0), 0);
    const eng = liste.reduce((s, p) => s + engagement(p), 0);
    return {
      anzahl: liste.length,
      likes: summe("likes"),
      kommentare: summe("kommentare"),
      reichweite: summe("reichweite"),
      views: summe("views"),
      schnittLikes: Math.round(summe("likes") / liste.length),
      schnittReichweite: Math.round(summe("reichweite") / liste.length),
      schnittEngagement: Math.round((eng / liste.length) * 10) / 10,
      rate: follower > 0 ? Math.round((eng / liste.length / follower) * 1000) / 10 : null
    };
  };
  return {
    gesamt: teil(roh),
    mitVideo: teil(roh.filter((p) => p.videoId)),
    ohneVideo: teil(roh.filter((p) => !p.videoId))
  };
}

// --- Kleinkram ---------------------------------------------------------
// Firestore-Timestamp | Date | ms → Date. db.js liefert je nach Feld beides.
export function zuDate(w) {
  if (!w) return null;
  if (typeof w.toDate === "function") return w.toDate();
  if (w instanceof Date) return w;
  const d = new Date(w);
  return isNaN(d.getTime()) ? null : d;
}

function zuMs(w) {
  const d = zuDate(w);
  return d ? d.getTime() : 0;
}

// Kompakte Zahl fuer enge Kacheln: 1234 → "1.234", 12345 → "12,3 Tsd."
export function zahlKurz(n) {
  const z = Number(n || 0);
  if (Math.abs(z) < 10000) return z.toLocaleString("de-DE");
  if (Math.abs(z) < 1000000) return (Math.round(z / 100) / 10).toLocaleString("de-DE") + " Tsd.";
  return (Math.round(z / 100000) / 10).toLocaleString("de-DE") + " Mio.";
}

// Vorzeichenbehaftet, fuer Zuwaechse.
export function zahlMitVorzeichen(n) {
  const z = Number(n || 0);
  return (z > 0 ? "+" : "") + z.toLocaleString("de-DE");
}
