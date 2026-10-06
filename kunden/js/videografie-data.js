// Lehrplan „Videografie lernen“ — 5 Module, 23 Themen.
//
// Ersetzt den alten Kurs (kurs-data.js, Okt. 2026). Gleiche Trennung wie bei
// roadmap-data.js: hier stehen nur die Texte, die View zeichnet, die Logik
// (videografie-logik.js) rechnet. Dieselbe Datei liest tools/lernstand.mjs,
// damit Claude und Portal denselben Lehrplan kennen.
//
// Quelle der Reihenfolge ist der Skill „videografie-lernen“ (Lehrplan dort).
// Wer den Lehrplan ändert, ändert ihn hier UND im Skill.
//
// Aufbau eines Themas: [id, titel, kannst]
//   id     — stabiler Schlüssel („1.3“), landet als Schlüssel in
//            lernen/<id>.themen. NIE nachträglich ändern, sonst verwaist der
//            Fortschritt.
//   kannst — was du danach kannst, in einem Satz (Praxis, keine Theorie).

export const LEHRPLAN = [
  { id: "1", name: "Licht", hinweis: "Priorität", themen: [
    ["1.1", "Lichtrichtung mit einem Licht",
     "Du stellst das Amaran frontal, auf 45°, 90°, hinten und oben und weißt vorher, wie die Schatten fallen."],
    ["1.2", "Weiches vs. hartes Licht",
     "Du steuerst Weichheit über Abstand und Größe der Lichtquelle statt über die Helligkeit."],
    ["1.3", "Three-Point-Lighting",
     "Du baust Key, Fill und Rim in 10 Minuten auf und kannst jedes Licht einzeln begründen."],
    ["1.4", "Negative Fill und Kontrast",
     "Du holst mit einem schwarzen Tuch Tiefe ins Gesicht und setzt das Kontrastverhältnis bewusst."],
    ["1.5", "Motivated Lighting",
     "Dein Licht hat eine glaubwürdige Quelle im Bild — Fenster, Lampe, Bildschirm."],
    ["1.6", "Fensterlicht mit LED faken",
     "Du simulierst Sonne durchs Fenster mit dem Amaran, auch wenn draußen Wolken sind."],
    ["1.7", "Innenräume ausleuchten",
     "Du leuchtest einen Wohnraum für Immobilien-Reels aus, ohne dass es nach Licht aussieht."],
    ["1.8", "Mischlicht und Farbtemperatur",
     "Du erkennst Mischlicht sofort und entscheidest, ob du es angleichst oder als Stilmittel nutzt."],
  ]},
  { id: "2", name: "Komposition", themen: [
    ["2.1", "Drittelregel und Blickrichtung",
     "Du platzierst Personen so, dass Blick und Bewegung Raum im Bild haben."],
    ["2.2", "Shot-Typen und Kamerawinkel",
     "Du wählst Totale, Halbnahe, Nahe und Winkel nach Wirkung, nicht nach Gewohnheit."],
    ["2.3", "Führende Linien",
     "Du findest in jedem Raum Linien, die den Blick dahin lenken, wo du ihn haben willst."],
    ["2.4", "Tiefe: Vorder-, Mittel-, Hintergrund",
     "Deine Bilder haben drei Ebenen statt einer flachen Wand."],
    ["2.5", "Negative Space und Symmetrie",
     "Du setzt Leere und Symmetrie bewusst ein, damit ein Bild ruhig und hochwertig wirkt."],
    ["2.6", "Räume komponieren",
     "Immobilien: Weitwinkel, Kamerahöhe und gerade Vertikalen sitzen beim ersten Versuch."],
  ]},
  { id: "3", name: "Kamera & Belichtung", hinweis: "Sony A6700", themen: [
    ["3.1", "Belichtungsdreieck für Video, 180°-Regel",
     "Du stellst Shutter, Blende und ISO für Video ein, ohne zu raten."],
    ["3.2", "Weißabgleich",
     "Du setzt den Weißabgleich manuell und weißt, wann du absichtlich danebenliegst."],
    ["3.3", "S-Log3 richtig belichten",
     "Du belichtest S-Log3 mit Zebras und Waveform so, dass das Grading sauber bleibt."],
    ["3.4", "ND-Filter und offene Blende",
     "Du drehst bei Tageslicht mit offener Blende und korrektem Shutter."],
  ]},
  { id: "4", name: "Bewegung", themen: [
    ["4.1", "Grundbewegungen",
     "Pan, Tilt, Push-in, Pull-out und Slide sind ruhig und haben ein klares Ende."],
    ["4.2", "Motivated Camera Movement",
     "Jede Bewegung hat einen Grund: sie enthüllt, folgt oder betont."],
    ["4.3", "Gimbal-Moves für Immobilien",
     "Du führst einen Raum mit dem Gimbal so vor, dass er größer und hochwertiger wirkt."],
  ]},
  { id: "5", name: "Farbe", themen: [
    ["5.1", "Farbtheorie für Film",
     "Du planst Farben im Bild (Kontrast, Harmonie) schon vor dem Dreh."],
    ["5.2", "Grading-Grundlagen",
     "Du gradest in fester Reihenfolge: Belichtung, Kontrast, Weiß, dann Look."],
  ]},
];

// Equipment, mit dem jede Übung machbar sein muss — steht im Portal unter
// der Übung, damit klar ist, womit gearbeitet wird.
export const EQUIPMENT = ["Sony A6700", "Amaran-LED", "Softbox", "schwarzes Tuch", "Fenster"];

// Was Vale zu Claude sagt, um die nächste Lerneinheit zu starten.
export const START_SATZ = "Ich will weiter Videografie lernen";
