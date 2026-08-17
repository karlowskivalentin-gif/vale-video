// Admin-View: Springseil — HIIT-Intervall-Timer + Trainingshistorie. Rein
// privat (Rolle admin), keine Kundenberührung.
//
// Drei Teile in einer View:
//   1. SETUP     — Voreinstellungen, Intervalle, Übungen, Gewicht. Die zuletzt
//                  benutzten Werte liegen in `trainingKonfig/springseil`, damit
//                  Handy und Rechner denselben Stand haben.
//   2. TIMER     — Vollbild-Overlay mit Phasenfarben, Countdown-Pieptönen und
//                  Screen-Wake-Lock (sonst sperrt das Handy mitten im Satz).
//   3. HISTORIE  — jede beendete Einheit wird in `training` gespeichert; darüber
//                  Streak, Wochen-/Gesamtzahlen und eine Heatmap der letzten
//                  12 Wochen ("wie oft und wann").
//
// Der Timer läuft NICHT über requestAnimationFrame, sondern über ein Intervall
// mit Zeitmessung an der echten Uhr: RAF wird im Hintergrund-Tab auf null
// gedrosselt, ein Trainingstimer darf aber nicht stehenbleiben.
import { speichereTraining, beobachteTrainings, loescheTraining,
         ladeTrainingKonfig, speichereTrainingKonfig } from "../db.js";
import { beiViewWechsel } from "../view-lifecycle.js";
import { escapeHtml } from "../util.js";

const ART = "springseil";

// MET-Werte je Phase — Grundlage der Kalorienschätzung (kcal/min = MET·3,5·kg/200).
const MET = { warmup: 6, work: 12, rest: 8, long: 4, cooldown: 5 };

const STANDARD = {
  warmup: 300, work: 40, rest: 20, rounds: 35,
  longOn: true, longEvery: 7, longDur: 50,
  cooldown: 300, weight: 68,
  exercises: ["High Knees", "Speed Steps", "Double Unders", "Boxer Step"]
};

const PRESETS = [
  { id: "vale",    n: "Vale 40/20",    d: "40s hart · 20s aktiv · 35×", s: { warmup: 300, work: 40,  rest: 20, rounds: 35, longOn: true,  longEvery: 7, longDur: 50, cooldown: 300 } },
  { id: "fivemin", n: "5-Min Blöcke",  d: "5 Min · 20s Pause · 4×",     s: { warmup: 180, work: 300, rest: 20, rounds: 4,  longOn: false, longEvery: 7, longDur: 50, cooldown: 180 } },
  { id: "burn",    n: "Max Burn",      d: "40s · 15s · 35×",            s: { warmup: 240, work: 40,  rest: 15, rounds: 35, longOn: true,  longEvery: 7, longDur: 45, cooldown: 240 } },
  { id: "endur",   n: "Durchhalten",   d: "30s · 30s · 40×",            s: { warmup: 300, work: 30,  rest: 30, rounds: 40, longOn: true,  longEvery: 8, longDur: 60, cooldown: 300 } },
  { id: "tabata",  n: "Tabata",        d: "20s · 10s · 8×",             s: { warmup: 120, work: 20,  rest: 10, rounds: 8,  longOn: false, longEvery: 7, longDur: 50, cooldown: 120 } },
  { id: "begin",   n: "Einsteiger",    d: "20s · 40s · 20×",            s: { warmup: 180, work: 20,  rest: 40, rounds: 20, longOn: true,  longEvery: 5, longDur: 60, cooldown: 180 } },
  { id: "quick",   n: "Quick 15",      d: "30s · 20s · 15×",            s: { warmup: 120, work: 30,  rest: 20, rounds: 15, longOn: false, longEvery: 7, longDur: 50, cooldown: 120 } }
];

const PHASEN_FARBE = { warmup: "#ffb443", work: "#ff4d3d", rest: "#2ee6a6", long: "#3da5ff", cooldown: "#9b8cff" };

const mmss = (s) => {
  s = Math.max(0, Math.round(s));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
};
const stundenKurz = (sek) => {
  const m = Math.round(sek / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};
// Lokaler Tagesschlüssel — NICHT über toISOString(), das rechnet auf UTC um und
// verschiebt abendliche Einheiten auf den Folgetag.
const tagKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Dunkler Verlaufspartner zur Phasenfarbe.
function dunkler(hex, amt) {
  const h = hex.replace("#", "");
  const teil = (i) => Math.max(0, Math.min(255, parseInt(h.substr(i, 2), 16) + amt));
  return `rgb(${teil(0)},${teil(2)},${teil(4)})`;
}

// kcal/min = MET · 3,5 · kg / 200 — für eine Phasendauer in Sekunden.
const kcalFuer = (typ, sek, gewicht) => sek * MET[typ] * 3.5 * gewicht / 200 / 60;

// Ablaufplan aus den Einstellungen. Reine Funktion, damit sie prüfbar ist:
// Aufwärmen · (Belastung · Pause)×n · Cooldown, wobei jede longEvery-te Pause
// die lange ist und nach der LETZTEN Belastung keine Pause mehr kommt.
export function baueSequenz(S) {
  const seq = [];
  const rein = (typ, label, dur, extra) => seq.push({ type: typ, label, dur, farbe: PHASEN_FARBE[typ], ...extra });
  if (S.warmup > 0) rein("warmup", "AUFWÄRMEN", S.warmup);
  for (let r = 1; r <= S.rounds; r++) {
    rein("work", "BELASTUNG", S.work, { ex: S.exercises[(r - 1) % S.exercises.length], round: r });
    if (r === S.rounds) continue;
    if (S.longOn && r % S.longEvery === 0) rein("long", "LANGE PAUSE", S.longDur);
    else if (S.rest > 0)                   rein("rest", "PAUSE", S.rest);
  }
  if (S.cooldown > 0) rein("cooldown", "COOLDOWN", S.cooldown);
  return seq;
}

/**
 * Kennzahlen aus der Historie. Reine Funktion (heute injizierbar → testbar).
 * Streak = aufeinanderfolgende Tage mit Einheit, ab heute zurück; war heute
 * noch nichts, zählt ab gestern (ein laufender Tag soll die Serie nicht kappen).
 */
export function auswertung(einheiten, heute = new Date()) {
  const tage = new Map();                     // tagKey → Sekunden
  einheiten.forEach((e) => {
    const k = e.tag || (e.erstelltAm && e.erstelltAm.toDate ? tagKey(e.erstelltAm.toDate()) : null);
    if (k) tage.set(k, (tage.get(k) || 0) + (e.dauerSek || 0));
  });

  let streak = 0;
  const lauf = new Date(heute);
  if (!tage.has(tagKey(lauf))) lauf.setDate(lauf.getDate() - 1);
  while (tage.has(tagKey(lauf))) { streak++; lauf.setDate(lauf.getDate() - 1); }

  const seit = (tageZurueck) => {
    const grenze = new Date(heute);
    grenze.setHours(0, 0, 0, 0);
    grenze.setDate(grenze.getDate() - tageZurueck);
    return einheiten.filter((e) => {
      const d = e.tag ? new Date(e.tag + "T12:00:00")
                      : (e.erstelltAm && e.erstelltAm.toDate ? e.erstelltAm.toDate() : null);
      return d && d >= grenze;
    });
  };

  const summe = (liste, feld) => liste.reduce((a, e) => a + (e[feld] || 0), 0);
  const woche = seit(6), monat = seit(29);

  return {
    streak, tage,
    wocheN: woche.length, wocheSek: summe(woche, "dauerSek"),
    monatN: monat.length, monatSek: summe(monat, "dauerSek"),
    gesamtN: einheiten.length, gesamtSek: summe(einheiten, "dauerSek"), gesamtKcal: summe(einheiten, "kcal")
  };
}

export function renderAdminSpringseil(container) {
  const S = { ...STANDARD, exercises: STANDARD.exercises.slice() };
  let aktivesPreset = "vale";
  let einheiten = [];
  let speicherTimer = null;

  container.innerHTML = `
    <div class="admin-head">
      <h1 class="view-title" style="margin:0">🪢 Springseil</h1>
      <span class="muted" id="sprStreakKopf" style="font-size:.85rem"></span>
    </div>
    <p class="muted view-intro">Intervall-Timer fürs Seilspringen — jede beendete Einheit landet automatisch in der Historie unten.</p>

    <div class="spr-tabs" role="tablist">
      <button class="spr-tab is-aktiv" id="sprTabTimer" type="button" role="tab" aria-selected="true">Timer</button>
      <button class="spr-tab" id="sprTabStats" type="button" role="tab" aria-selected="false">Statistik</button>
    </div>

    <section id="sprSetup">
      <div class="spr-label">Voreinstellungen</div>
      <div class="spr-presets" id="sprPresets"></div>

      <div class="spr-label">Intervalle</div>
      <div class="card spr-card" id="sprIntervalle"></div>

      <div class="spr-label">Lange Pause</div>
      <div class="card spr-card">
        <div class="spr-row">
          <div><div class="spr-lbl">Lange Pause aktiv</div><div class="spr-sub">Längere Erholung in festen Abständen</div></div>
          <button class="spr-toggle" id="sprLongToggle" type="button" role="switch" aria-checked="true"><span class="spr-knob"></span></button>
        </div>
        <div id="sprLongOpts"></div>
      </div>

      <div class="spr-label">Übungen <span class="muted" style="text-transform:none;letter-spacing:0">— rotieren pro Runde</span></div>
      <div class="spr-ex-list" id="sprExList"></div>
      <button class="spr-add" id="sprAddEx" type="button">+ Übung hinzufügen</button>

      <div class="spr-label">Kalorien</div>
      <div class="card spr-card">
        <div class="spr-row">
          <div><div class="spr-lbl">Körpergewicht</div><div class="spr-sub">Grundlage der Kalorienschätzung</div></div>
          <div class="spr-stepper">
            <button type="button" data-w="-1" aria-label="Gewicht runter">−</button>
            <span class="spr-val"><span id="sprWeight"></span> kg</span>
            <button type="button" data-w="1" aria-label="Gewicht hoch">+</button>
          </div>
        </div>
      </div>

      <div class="spr-summary">
        <div class="spr-stat"><div class="spr-n" id="sprSumTime">0:00</div><div class="spr-k">Gesamtdauer</div></div>
        <div class="spr-stat"><div class="spr-n" id="sprSumRounds">0</div><div class="spr-k">Runden</div></div>
        <div class="spr-stat"><div class="spr-n" id="sprSumKcal">0</div><div class="spr-k">≈ kcal</div></div>
      </div>

      <button class="spr-start" id="sprStart" type="button">▶ TRAINING STARTEN</button>
      <p class="muted" id="sprKonfigHinweis" style="text-align:center;font-size:.78rem;margin-top:.6rem"></p>
    </section>

    <section id="sprStats" hidden></section>

    <div class="spr-timer" id="sprTimer" hidden>
      <div class="spr-ts-top">
        <span class="spr-ts-round" id="sprRound"></span>
        <button class="spr-ts-close" id="sprClose" type="button" aria-label="Training beenden">✕</button>
      </div>
      <div class="spr-ts-mid" id="sprMid">
        <div class="spr-phase" id="sprPhase">BEREIT</div>
        <div class="spr-ex" id="sprEx"></div>
        <div class="spr-time" id="sprTime">0</div>
        <div class="spr-next" id="sprNext"></div>
        <div class="spr-bars" id="sprBars"></div>
        <div class="spr-ts-stats">
          <div><div class="spr-v" id="sprElapsed">0:00</div><div class="spr-k">Gesamt</div></div>
          <div><div class="spr-v" id="sprKcal">0</div><div class="spr-k">≈ kcal</div></div>
        </div>
      </div>
      <div class="spr-ts-bottom" id="sprBottom">
        <button class="spr-ctrl" id="sprSkip" type="button">SKIP ⏭</button>
        <button class="spr-ctrl spr-ctrl--main" id="sprPause" type="button">PAUSE ⏸</button>
      </div>
    </div>`;

  const el = (id) => container.querySelector("#" + id);

  // ---------- Aufbau der Einstellungs-UI ----------
  function stepperRow(lbl, sub, key, step, unit, min, max) {
    return `
      <div class="spr-row">
        <div><div class="spr-lbl">${lbl}</div><div class="spr-sub">${sub}</div></div>
        <div class="spr-stepper">
          <button type="button" data-k="${key}" data-s="-${step}" data-min="${min}" data-max="${max}" aria-label="${lbl} verringern">−</button>
          <span class="spr-val"><span id="sprV_${key}"></span>${unit}</span>
          <button type="button" data-k="${key}" data-s="${step}" data-min="${min}" data-max="${max}" aria-label="${lbl} erhöhen">+</button>
        </div>
      </div>`;
  }

  function bauePresets() {
    el("sprPresets").innerHTML = PRESETS.map((p) => `
      <button class="spr-preset" data-p="${p.id}" type="button">
        <span class="spr-pt">${escapeHtml(p.n)}</span>
        <span class="spr-ps">${escapeHtml(p.d)}</span>
      </button>`).join("");
    el("sprPresets").querySelectorAll(".spr-preset").forEach((b) => {
      b.addEventListener("click", () => {
        const p = PRESETS.find((x) => x.id === b.dataset.p);
        Object.assign(S, p.s);
        aktivesPreset = p.id;
        zeichneWerte();
        merkeKonfig();
      });
    });
  }

  function baueIntervalle() {
    el("sprIntervalle").innerHTML =
      stepperRow("Aufwärmen", "Lockeres Einspringen", "warmup", 30, "s", 0, 900) +
      stepperRow("Belastung", "Harte Phase", "work", 5, "s", 5, 300) +
      stepperRow("Pause", "Aktive Erholung", "rest", 5, "s", 0, 300) +
      stepperRow("Runden", "Anzahl Intervalle", "rounds", 1, "", 1, 99) +
      stepperRow("Cooldown", "Auslaufen", "cooldown", 30, "s", 0, 900);
    el("sprLongOpts").innerHTML =
      stepperRow("Alle … Runden", "Häufigkeit der langen Pause", "longEvery", 1, "", 2, 20) +
      stepperRow("Dauer", "Länge der langen Pause", "longDur", 5, "s", 10, 180);

    container.querySelectorAll(".spr-stepper button[data-k]").forEach((b) => {
      b.addEventListener("click", () => {
        const k = b.dataset.k;
        S[k] = Math.min(+b.dataset.max, Math.max(+b.dataset.min, S[k] + +b.dataset.s));
        aktivesPreset = "";          // eigene Werte → kein Preset mehr aktiv
        zeichneWerte();
        merkeKonfig();
      });
    });
  }

  function baueUebungen() {
    el("sprExList").innerHTML = S.exercises.map((e, i) => `
      <div class="spr-ex-item">
        <span class="spr-dot" aria-hidden="true"></span>
        <input type="text" value="${escapeHtml(e)}" data-i="${i}" aria-label="Übung ${i + 1}">
        <button class="spr-del" type="button" data-d="${i}" aria-label="Übung entfernen">×</button>
      </div>`).join("");
    el("sprExList").querySelectorAll("input").forEach((inp) => {
      inp.addEventListener("input", () => { S.exercises[+inp.dataset.i] = inp.value; merkeKonfig(); });
    });
    el("sprExList").querySelectorAll(".spr-del").forEach((b) => {
      b.addEventListener("click", () => {
        if (S.exercises.length > 1) {
          S.exercises.splice(+b.dataset.d, 1);
          baueUebungen();
          merkeKonfig();
        }
      });
    });
  }

  // ---------- Werte + Zusammenfassung ----------
  function zeichneWerte() {
    ["warmup", "work", "rest", "rounds", "cooldown", "longEvery", "longDur"].forEach((k) => {
      const e = el("sprV_" + k);
      if (e) e.textContent = S[k];
    });
    el("sprWeight").textContent = S.weight;

    const t = el("sprLongToggle");
    t.classList.toggle("is-an", S.longOn);
    t.setAttribute("aria-checked", String(S.longOn));
    el("sprLongOpts").style.display = S.longOn ? "block" : "none";

    container.querySelectorAll(".spr-preset").forEach((b) => {
      b.classList.toggle("is-aktiv", b.dataset.p === aktivesPreset);
    });

    const seq = baueSequenz(S);
    el("sprSumTime").textContent = mmss(seq.reduce((a, p) => a + p.dur, 0));
    el("sprSumRounds").textContent = S.rounds;
    el("sprSumKcal").textContent = Math.round(seq.reduce((a, p) => a + kcalFuer(p.type, p.dur, S.weight), 0));
  }

  // ---------- Töne ----------
  let actx = null;
  function piep(freq, dauer = 0.12, laut = 0.5) {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      o.connect(g); g.connect(actx.destination);
      g.gain.setValueAtTime(laut, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dauer);
      o.start(); o.stop(actx.currentTime + dauer);
    } catch (_) { /* ohne Ton weiter */ }
  }

  // ---------- Bildschirm wachhalten ----------
  let wakeLock = null;
  async function wakeAn() {
    try {
      if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
    } catch (_) { /* nicht unterstützt / abgelehnt — dann eben nicht */ }
  }
  function wakeAus() {
    try { if (wakeLock) wakeLock.release(); } catch (_) { /* egal */ }
    wakeLock = null;
  }

  // ---------- Timer ----------
  const T = { seq: [], idx: 0, left: 0, elapsed: 0, kcal: 0, laeuft: false, tick: null, last: 0, workPhasen: [], gespeichert: false };

  function starte() {
    piep(1, 0.01, 0.001);                       // Audio auf Nutzergeste freischalten
    if (actx && actx.state === "suspended") actx.resume();
    T.seq = baueSequenz(S);
    if (!T.seq.length) return;
    Object.assign(T, { idx: 0, elapsed: 0, kcal: 0, laeuft: true, gespeichert: false });
    T.workPhasen = T.seq.filter((p) => p.type === "work");

    el("sprSetup").hidden = true;
    el("sprStats").hidden = true;
    el("sprTimer").hidden = false;
    el("sprBottom").style.display = "flex";
    el("sprTimer").querySelector(".spr-ts-top").style.visibility = "visible";
    document.body.classList.add("spr-timer-offen");
    wakeAn();
    merkeKonfig(true);

    ladePhase(0, true);
    T.last = performance.now();
    T.tick = setInterval(schritt, 100);
  }

  function ladePhase(i, ansagen) {
    const p = T.seq[i];
    if (!p) return fertig(false);
    T.idx = i;
    T.left = p.dur;

    el("sprTimer").style.background = `linear-gradient(160deg, ${p.farbe} 0%, ${dunkler(p.farbe, -55)} 100%)`;
    el("sprPhase").textContent = p.label;
    el("sprEx").textContent = p.ex ? "→ " + p.ex : "";
    const runde = p.round || letzteRunde(i);
    el("sprRound").textContent = runde ? `RUNDE ${runde} / ${S.rounds}` : "";
    const naechste = T.seq[i + 1];
    el("sprNext").textContent = naechste
      ? "Als nächstes: " + naechste.label + (naechste.ex ? " – " + naechste.ex : "")
      : "Letzte Phase";
    baueBalken();
    if (ansagen) piep(p.type === "work" ? 880 : 523, p.type === "work" ? 0.18 : 0.15, p.type === "work" ? 0.6 : 0.5);
    zeigeZeit();
  }

  function letzteRunde(i) {
    for (let j = i; j >= 0; j--) if (T.seq[j].round) return T.seq[j].round;
    return 0;
  }

  function baueBalken() {
    const jetzt = T.seq[T.idx];
    const bis = jetzt.round || letzteRunde(T.idx);
    el("sprBars").innerHTML = T.workPhasen.map((w) => {
      let cls = "spr-bar";
      if (jetzt.round && w.round === jetzt.round) cls += " is-jetzt";
      else if (w.round <= bis) cls += " is-fertig";
      return `<span class="${cls}"></span>`;
    }).join("");
  }

  function schritt() {
    if (!T.laeuft) { T.last = performance.now(); return; }
    const now = performance.now();
    const dt = (now - T.last) / 1000;
    T.last = now;

    const vorher = T.left;
    T.left -= dt;
    T.elapsed += dt;
    T.kcal += kcalFuer(T.seq[T.idx].type, dt, S.weight);

    if (Math.ceil(vorher) !== Math.ceil(T.left) && T.left > 0 && T.left <= 3.05) piep(660, 0.09, 0.4);

    if (T.left <= 0) {
      if (T.idx + 1 >= T.seq.length) return fertig(true);
      return ladePhase(T.idx + 1, true);
    }
    zeigeZeit();
  }

  function zeigeZeit() {
    el("sprTime").textContent = Math.ceil(T.left);
    el("sprElapsed").textContent = mmss(T.elapsed);
    el("sprKcal").textContent = Math.round(T.kcal);
  }

  function pauseUm() {
    T.laeuft = !T.laeuft;
    el("sprPause").textContent = T.laeuft ? "PAUSE ⏸" : "WEITER ▶";
    if (T.laeuft) T.last = performance.now();
  }

  function ueberspringen() {
    if (T.idx + 1 >= T.seq.length) return fertig(true);
    ladePhase(T.idx + 1, true);
  }

  function stoppUhr() {
    T.laeuft = false;
    if (T.tick) clearInterval(T.tick);
    T.tick = null;
    wakeAus();
  }

  // Einheit sichern. Auch Abbrüche werden festgehalten (ab 60 s) — die Frage
  // „wie oft war ich dran" beantwortet ein Teiltraining ehrlicher als nichts.
  async function sichere(durchgezogen) {
    if (T.gespeichert || T.elapsed < 60) return null;
    T.gespeichert = true;
    const jetzt = new Date();
    const geschafft = T.workPhasen.filter((w) => w.round <= letzteRunde(T.idx)).length;
    const daten = {
      art:             ART,
      dauerSek:        Math.round(T.elapsed),
      kcal:            Math.round(T.kcal),
      rundenGeschafft: durchgezogen ? S.rounds : geschafft,
      rundenGeplant:   S.rounds,
      abgebrochen:     !durchgezogen,
      preset:          aktivesPreset || "eigene",
      uebungen:        S.exercises.slice(),
      gewicht:         S.weight,
      intervall:       `${S.work}/${S.rest}s`,
      tag:             tagKey(jetzt),
      uhrzeit:         `${String(jetzt.getHours()).padStart(2, "0")}:${String(jetzt.getMinutes()).padStart(2, "0")}`
    };
    try {
      await speichereTraining(daten);
      return daten;
    } catch (e) {
      console.error("Training konnte nicht gespeichert werden:", e);
      return null;
    }
  }

  function fertig(durchgezogen) {
    stoppUhr();
    piep(784, 0.18, 0.5);
    setTimeout(() => piep(1046, 0.25, 0.5), 180);

    const timer = el("sprTimer");
    timer.style.background = "linear-gradient(160deg,#15191e,#0b0d10)";
    timer.querySelector(".spr-ts-top").style.visibility = "hidden";
    el("sprBottom").style.display = "none";
    el("sprMid").innerHTML = `
      <div class="spr-done">
        <div class="spr-done-em">${durchgezogen ? "🎉" : "👍"}</div>
        <div class="spr-phase" style="color:#c8ff2e">${durchgezogen ? "GESCHAFFT!" : "EINHEIT BEENDET"}</div>
        <div class="spr-big">${mmss(T.elapsed)}</div>
        <div class="spr-next">Trainingszeit</div>
        <div class="spr-big">${Math.round(T.kcal)}</div>
        <div class="spr-next">≈ verbrannte Kalorien</div>
        <p class="spr-gespeichert" id="sprGespeichert">wird gespeichert …</p>
        <button class="spr-ctrl spr-ctrl--main" id="sprZurueck" type="button" style="margin-top:1.6rem;padding:1rem 2.4rem">FERTIG</button>
      </div>`;

    sichere(durchgezogen).then((daten) => {
      const hinweis = el("sprGespeichert");
      if (!hinweis) return;
      hinweis.textContent = daten
        ? "✓ In der Historie gespeichert"
        : (T.elapsed < 60 ? "Unter 1 Minute — nicht gespeichert" : "Konnte nicht gespeichert werden");
    });

    el("sprZurueck").addEventListener("click", zurueckZumSetup);
  }

  // Abbruch über ✕ — ebenfalls sichern, dann zurück.
  async function abbrechen() {
    stoppUhr();
    await sichere(false);
    zurueckZumSetup();
  }

  function zurueckZumSetup() {
    stoppUhr();
    const timer = el("sprTimer");
    timer.hidden = true;
    timer.style.background = "";
    document.body.classList.remove("spr-timer-offen");
    // Timer-Innenleben für den nächsten Lauf wiederherstellen.
    el("sprMid").innerHTML = `
      <div class="spr-phase" id="sprPhase">BEREIT</div>
      <div class="spr-ex" id="sprEx"></div>
      <div class="spr-time" id="sprTime">0</div>
      <div class="spr-next" id="sprNext"></div>
      <div class="spr-bars" id="sprBars"></div>
      <div class="spr-ts-stats">
        <div><div class="spr-v" id="sprElapsed">0:00</div><div class="spr-k">Gesamt</div></div>
        <div><div class="spr-v" id="sprKcal">0</div><div class="spr-k">≈ kcal</div></div>
      </div>`;
    el("sprPause").textContent = "PAUSE ⏸";
    zeigeTab("timer");
  }

  // ---------- Einstellungen merken ----------
  function merkeKonfig(sofort) {
    if (speicherTimer) clearTimeout(speicherTimer);
    const schreib = () => {
      speicherTrainingKonfig(ART, { ...S, preset: aktivesPreset })
        .then(() => { el("sprKonfigHinweis").textContent = "Einstellungen gespeichert — auch auf dem Handy."; })
        .catch((e) => {
          console.error("Konfig speichern fehlgeschlagen:", e);
          el("sprKonfigHinweis").textContent = "Einstellungen konnten nicht gespeichert werden.";
        });
    };
    if (sofort) schreib();
    else speicherTimer = setTimeout(schreib, 900);   // Stepper-Klicks bündeln
  }

  // ---------- Tabs ----------
  function zeigeTab(welcher) {
    const timerAn = welcher === "timer";
    el("sprTabTimer").classList.toggle("is-aktiv", timerAn);
    el("sprTabStats").classList.toggle("is-aktiv", !timerAn);
    el("sprTabTimer").setAttribute("aria-selected", String(timerAn));
    el("sprTabStats").setAttribute("aria-selected", String(!timerAn));
    el("sprSetup").hidden = !timerAn;
    el("sprStats").hidden = timerAn;
  }

  // Heatmap der letzten 12 Wochen, Spalte = Woche, Zeile = Wochentag (Mo oben).
  function heatmapHtml(tage) {
    const heute = new Date();
    heute.setHours(12, 0, 0, 0);
    const start = new Date(heute);
    start.setDate(start.getDate() - 83);
    // Auf Montag zurückrücken, damit die Zeilen sauber ausgerichtet sind.
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));

    const spalten = [];
    for (let d = new Date(start); d <= heute; d.setDate(d.getDate() + 7)) {
      const woche = [];
      for (let i = 0; i < 7; i++) {
        const tag = new Date(d);
        tag.setDate(tag.getDate() + i);
        if (tag > heute) { woche.push(`<span class="spr-hm-zelle is-leer"></span>`); continue; }
        const k = tagKey(tag);
        const sek = tage.get(k) || 0;
        const stufe = sek === 0 ? 0 : sek < 600 ? 1 : sek < 1500 ? 2 : sek < 2700 ? 3 : 4;
        const titel = `${tag.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" })} — ${sek ? stundenKurz(sek) : "nichts"}`;
        woche.push(`<span class="spr-hm-zelle spr-hm-${stufe}" title="${escapeHtml(titel)}"></span>`);
      }
      spalten.push(`<div class="spr-hm-woche">${woche.join("")}</div>`);
    }
    return `
      <div class="spr-hm">
        <div class="spr-hm-tage"><span>Mo</span><span>Mi</span><span>Fr</span><span>So</span></div>
        <div class="spr-hm-grid">${spalten.join("")}</div>
      </div>
      <div class="spr-hm-legende muted">
        <span>weniger</span>
        <span class="spr-hm-zelle spr-hm-0"></span><span class="spr-hm-zelle spr-hm-1"></span>
        <span class="spr-hm-zelle spr-hm-2"></span><span class="spr-hm-zelle spr-hm-3"></span>
        <span class="spr-hm-zelle spr-hm-4"></span>
        <span>mehr</span>
      </div>`;
  }

  function zeichneStats() {
    const a = auswertung(einheiten);
    el("sprStreakKopf").textContent = a.streak > 0
      ? `🔥 ${a.streak} Tag${a.streak === 1 ? "" : "e"} in Folge`
      : (a.gesamtN ? "" : "");

    if (!einheiten.length) {
      el("sprStats").innerHTML = `
        <div class="card card--pad empty-card">
          <div class="empty-emoji">🪢</div>
          <p class="empty-title">Noch keine Einheit aufgezeichnet</p>
          <p class="muted">Starte den Timer — sobald du mindestens eine Minute gesprungen bist, erscheint die Einheit hier.</p>
        </div>`;
      return;
    }

    const liste = einheiten.slice(0, 25).map((e) => {
      const d = e.tag ? new Date(e.tag + "T12:00:00") : (e.erstelltAm && e.erstelltAm.toDate ? e.erstelltAm.toDate() : null);
      const datum = d ? d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "2-digit" }) : "—";
      return `
        <div class="spr-hist-row" data-id="${escapeHtml(e.id)}">
          <div class="spr-hist-haupt">
            <span class="spr-hist-datum">${escapeHtml(datum)}${e.uhrzeit ? ` · ${escapeHtml(e.uhrzeit)}` : ""}</span>
            <span class="spr-hist-sub muted">
              ${escapeHtml(mmss(e.dauerSek || 0))} · ${e.kcal || 0} kcal ·
              ${e.rundenGeschafft || 0}/${e.rundenGeplant || 0} Runden${e.intervall ? ` · ${escapeHtml(e.intervall)}` : ""}
              ${e.abgebrochen ? ` · <span class="spr-hist-teil">Teil-Einheit</span>` : ""}
            </span>
          </div>
          <button class="spr-hist-del" type="button" data-del="${escapeHtml(e.id)}" aria-label="Einheit löschen">×</button>
        </div>`;
    }).join("");

    el("sprStats").innerHTML = `
      <div class="spr-summary">
        <div class="spr-stat"><div class="spr-n">${a.streak}</div><div class="spr-k">Tage Streak</div></div>
        <div class="spr-stat"><div class="spr-n">${a.wocheN}</div><div class="spr-k">7 Tage</div></div>
        <div class="spr-stat"><div class="spr-n">${escapeHtml(stundenKurz(a.wocheSek))}</div><div class="spr-k">Zeit / Woche</div></div>
      </div>
      <div class="spr-summary">
        <div class="spr-stat"><div class="spr-n">${a.gesamtN}</div><div class="spr-k">Einheiten</div></div>
        <div class="spr-stat"><div class="spr-n">${escapeHtml(stundenKurz(a.gesamtSek))}</div><div class="spr-k">Gesamtzeit</div></div>
        <div class="spr-stat"><div class="spr-n">${a.gesamtKcal}</div><div class="spr-k">≈ kcal</div></div>
      </div>

      <div class="spr-label">Letzte 12 Wochen</div>
      <div class="card spr-card spr-card--pad">${heatmapHtml(a.tage)}</div>

      <div class="spr-label">Verlauf</div>
      <div class="card spr-hist">${liste}</div>
      ${einheiten.length > 25 ? `<p class="muted" style="font-size:.78rem;margin-top:.5rem">Angezeigt: die 25 neuesten von ${einheiten.length} Einheiten.</p>` : ""}`;

    el("sprStats").querySelectorAll(".spr-hist-del").forEach((b) => {
      b.addEventListener("click", async () => {
        b.disabled = true;
        try {
          await loescheTraining(b.dataset.del);      // Observer zeichnet neu
        } catch (e) {
          console.error(e);
          b.disabled = false;
        }
      });
    });
  }

  // ---------- Verdrahtung ----------
  el("sprAddEx").addEventListener("click", () => { S.exercises.push("Neue Übung"); baueUebungen(); merkeKonfig(); });
  el("sprLongToggle").addEventListener("click", () => { S.longOn = !S.longOn; aktivesPreset = ""; zeichneWerte(); merkeKonfig(); });
  container.querySelectorAll("[data-w]").forEach((b) => {
    b.addEventListener("click", () => {
      S.weight = Math.min(180, Math.max(35, S.weight + +b.dataset.w));
      zeichneWerte();
      merkeKonfig();
    });
  });
  el("sprStart").addEventListener("click", starte);
  el("sprPause").addEventListener("click", pauseUm);
  el("sprSkip").addEventListener("click", ueberspringen);
  el("sprClose").addEventListener("click", abbrechen);
  el("sprTabTimer").addEventListener("click", () => zeigeTab("timer"));
  el("sprTabStats").addEventListener("click", () => zeigeTab("stats"));

  bauePresets();
  baueIntervalle();
  baueUebungen();
  zeichneWerte();

  // Gespeicherte Einstellungen nachziehen (überschreibt die Standardwerte).
  ladeTrainingKonfig(ART).then((k) => {
    if (!k) return;
    ["warmup", "work", "rest", "rounds", "longEvery", "longDur", "cooldown", "weight"].forEach((f) => {
      if (typeof k[f] === "number") S[f] = k[f];
    });
    if (typeof k.longOn === "boolean") S.longOn = k.longOn;
    if (Array.isArray(k.exercises) && k.exercises.length) S.exercises = k.exercises.slice();
    aktivesPreset = typeof k.preset === "string" ? k.preset : "";
    baueUebungen();
    zeichneWerte();
    el("sprKonfigHinweis").textContent = "Zuletzt benutzte Einstellungen geladen.";
  }).catch((e) => console.error("Konfig laden fehlgeschlagen:", e));

  const unsub = beobachteTrainings(
    (liste) => { einheiten = liste.filter((e) => !e.art || e.art === ART); zeichneStats(); },
    (e) => {
      console.error(e);
      el("sprStats").innerHTML = `<div class="card card--pad"><p class="notice notice--error" style="margin:0">
        Historie konnte nicht geladen werden.</p></div>`;
    }
  );

  // Beim Verlassen der View: Uhr aus, Wake-Lock zurückgeben, Body-Klasse weg.
  beiViewWechsel(() => {
    stoppUhr();
    if (speicherTimer) clearTimeout(speicherTimer);
    document.body.classList.remove("spr-timer-offen");
    unsub();
  });
}
