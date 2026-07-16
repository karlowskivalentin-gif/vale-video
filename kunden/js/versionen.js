// Gemeinsame Logik hinter „Neuen Entwurf an Kunden geben" / „🔁 Neue Version"
// (genutzt von Pipeline UND Video-Edit — keine Duplizierung):
//   • Entwurfsnummer +1
//   • Sprung auf die passende Freigabe-Stufe (Skript, sonst Schnitt;
//     Cinematic/wortlose Formate ohne Skript springen direkt auf Schnitt-Freigabe)
//   • kundensichtbaren planSnapshot aus dem Herkunfts-Plan aktualisieren
// Der Aufrufer (View) übernimmt Bestätigung, EmailJS, Kunden-News und UI-Feedback.
import { aktualisiereVideo, ladePlan } from "./db.js";
import { planZuSnapshot } from "./plan-ansicht.js";
import { STATUS, skriptFreigabeNoetig } from "./status.js";

export async function videoNeuerEntwurf(video) {
  // Noch im Skript-Loop (Skript nötig, noch nicht freigegeben) → Skript-Freigabe,
  // sonst Schnitt-Freigabe.
  const zielStufe = (!video.freigabeSkript && skriptFreigabeNoetig(video.typ))
    ? STATUS.FREIGABE_SKRIPT : STATUS.FREIGABE_SCHNITT;
  const artLabel = zielStufe === STATUS.FREIGABE_SKRIPT ? "Skript" : "Schnitt";
  const naechste = (video.entwurf || 1) + 1;

  const felder = { status: zielStufe, entwurf: naechste };
  // Aktuellen Plan-Stand (Inspirationen, Dateien, Shotlist …) als Snapshot mitgeben.
  if (video.planId) {
    try { const plan = await ladePlan(video.planId); if (plan) felder.planSnapshot = planZuSnapshot(plan); }
    catch (_) { /* Snapshot best-effort */ }
  }
  await aktualisiereVideo(video.id, felder);
  return { entwurf: naechste, status: zielStufe, artLabel };
}
