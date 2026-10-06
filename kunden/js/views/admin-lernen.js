// Admin-View: Lernen — Videografie-Lernstand (ersetzt den alten „Kurs“,
// Vale 06.10.2026). Rein privat (Rolle admin).
//
// Gleiche Bauweise wie admin-roadmap.js:
//   Inhalte  -> js/videografie-data.js   (Lehrplan, Texte)
//   Rechnen  -> js/videografie-logik.js  (ohne Firebase, prüfbar)
//   Hier     -> nur Darstellung.
//
// Die View LIEST NUR. Den Lernstand schreibt Claude (Skill
// „videografie-lernen“ bzw. jede Session, in der Fortschritt passiert) mit
// tools/lernstand.mjs in vale-video/lernen/lernstand.json; das Social-Brain-
// Cockpit überträgt die Datei nach Firestore roadmap/videografie. Hier hört
// ein Live-Listener mit — neue Einträge erscheinen ohne Neuladen.
import { beobachteLernstand } from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { LEHRPLAN, EQUIPMENT, START_SATZ } from "../videografie-data.js";
import { alleThemen, statusVon, fortschritt, modulFortschritt, aktuellesThema,
         naechstesThema, offeneUebung, videosZuThema, zahlen, ytBild, verlauf,
         aktivitaetsRaster, tageSeitLetztem, themaInfo } from "../videografie-logik.js";
import { escapeHtml } from "../util.js";

const STATUS_TEXT = { offen: "offen", in_arbeit: "in Arbeit", erledigt: "erledigt" };
const ART_ICON = { log: "•", quiz: "?", uebung: "◎", "uebung-fertig": "✓", video: "▶", praxis: "★", thema: "✓" };

// Nur http(s)-Links ausgeben — alles andere wird zu „#“.
const sichereUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : "#");

function datumKurz(tag) {
  if (!tag) return "";
  const [y, m, d] = tag.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("de-DE", { day: "numeric", month: "short" });
}

function zeitpunkt(wert) {
  const d = wert && typeof wert.toDate === "function" ? wert.toDate() : wert ? new Date(wert) : null;
  if (!d || isNaN(d)) return null;
  const heute = new Date();
  const gestern = new Date(); gestern.setDate(heute.getDate() - 1);
  const uhr = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === heute.toDateString()) return `heute, ${uhr}`;
  if (d.toDateString() === gestern.toDateString()) return `gestern, ${uhr}`;
  return `${d.toLocaleDateString("de-DE", { day: "numeric", month: "short" })}, ${uhr}`;
}

export function renderAdminLernen(container) {
  let stand = null;          // Firestore-Dokument (oder null, solange keins da ist)
  let geladen = false;
  let gewaehlt = null;       // im Lernpfad angetipptes Thema (nur zur Laufzeit)

  container.innerHTML = `
    <div class="admin-head lv-kopf">
      <div>
        <h1 class="view-title" style="margin:0">Lernen</h1>
        <p class="lv-unter">Videografie: Licht, Komposition, Kamera, Bewegung, Farbe</p>
      </div>
      <div class="lv-sync" id="lvSync"></div>
    </div>
    <div id="lvBody" class="rm-laedt">Lade Lernstand …</div>`;

  const body = container.querySelector("#lvBody");
  const syncEl = container.querySelector("#lvSync");

  // --- Kopf rechts: woher der Stand kommt --------------------------------
  function htmlSync() {
    if (!geladen) return "";
    if (!stand) return `<span class="lv-sync-punkt is-aus"></span>Noch nichts eingetragen`;
    const wann = zeitpunkt(stand.aktualisiert);
    return `<span class="lv-sync-punkt"></span>Von Claude eingetragen${wann ? ` · ${escapeHtml(wann)}` : ""}`;
  }

  // --- 1. Jetzt dran: Thema, Übung, Video --------------------------------
  function htmlVideoKarte(v, gross) {
    const bild = ytBild(v.url);
    const meta = [v.kanal, v.laenge].filter(Boolean).map(escapeHtml).join(" · ");
    if (!gross) {
      return `
        <a class="lv-alt" href="${escapeHtml(sichereUrl(v.url))}" target="_blank" rel="noopener">
          <span class="lv-alt-bild">${bild ? `<img src="${escapeHtml(bild)}" alt="" loading="lazy" />` : ""}</span>
          <span class="lv-alt-text"><strong>${escapeHtml(v.titel || "Video")}</strong><span>${meta}</span></span>
        </a>`;
    }
    return `
      <a class="lv-video" href="${escapeHtml(sichereUrl(v.url))}" target="_blank" rel="noopener">
        <span class="lv-video-bild">
          ${bild ? `<img src="${escapeHtml(bild)}" alt="" loading="lazy" />` : ""}
          <span class="lv-play" aria-hidden="true"></span>
          ${v.gesehen ? `<span class="lv-video-badge">gesehen${v.bewertung ? ` · ${"★".repeat(v.bewertung)}` : ""}</span>` : ""}
        </span>
        <span class="lv-video-titel">${escapeHtml(v.titel || "Video")}</span>
        <span class="lv-video-meta">${meta}</span>
      </a>
      ${v.warum ? `<p class="lv-video-warum">${escapeHtml(v.warum)}</p>` : ""}`;
  }

  function htmlListe(titel, punkte, klasse) {
    if (!punkte || !punkte.length) return "";
    return `
      <div class="lv-ue-teil ${klasse || ""}">
        <p class="lv-mini">${escapeHtml(titel)}</p>
        <ul>${punkte.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>
      </div>`;
  }

  function htmlJetzt() {
    const t = aktuellesThema(stand);
    if (!t) {
      return `
        <section class="card lv-jetzt lv-jetzt--fertig">
          <p class="lv-eyebrow">Lehrplan durch</p>
          <h2 class="lv-thema">Alle ${alleThemen().length} Themen erledigt.</h2>
          <p class="lv-kannst">Sag Claude, welches Thema du vertiefen willst.</p>
        </section>`;
    }
    const uebung = offeneUebung(stand);
    const videos = videosZuThema(stand, t.id);
    const haupt = videos.find((v) => v.rolle === "haupt") || videos[0];
    const alternativen = videos.filter((v) => v !== haupt).slice(0, 2);
    const nach = naechstesThema(stand);

    const uebungHtml = uebung ? `
      <div class="lv-uebung">
        <div class="lv-uebung-kopf">
          <p class="lv-mini">Deine Übung${uebung.dauer ? ` · ${escapeHtml(uebung.dauer)}` : ""}</p>
          <span class="lv-pille">seit ${escapeHtml(datumKurz(uebung.gegeben_am))}</span>
        </div>
        <h3 class="lv-uebung-titel">${escapeHtml(uebung.titel)}</h3>
        <div class="lv-ue-grid">
          ${htmlListe("Aufbauen", uebung.aufbau)}
          ${htmlListe("Filmen", uebung.filmen)}
        </div>
        <div class="lv-fertig">
          <p class="lv-mini">Fertig, wenn</p>
          <ul>${(uebung.fertig_wenn || []).map((k) => `<li>${escapeHtml(k)}</li>`).join("")}</ul>
        </div>
        ${uebung.immobilien ? `<p class="lv-immo"><span>Für Immobilien</span>${escapeHtml(uebung.immobilien)}</p>` : ""}
        <p class="lv-equip">${EQUIPMENT.map((e) => `<span>${escapeHtml(e)}</span>`).join("")}</p>
      </div>` : `
      <div class="lv-uebung lv-uebung--leer">
        <p class="lv-mini">Übung</p>
        <p>Noch keine offene Übung. Starte die nächste Lerneinheit mit Claude — Video und Übung landen dann hier.</p>
      </div>`;

    return `
      <section class="card lv-jetzt">
        <div class="lv-jetzt-links">
          <p class="lv-eyebrow">Jetzt dran · Modul ${escapeHtml(t.modul.id)} ${escapeHtml(t.modul.name)}</p>
          <h2 class="lv-thema"><span class="lv-thema-nr">${escapeHtml(t.id)}</span>${escapeHtml(t.titel)}</h2>
          <p class="lv-kannst">${escapeHtml(t.kannst)}</p>
          ${uebungHtml}
        </div>
        <div class="lv-jetzt-rechts">
          ${haupt ? `<p class="lv-mini">Video dazu</p>${htmlVideoKarte(haupt, true)}` : `
            <div class="lv-video-leer"><p class="lv-mini">Video dazu</p><p>Claude sucht es dir bei der nächsten Lerneinheit raus.</p></div>`}
          ${alternativen.length ? `<p class="lv-mini lv-mini--abstand">Alternativen</p>${alternativen.map((v) => htmlVideoKarte(v, false)).join("")}` : ""}
          ${nach ? `<p class="lv-danach">Danach: <strong>${escapeHtml(nach.id)} ${escapeHtml(nach.titel)}</strong></p>` : ""}
        </div>
        <div class="lv-start">
          <p>Übung gemacht oder Lust auf die nächste Einheit? Sag Claude einfach:</p>
          <button type="button" class="lv-satz" data-kopieren="${escapeHtml(START_SATZ)}" title="Satz kopieren">
            „${escapeHtml(START_SATZ)}“<span class="lv-satz-hinweis">kopieren</span>
          </button>
        </div>
      </section>`;
  }

  // --- 2. Fortschritt: Ring, Zähler, Lern-Kalender -----------------------
  function htmlFortschritt() {
    const f = fortschritt(stand);
    const z = zahlen(stand);
    const tage = tageSeitLetztem(stand);
    const r = 46, u = 2 * Math.PI * r;
    const anteilErl = f.gesamt ? f.erledigt / f.gesamt : 0;
    const anteilArb = f.gesamt ? f.inArbeit / f.gesamt : 0;
    const raster = aktivitaetsRaster(stand, new Date(), 12);
    const stufe = (n) => (n <= 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : 3);
    const letzte = tage == null ? "–" : tage === 0 ? "heute" : tage === 1 ? "gestern" : `vor ${tage} T.`;

    return `
      <section class="card card--pad lv-stand">
        <div class="lv-ring">
          <svg viewBox="0 0 120 120" role="img" aria-label="${f.prozent} Prozent des Lehrplans erledigt">
            <circle cx="60" cy="60" r="${r}" class="lv-ring-bahn" />
            <circle cx="60" cy="60" r="${r}" class="lv-ring-arbeit"
              stroke-dasharray="${(anteilErl + anteilArb) * u} ${u}" transform="rotate(-90 60 60)" />
            <circle cx="60" cy="60" r="${r}" class="lv-ring-fill"
              stroke-dasharray="${anteilErl * u} ${u}" transform="rotate(-90 60 60)" />
          </svg>
          <div class="lv-ring-text"><strong>${f.prozent} %</strong><span>${f.erledigt} von ${f.gesamt} Themen</span></div>
        </div>
        <div class="lv-stand-rechts">
          <div class="rm-zaehler lv-zaehler">
            <div><span class="rm-zahl rm-zahl--akzent">${z.uebungenErledigt}</span><span class="rm-zahl-lbl">Übungen erledigt</span></div>
            <div><span class="rm-zahl">${z.videosGesamt}</span><span class="rm-zahl-lbl">Videos empfohlen</span></div>
            <div><span class="rm-zahl">${z.quizQuote == null ? "–" : `${z.quizQuote} %`}</span><span class="rm-zahl-lbl">Abfragen richtig</span></div>
            <div><span class="rm-zahl">${z.praxis}</span><span class="rm-zahl-lbl">Praxis in echten Videos</span></div>
            <div><span class="rm-zahl">${letzte}</span><span class="rm-zahl-lbl">letzte Einheit</span></div>
          </div>
          <div class="lv-kal">
            <p class="lv-mini">Lern-Kalender · letzte 12 Wochen</p>
            <div class="lv-kal-raster">
              ${raster.map((w) => `<div class="lv-kal-woche">${w.map((d) =>
                `<span class="lv-kal-tag s${d.zukunft ? "x" : stufe(d.anzahl)}" title="${escapeHtml(datumKurz(d.tag))}${d.anzahl ? ` · ${d.anzahl} Einträge` : ""}"></span>`
              ).join("")}</div>`).join("")}
            </div>
          </div>
        </div>
      </section>`;
  }

  // --- 3. Lernpfad: alle Module als Stationen ----------------------------
  function htmlDetail(id) {
    const t = themaInfo(id);
    if (!t) return "";
    const s = statusVon(stand, id);
    const info = (stand && stand.themen && stand.themen[id]) || {};
    const videos = videosZuThema(stand, id);
    const praxis = ((stand && stand.praxis) || []).filter((p) => (p.themen || []).includes(id));
    const daten = [info.seit ? `begonnen ${datumKurz(info.seit)}` : "", info.erledigt_am ? `erledigt ${datumKurz(info.erledigt_am)}` : ""].filter(Boolean).join(" · ");
    return `
      <div class="lv-detail">
        <div class="lv-detail-kopf">
          <strong>${escapeHtml(t.id)} ${escapeHtml(t.titel)}</strong>
          <span class="lv-status lv-status--${s}">${STATUS_TEXT[s]}</span>
        </div>
        <p>${escapeHtml(t.kannst)}</p>
        ${daten ? `<p class="lv-detail-daten">${escapeHtml(daten)}</p>` : ""}
        ${videos.length ? `<div class="lv-detail-videos">${videos.map((v) => htmlVideoKarte(v, false)).join("")}</div>` : ""}
        ${praxis.length ? `<p class="lv-detail-daten">Angewendet in: ${praxis.map((p) => escapeHtml(p.titel)).join(", ")}</p>` : ""}
      </div>`;
  }

  function htmlPfad() {
    const cur = aktuellesThema(stand);
    return `
      <section class="lv-block">
        <p class="rm-label rm-label--frei">Lernpfad</p>
        <div class="card lv-pfad">
          ${LEHRPLAN.map((m) => {
            const [n, g] = modulFortschritt(stand, m);
            const offenHier = gewaehlt && m.themen.some(([id]) => id === gewaehlt);
            return `
              <div class="lv-modul ${cur && cur.modul.id === m.id ? "is-aktuell" : ""}">
                <div class="lv-modul-kopf">
                  <span class="lv-modul-name">${escapeHtml(m.id)} · ${escapeHtml(m.name)}${m.hinweis ? `<em>${escapeHtml(m.hinweis)}</em>` : ""}</span>
                  <span class="lv-modul-prog">${n}/${g}</span>
                </div>
                <div class="lv-stationen">
                  ${m.themen.map(([id, titel]) => {
                    const s = statusVon(stand, id);
                    const jetzt = cur && cur.id === id;
                    return `
                      <button type="button" class="lv-station lv-station--${s} ${jetzt ? "is-jetzt" : ""} ${gewaehlt === id ? "is-gewaehlt" : ""}"
                              data-thema="${escapeHtml(id)}" aria-pressed="${gewaehlt === id}">
                        <span class="lv-punkt">${s === "erledigt" ? "✓" : escapeHtml(id.split(".")[1])}</span>
                        <span class="lv-station-titel">${escapeHtml(titel)}</span>
                      </button>`;
                  }).join("")}
                </div>
                ${offenHier ? htmlDetail(gewaehlt) : ""}
              </div>`;
          }).join("")}
          <p class="lv-legende">
            <span><i class="lv-l lv-l--erledigt"></i>erledigt</span>
            <span><i class="lv-l lv-l--in_arbeit"></i>in Arbeit</span>
            <span><i class="lv-l lv-l--offen"></i>offen</span>
            <span class="muted">Station antippen für Details</span>
          </p>
        </div>
      </section>`;
  }

  // --- 4. Schwachstellen + Praxis ----------------------------------------
  function htmlZweier() {
    const sw = ((stand && stand.schwachstellen) || []).filter((s) => !s.erledigt_am);
    const sitzt = ((stand && stand.schwachstellen) || []).filter((s) => s.erledigt_am);
    const praxis = [...((stand && stand.praxis) || [])].reverse();
    return `
      <div class="lv-zweier">
        <section class="card card--pad">
          <p class="rm-label">Wiederholen</p>
          ${sw.length ? `<ul class="lv-schwach">${sw.map((s) => `
            <li><span>${escapeHtml(s.text)}</span>${s.thema ? `<em>${escapeHtml(s.thema)}</em>` : ""}</li>`).join("")}</ul>`
            : `<p class="lv-leer">Nichts offen. Was in einer Abfrage danebengeht, landet hier und kommt später wieder dran.</p>`}
          ${sitzt.length ? `<p class="lv-sitzt">${sitzt.length} Schwachstelle${sitzt.length === 1 ? "" : "n"} sitzt jetzt</p>` : ""}
        </section>
        <section class="card card--pad">
          <p class="rm-label">Praxis in echten Videos</p>
          ${praxis.length ? `<ul class="lv-praxis">${praxis.slice(0, 6).map((p) => `
            <li>
              <span class="lv-praxis-datum">${escapeHtml(datumKurz(p.datum))}</span>
              <span class="lv-praxis-text"><strong>${escapeHtml(p.titel)}</strong>${p.kunde ? ` · ${escapeHtml(p.kunde)}` : ""}
                ${(p.themen || []).length ? `<span class="lv-tags">${p.themen.map((id) => {
                  const t = themaInfo(id); return `<span title="${escapeHtml(t ? t.titel : id)}">${escapeHtml(id)}</span>`;
                }).join("")}</span>` : ""}
                ${p.notiz ? `<span class="lv-praxis-notiz">${escapeHtml(p.notiz)}</span>` : ""}
              </span>
            </li>`).join("")}</ul>`
            : `<p class="lv-leer">Sobald du ein Video drehst oder schneidest, in dem du Gelerntes anwendest, trägt Claude es hier ein.</p>`}
        </section>
      </div>`;
  }

  // --- 5. Verlauf + Videothek --------------------------------------------
  function htmlVerlauf() {
    const ev = verlauf(stand).slice(0, 14);
    if (!ev.length) return "";
    return `
      <section class="lv-block">
        <p class="rm-label rm-label--frei">Verlauf</p>
        <ol class="card lv-verlauf">
          ${ev.map((e) => `
            <li class="lv-ev lv-ev--${e.art}">
              <span class="lv-ev-icon" aria-hidden="true">${ART_ICON[e.art] || "•"}</span>
              <span class="lv-ev-text">${escapeHtml(e.text)}</span>
              <span class="lv-ev-tag">${escapeHtml(datumKurz(e.tag))}</span>
            </li>`).join("")}
        </ol>
      </section>`;
  }

  function htmlVideothek() {
    const videos = [...((stand && stand.videos) || [])].reverse();
    if (videos.length < 2) return "";
    return `
      <section class="lv-block">
        <p class="rm-label rm-label--frei">Alle Videos (${videos.length})</p>
        <div class="lv-thek">
          ${videos.map((v) => {
            const bild = ytBild(v.url);
            return `
              <a class="card lv-thek-karte" href="${escapeHtml(sichereUrl(v.url))}" target="_blank" rel="noopener">
                <span class="lv-thek-bild">${bild ? `<img src="${escapeHtml(bild)}" alt="" loading="lazy" />` : ""}
                  <span class="lv-thek-nr">${escapeHtml(v.thema || "")}</span></span>
                <span class="lv-thek-titel">${escapeHtml(v.titel || "Video")}</span>
                <span class="lv-thek-meta">${[v.kanal, v.gesehen ? "gesehen" : v.rolle === "alternative" ? "Alternative" : ""].filter(Boolean).map(escapeHtml).join(" · ")}</span>
              </a>`;
          }).join("")}
        </div>
      </section>`;
  }

  function zeichne() {
    syncEl.innerHTML = htmlSync();
    if (!geladen) return;
    body.classList.remove("rm-laedt");
    body.innerHTML = `
      ${!stand ? `<p class="notice lv-hinweis">Noch kein Lernstand. Sag Claude „${escapeHtml(START_SATZ)}“ — die erste Einheit landet automatisch hier.</p>` : ""}
      ${htmlJetzt()}
      ${htmlFortschritt()}
      ${htmlPfad()}
      ${htmlZweier()}
      ${htmlVerlauf()}
      ${htmlVideothek()}`;
  }

  // --- Ereignisse (nur Anzeige: Station wählen, Satz kopieren) -----------
  body.addEventListener("click", async (ev) => {
    const station = ev.target.closest("[data-thema]");
    if (station) {
      const id = station.dataset.thema;
      gewaehlt = gewaehlt === id ? null : id;
      zeichne();
      return;
    }
    const kopie = ev.target.closest("[data-kopieren]");
    if (kopie) {
      const hinweis = kopie.querySelector(".lv-satz-hinweis");
      try {
        await navigator.clipboard.writeText(kopie.dataset.kopieren);
        if (hinweis) hinweis.textContent = "kopiert";
      } catch {
        if (hinweis) hinweis.textContent = "markieren und kopieren";
      }
      setTimeout(() => { if (hinweis) hinweis.textContent = "kopieren"; }, 1800);
    }
  });

  // --- Live-Listener -------------------------------------------------------
  const stop = beobachteLernstand((daten) => {
    stand = daten;
    geladen = true;
    zeichne();
  }, (e) => {
    console.error("[Lernen] Laden fehlgeschlagen:", e && e.code, e && e.message);
    geladen = true;
    body.classList.remove("rm-laedt");
    body.innerHTML = `<p class="rm-fehler">Lernstand konnte nicht geladen werden (${escapeHtml(String(e && (e.code || e.message) || e))}).</p>`;
  });
  beiViewWechsel(stop);
}
