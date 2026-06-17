// =====================================================================
// EmailJS (clientseitig) — Benachrichtigungen in beide Richtungen.
// Ohne Cloud Functions ist das der etablierte Weg für Mails aus einer
// statischen Seite.
//
// >>> VON VALENTIN AUSZUFÜLLEN (EmailJS-Console, kostenloses Konto) <<<
//   1. EmailJS → Email Services → Gmail verbinden → Service-ID
//   2. EmailJS → Email Templates → 2 Templates anlegen → Template-IDs
//   3. EmailJS → Account → General → Public Key
// Solange die Felder leer sind, ist der Mailversand still deaktiviert —
// das Portal funktioniert vollständig, es werden nur keine Mails verschickt.
// =====================================================================
import { KUNDE_EMAILS, ADMIN_EMAILS } from "./roles.js";

const EMAILJS_PUBLIC_KEY          = "j7Fw6cZEjayCp1U6q";
const EMAILJS_SERVICE_ID          = "service_yure4pa";
const TEMPLATE_ADMIN_NEUES_OBJEKT = "admin_neues_objekt";
const TEMPLATE_KUNDE_FREIGABE     = "kunde_freigabe";

const ADMIN_EMAIL  = ADMIN_EMAILS[0] || "karlowskivalentin@gmail.com";
const PORTAL_URL   = "https://vale-video.de/kunden/";
const EMAILJS_CDN  = "https://esm.run/@emailjs/browser@4";

let _emailjs = null;
let _initDone = false;

export function emailKonfiguriert() {
  return Boolean(EMAILJS_PUBLIC_KEY && EMAILJS_SERVICE_ID);
}

async function ladeEmailjs() {
  if (!EMAILJS_PUBLIC_KEY) return null;          // nicht konfiguriert → still aus
  if (_emailjs) return _emailjs;
  const mod = await import(/* @vite-ignore */ EMAILJS_CDN);
  _emailjs = mod.default || mod;
  if (!_initDone) {
    _emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
    _initDone = true;
  }
  return _emailjs;
}

// Mail an Admin (Valentin) bei neuer Objekt-Meldung. Fire-and-forget.
export async function sendAdminNeuesObjekt({ adresse, objektTyp, beschreibung, link, gemeldetVon }) {
  try {
    const ej = await ladeEmailjs();
    if (!ej || !TEMPLATE_ADMIN_NEUES_OBJEKT) return false;
    await ej.send(EMAILJS_SERVICE_ID, TEMPLATE_ADMIN_NEUES_OBJEKT, {
      to_email:     ADMIN_EMAIL,
      adresse:      adresse || "—",
      objekt_typ:   objektTyp || "—",
      beschreibung: beschreibung || "—",
      link:         link || "—",
      gemeldet_von: gemeldetVon || "—",
      portal_link:  PORTAL_URL
    });
    return true;
  } catch (e) {
    console.warn("EmailJS (Admin-Benachrichtigung) fehlgeschlagen:", e);
    return false;
  }
}

// Mail an die Kunden, sobald ein Video eine Freigabe-Stufe erreicht.
//   art: "Skript" | "Schnitt"
export async function sendKundeFreigabe({ titel, art, videoId }) {
  try {
    const ej = await ladeEmailjs();
    if (!ej || !TEMPLATE_KUNDE_FREIGABE) return false;
    const portalLink = videoId ? `${PORTAL_URL}#/video/${videoId}` : PORTAL_URL;
    // An alle freigeschalteten Kunden-Adressen einzeln senden.
    await Promise.all(
      KUNDE_EMAILS.map((adresse) =>
        ej.send(EMAILJS_SERVICE_ID, TEMPLATE_KUNDE_FREIGABE, {
          to_email:    adresse,
          titel:       titel || "Dein Video",
          art:         art || "Freigabe",
          portal_link: portalLink
        })
      )
    );
    return true;
  } catch (e) {
    console.warn("EmailJS (Kunden-Benachrichtigung) fehlgeschlagen:", e);
    return false;
  }
}
