// Inhalte der Roadmap — Phasen, Meilensteine und Wochenrhythmus.
//
// BEWUSST eine eigene Datei: die Meilensteine werden sich ändern, die View
// nicht. Wer die Roadmap fortschreibt, fasst nur diese Datei an. Umgekehrt
// gilt: in admin-roadmap.js stehen keine Inhalte, nur UI-Beschriftungen.
//
// Aufbau eines Meilenstein-Items: [id, text, wie, warum]
//   id    — stabiler Schlüssel, landet als Haken in roadmap/valentin.done.
//           NIE nachträglich ändern, sonst verwaist der gesetzte Haken.
//   text  — die Kurzfassung, immer sichtbar.
//   wie   — die konkrete Ausführung, aufklappbar.
//   warum — die Begründung, aufklappbar.

// --- Eckdaten ---------------------------------------------------------
// START/TARGET spannen den Zeitstrahl auf; DEUSSEN und ACHTZEHN sind die
// beiden Termine, auf die alles zuläuft.
export const START    = new Date('2026-09-01');
export const TARGET   = new Date('2027-12-31');
export const DEUSSEN  = new Date('2026-11-01');
export const ACHTZEHN = new Date('2027-07-01');

// --- Phasen -----------------------------------------------------------
// Vier Stück. Phase 4 (Abi-Modus) liegt HINTER dem Zeitstrahl-Ende: sie
// taucht in der Meilensteinliste auf, aber nicht auf dem Strahl.
export const PHASES=[
{id:'p1',name:'Fundament',from:'2026-09-01',to:'2026-12-31',ziel:2000,groups:[
 ['Sofort',[
  ['p1-web','Website-Preise angehoben',
   'Anweisung „anweisung-website-preise.md" an den Coder geben. Kernpunkte: Social-Retainer ab 1.200 €/Monat für 4 Videos, Imagefilm ab 2.500 €/Projekt, Automotive-Karte auf Anfrage. Nach Umsetzung selbst mit grep prüfen, dass 800 und 450 nirgends mehr stehen.',
   'Die Seite ankert bisher bei 133 €/Video. Jeder Kunde, der sie vor einem Gespräch sieht, hat diesen Preis im Kopf — auch Deussen im November.'],
  ['p1-ust','USt-Unterkonto eingerichtet',
   'Bei deiner Bank ein Unterkonto anlegen (bei den meisten Banken in 5 Minuten in der App). Regel: Bei jedem Zahlungseingang sofort 19 % des Brutto-Betrags rüberschieben. Beispiel: 892,50 € brutto → 142,50 € aufs Unterkonto.',
   'Das Geld gehört dem Finanzamt, nicht dir. Wer es auf dem Hauptkonto lässt, gibt es aus und hat bei der Voranmeldung ein Problem.'],
  ['p1-kv','Krankenkasse angerufen',
   'Deine Krankenkasse anrufen, Frage stellen: „Ich bin 17, Schüler, familienversichert, habe ein Gewerbe mit aktuell ~1.250 €/Monat Umsatz. Ab welchem Einkommen falle ich aus der Familienversicherung, und was würde ich dann zahlen?" Antwort notieren.',
   'Das kann 200–450 €/Monat kosten und frisst direkt am Ziel. Du musst die Grenze kennen, bevor du sie überschreitest.'],
  ['p1-cal','Wochenrhythmus in Google Calendar',
   'Sechs wiederkehrende Termine anlegen: Mo Akquise (2h), Di Kundenarbeit (2h), Mi Lernen (2h), Do Kundenarbeit (2h), Fr Personal Brand (2h), Sa Produktion (3–4h). Sonntag bleibt leer. Uhrzeiten so legen, dass sie nach der Schule realistisch sind.',
   'Was keinen Kalendereintrag hat, passiert nicht. Der Rhythmus ist die Grundlage für alles andere in dieser Roadmap.'],
 ]],
 ['September',[
  ['p1-gimbal','DJI RS4 Mini + CPL-Filter gekauft',
   'RS4 Mini Combo (~400 €) und einen CPL-Filter in 67 mm für das Tamron (~60 €). Beides als Betriebsausgabe, Rechnung aufheben, Vorsteuer holst du dir über die Voranmeldung zurück. Falls dein KF-ND fix ist: variablen ND2–32 dazu (~80 €).',
   'Ohne Gimbal keine Auto-Bewegtaufnahmen. Ohne CPL spiegelt jeder Lack — das rettet kein Grading. Der CPL ist der wichtigste Kauf für Auto-Content, nicht der teuerste.'],
  ['p1-remise','Classic Remise: Drehgenehmigung',
   'Zuerst das Center-Management kontaktieren (Mail oder persönlich vor Ort), nicht die Händler. Angebot: „Ich produziere kostenlos Social-Videos von Fahrzeugen der Händler hier. Die Händler bekommen das fertige Video, ich nutze es fürs Portfolio. Darf ich dafür regelmäßig hier drehen?" Schriftliches OK einholen.',
   'Ohne Genehmigung stehst du nach zwei Wochen vor einem Hausverbot. Mit Genehmigung ist die Remise dein Akquisekanal für die ganze Automotive-Nische.'],
  ['p1-brand','Personal Brand läuft — 3 Posts/Woche seit 2 Wochen',
   'Freitags-Block nutzen: 3 Posts fertig schneiden und in TikTok/Instagram vorplanen. Anfangs reicht Material vom Handy und aus alten Projekten. Ab dem ersten Auto-Shoot läuft das 3-Part-Format. Nicht auf Perfektion warten.',
   'Zwei Wochen Konsistenz sind der Beweis, dass der Rhythmus trägt. Follower kommen später — jetzt zählt, dass die Maschine läuft.'],
  ['p1-auto1','Erstes Auto mit A6700 + Gimbal gefilmt',
   'Ein Händler, ein Auto, eine vorher geschriebene Shotlist mit 12 Einstellungen (niedrige Position, Details, langsame Gimbal-Fahrten, CPL eingedreht). S-Log3, ISO 800 oder 2500. Ray-Ban Meta für Part 1 mitlaufen lassen, falls schon da.',
   'Du hast noch nichts Vorzeigbares im Automotive-Bereich. Das erste Auto ist Übung — es muss nicht gut sein, es muss passieren.'],
 ]],
 ['Oktober',[
  ['p1-auto3','3 Autos gefilmt',
   'Alle 1–2 Wochen ein Auto, jeweils mit Shotlist vorher und kurzer Auswertung danach (welche Shots funktionieren, welche nicht). Verschiedene Autos, verschiedene Lichtsituationen.',
   'Aus drei Shoots kannst du ein Hero-Piece schneiden und hast genug Material für vier Wochen Personal-Brand-Content.'],
  ['p1-hero1','Erstes Automotive-Hero-Piece online',
   '60–90 Sekunden, cinematisch, mit Sounddesign und Grading. Bestes Material aus den drei Shoots. Auf die Website (neue Automotive-Sektion), auf Instagram, an den Händler.',
   'Das ist das erste Stück, das du einem Autohaus zeigen kannst, wenn es fragt: „Was habt ihr im Automotive-Bereich gemacht?"'],
  ['p1-kalt20','20 Kaltkontakte rausgeschickt',
   'Montags-Block: 5 personalisierte Mails pro Woche, KI-gestützt recherchiert. Struktur wie gehabt: Intro + lokale Referenz → persönliches Detail → Lücke als Chance → Konzept → CTA 20-Min-Call. Zielgruppen: Autohändler Düsseldorf, weitere Makler, Premium-Gastro. Tracking in Notion oder einer einfachen Tabelle.',
   'Bis zur Deussen-Verhandlung brauchst du eine Pipeline. Ohne Alternativen verhandelst du aus Schwäche — und das merkt dein Gegenüber.'],
  ['p1-report','Reichweiten-Report Deussen fertig',
   'Instagram/TikTok-Insights des Deussen-Kanals exportieren (letzte 6 Monate). In Claude: Reichweite vor dir vs. jetzt, Follower-Entwicklung, Top-3-Videos und warum, Empfehlung für die nächsten Monate. Eine Seite PDF, sauber gestaltet.',
   'Das ist deine Verhandlungswaffe. Nicht „ich bin besser geworden", sondern „hier sind die Zahlen, die ich für euch gebaut habe".'],
  ['p1-studio','Resolve Studio gekauft',
   'Einmalkauf ~300 €, aus der Oktober-Zahlung von Deussen. Lizenz an deinen Rechner binden. Danach: Magic Mask und Noise Reduction ausprobieren.',
   'Magic Mask trennt das Auto vom Hintergrund ohne Rotoskopie — du kannst die Lackfarbe separat graden. Noise Reduction rettet S-Log3-Aufnahmen bei wenig Licht.'],
  ['p1-modul1','Modul 1 (Sales & Preise) abgeschlossen',
   'Mittwochs-Block: The Futur (Chris Do) zu Value-Based Pricing, dazu die Videografie-Retainer-Videos aus der Roadmap. Praxisaufgabe: Discovery-Call-Skript schreiben und die Deussen-Verhandlung mit den drei erwartbaren Einwänden als Rollenspiel durchgehen.',
   'Besser filmen kannst du schon. Besser verkaufen ist dein Engpass. Deshalb kommt Sales vor allen anderen Modulen.'],
 ]],
 ['November',[
  ['p1-leads','2 warme Leads in der Pipeline',
   'Aus den 20+ Kaltkontakten: mindestens zwei, die geantwortet haben und mit denen ein Gespräch geplant oder geführt ist. Wenn nicht: Follow-up-Anruf bei den besten fünf unbeantworteten Mails.',
   'Das ist die Voraussetzung für die Verhandlung. Zwei warme Leads bedeuten: Du kannst Deussen gehen lassen, wenn sie nicht mitziehen.'],
  ['p1-deussen','Deussen-Verhandlung geführt',
   'Anfang November, persönlich oder Call mit Nicolai. Report auf den Tisch. Vorschlag: „4 hochwertigere Videos statt 6 für 1.200 €". Fallback: 5 für 1.250 €. Untergrenze: 200 €/Video. Darunter höflich beenden. Nicht den Preis pro Video isoliert erhöhen — das Paket umbauen.',
   'Von 125 auf 300 € klingt nach +140 %. „4 statt 6 für 1.200 €" klingt nach +60 % — gleiche Zahl für dich, anderes Framing für sie.'],
  ['p1-autojob','Erster bezahlter Auto-Job',
   'Einem der Remise-Händler oder einem Autohaus aus der Kaltakquise ein konkretes Angebot: ein Reel für 300–350 € oder ein Cinematic-Clip für 800 €. Portfolio-Stück als Beweis mitschicken.',
   'Der erste bezahlte Auto-Job ist der Übergang von Portfolio zu Geschäft. Ab hier ist Automotive nicht mehr Hobby.'],
  ['p1-500','500 Follower auf TikTok',
   'Ergibt sich aus 3 Posts/Woche im 3-Part-Format. Nicht kaufen, nicht pushen. Wenn es im November nicht klappt: Hooks der letzten 10 Posts analysieren, nicht Frequenz erhöhen.',
   'Kein Ziel an sich — ein Indikator, dass das Format Traktion hat. Von 340 auf 500 ist realistisch bei Konsistenz.'],
 ]],
 ['Dezember',[
  ['p1-2000','2.000 € Monatsumsatz erreicht',
   'Rechnung: Deussen neu (1.000–1.200) + Röstzeit (500) + 1 Auto-Job (300+). Oder: Deussen weg, dafür Ersatz-Retainer + Röstzeit + Auto-Jobs. Im Dashboard oben eintragen.',
   'Erster Meilenstein auf dem Weg zu 5.000. Wenn du hier bist, stimmt die Richtung.'],
  ['p1-hero3','3 Automotive-Hero-Pieces online',
   'Aus 6–8 Shoots die drei stärksten Stücke, verschiedene Autos, verschiedene Stimmungen (Tag/Nacht, Klassiker/modern). Alle auf der Website.',
   'Ein Hero-Piece ist ein Glückstreffer. Drei sind ein Stil. Ab hier kannst du Automotive glaubwürdig anbieten.'],
  ['p1-autosite','Automotive-Sektion auf der Website',
   'Unterseite `/automotive` mit den drei Hero-Pieces, einem Satz Positionierung, dem Retainer-Angebot ab 1.400 € und Kontakt. Noch nicht die Startseite — das kommt in Phase 2.',
   'Wer über die Auto-Posts auf dich kommt, muss auf der Website sofort Automotive sehen, nicht Café Schneider.'],
  ['p1-lens','Lichtstarkes Objektiv gekauft',
   'Sony 50 mm f/1.8 (~200 €) oder Sigma 56 mm f/1.4 (~400 €). Aus der Dezember-Zahlung. Für Detail- und Portraitaufnahmen am Auto.',
   'Auto-Bilder leben von Kompression und Freistellung. Das Tamron kann viel, aber f/2.8 bei 70 mm sieht nicht nach Werbung aus.'],
 ]],
]},
{id:'p2',name:'Nische besetzen',from:'2027-01-01',to:'2027-06-30',ziel:3000,groups:[
 ['Januar – Februar',[
  ['p2-pos','Positionierung: Automotive & Premium-Marken',
   'Bio auf TikTok/Instagram, Website-Headline, Meta-Description ändern. Neuer Satz: „Cinematic Bewegtbild für Automotive & Premium-Marken — Düsseldorf." Lokale Unternehmen bleiben als Unterpunkt auf der Website.',
   'Ein Spezialist wird gebucht, ein Generalist verglichen. Die Personal Brand ist ab jetzt zu 100 % Auto — die Rechnung darf breiter bleiben.'],
  ['p2-2k','2 zahlende Automotive-Kunden',
   'Aus Remise-Kontakten und Kaltakquise. Mindestens Einzeljobs, besser ein kleiner Retainer. Preis jetzt: Reel 350–450 €.',
   'Zwei Kunden sind kein Zufall mehr. Ab hier kannst du in Pitches sagen: „Ich arbeite mit Autohäusern in Düsseldorf."'],
  ['p2-1000','1.000 Follower TikTok',
   'Konsistenz + Modul 3 (Hooks, Packaging). Die 3 besten Posts analysieren und das Muster wiederholen.',
   'Ab 1.000 fangen Händler an, deine Zahlen als Referenz zu sehen. Vorher ist es ein Hobby-Account.'],
  ['p2-modul3','Modul 3 (Content-Strategie) abgeschlossen',
   'Colin & Samir, Paddy Galloway. Praxisaufgabe: die letzten 20 Deussen-Posts auswerten, die drei besten identifizieren, daraus eine Format-Empfehlung schreiben.',
   'Das ist deine größte Wissenslücke und gleichzeitig das, was Retainer verkauft: nicht schöne Bilder, sondern Reichweite mit System.'],
  ['p2-radius','ÖPNV-Radius definiert',
   'Liste aller Autohäuser, Händler, Tuner und Detailer, die mit Bahn + max. 15 Min. Fußweg erreichbar sind: Düsseldorf, Neuss, Krefeld, Duisburg, Ratingen, Hilden. Equipment auf rucksacktauglich reduzieren (A6700, Gimbal, 2 Objektive, CPL, Mic, Licht kompakt). Diese Liste ist deine Akquise-Zielliste bis Juli.',
   'Bis 18 fährst du Öffis. Das ist kein Nachteil, wenn du die Zielliste danach baust — es ist ein Nachteil, wenn du Kunden anschreibst, zu denen du nicht kommst.'],
 ]],
 ['März – April',[
  ['p2-spec','Spec-Werbespot gedreht',
   'Drei volle Tage in den Osterferien. Konzept vorher schreiben (Story, nicht Shotlist). Ein Auto, das du dir aussuchst — über Remise oder einen Kunden. Grading, Sounddesign, Musik wie eine echte Kampagne. 45–60 Sekunden.',
   'Kein Kundenprojekt zeigt, was du kannst, wenn du freie Hand hast. Der Spec-Spot ist das Stück, das in jedes Pitch-Deck für große Kunden kommt.'],
  ['p2-relaunch','Website-Relaunch: Automotive als Hauptseite',
   'Startseite zeigt Spec-Spot und Hero-Pieces. Lokale Unternehmen wandern auf eine Unterseite. Preise angehoben (Reel 350–450, Retainer 1.400–1.800, Imagefilm 900 €/min).',
   'Die Website muss der Positionierung folgen. Wer jetzt auf die Seite kommt, kommt wegen Automotive.'],
  ['p2-roest','Röstzeit auf 300 €/Video',
   'Bei Vertragsverlängerung, nicht mittendrin. Argument: dokumentierte Ergebnisse + neuer Standardpreis. Jörg kennt dich — das ist ein Gespräch, keine Verhandlung.',
   'Bestandskunden hebst du bei Verlängerung an. Wer das nicht macht, arbeitet in zwei Jahren noch zu den Preisen von heute.'],
 ]],
 ['Mai – Juni',[
  ['p2-retainer','Erster Auto-Retainer ≥ 1.400 €',
   'Einem der beiden Automotive-Kunden ein Retainer-Angebot: 4 Videos/Monat, monatlicher Drehtag, Reichweiten-Report inklusive. Vorlage aus deinem Deussen-Skill nutzen.',
   'Ein Retainer im Automotive-Bereich beweist, dass die Nische trägt. Ab hier ist es wiederholbar.'],
  ['p2-3000','3.000 € Monatsumsatz',
   'Auto-Retainer (1.400) + Röstzeit (600) + Deussen oder Ersatz (1.000) = 3.000. Im Dashboard eintragen.',
   'Halbzeit auf dem Weg zu 5.000. Und der Punkt, ab dem die Krankenversicherungsfrage akut wird — spätestens jetzt klären.'],
  ['p2-2000f','2.000 Follower',
   'Läuft mit dem Format. Wenn nicht: nicht mehr posten, sondern besser packagen.',
   'Referenzzahl für Pitches an größere Händler.'],
  ['p2-social','Automotive-Social-Paket abgeliefert',
   '6–8 Reels für einen Händler als zusammenhängendes Paket, dokumentiert mit Ergebnissen. Das ist dein Case für Retainer-Pitches.',
   'Autohäuser fragen nicht „kannst du filmen", sondern „kannst du meinen Kanal führen". Das Paket beantwortet die zweite Frage.'],
 ]],
]},
{id:'p3',name:'Skalieren',from:'2027-07-01',to:'2027-12-31',ziel:5000,groups:[
 ['Juli – August',[
  ['p3-18','18 — Solo-Führerschein, Verträge selbst',
   'Führerschein ohne Begleitung nutzen. Alle laufenden Verträge auf dich umschreiben (bisher hat dein Vater mitunterschrieben). PayPal/Geschäftskonto neu prüfen.',
   'Ab jetzt keine Radiusbegrenzung und keine Unterschrift von jemand anderem. Das ist dein Hebelmoment.'],
  ['p3-nrw','Akquise NRW-weit gestartet',
   'Zielliste erweitern: Köln, Essen, Dortmund, Bochum. Größere Autohäuser, Markenhändler, Tuner mit Budget. Weiter 5 Mails/Woche, jetzt mit Spec-Spot und Retainer-Case im Anhang.',
   'Düsseldorf-Benrath ist zu klein für 5.000 €/Monat. NRW nicht.'],
  ['p3-geo','vale-video.de für KI-Suche optimiert',
   'Modul 6 in den Sommerferien: Schema-Markup, Entity-Signale, Antwortformate. Danach monatlich testen: ChatGPT, Claude, Perplexity nach „Videograf Automotive Düsseldorf" fragen.',
   'Wenn 2027 jemand eine KI nach einem Automotive-Videografen in NRW fragt, willst du die Antwort sein. Kaum jemand kann das — das ist auch eine verkaufbare Leistung.'],
 ]],
 ['September – Oktober',[
  ['p3-4000','4.000 € Monatsumsatz',
   'Zweiter Auto-Retainer oder erster Imagefilm-Auftrag. Preise jetzt: Retainer 2.000–2.500, Cinematic Film ab 2.500.',
   'Ab hier stößt du zeitlich an die Wand. Das ist das Signal für den nächsten Punkt.'],
  ['p3-editor','Erster Editor angebunden',
   'Freelance-Editor für Rohschnitt, 80–150 €/Video. Deinen Schnittprozess vorher so dokumentieren, dass er ohne Rückfragen läuft (Modul 7). Erst ein Testvideo, dann regelmäßig.',
   'Ein Editor kauft dir 6–8 Stunden pro Video zurück, die du in Akquise steckst. Das ist der erste Schritt zur Agentur — nicht Mitarbeiter, sondern delegieren lernen.'],
  ['p3-image','Imagefilm für ein Autohaus',
   'Ein Autohaus aus dem Retainer-Kreis oder der NRW-Akquise. Preis ab 2.500 €. Konzept, 1–2 Drehtage, volle Postproduktion.',
   'Höherpreisiges Format nachweisen. Ein Imagefilm im Portfolio öffnet die Tür zu Projekten, die ein Reel nie öffnet.'],
 ]],
 ['November – Dezember',[
  ['p3-5000','5.000 € Monatsumsatz — Hauptziel',
   'Retainer A (2.000) + Retainer B (1.500) + Bestand (600) + 1 Projekt (900) = 5.000. Vier Kunden, nicht zwanzig.',
   'Das ist das Ziel. Nicht Sommer 2028 — Dezember 2027, weil danach Abi kommt.'],
  ['p3-2ret','2 Retainer ≥ 1.500 €',
   'Beide Automotive. Beide mit Reichweiten-Report als Bestandteil.',
   'Zwei Retainer auf diesem Niveau sind die Basis, die durch die Abi-Phase trägt.'],
  ['p3-case','2 Reichweiten-Case-Studies dokumentiert',
   'Für zwei Kunden: Ausgangslage, was du gemacht hast, Zahlen vorher/nachher, in einem sauberen PDF. Auf die Website, in jedes Pitch-Deck.',
   'Das ist das, was fast kein Videograf hat: den Beweis, dass er Ergebnisse liefert, nicht nur Bilder. Es rechtfertigt jeden Preis auf deiner Leiter.'],
  ['p3-verl','Alle Retainer bis Juli 2028 verlängert',
   'Im Dezember mit allen Retainer-Kunden verlängern, mindestens bis Juli 2028. Preis dabei anheben, wo möglich.',
   'In der Abi-Phase akquirierst du nicht. Was im Dezember nicht gesichert ist, fehlt dir bis Sommer.'],
  ['p3-puffer','20 fertige Posts als Content-Puffer',
   'Aus dem Material des Jahres 20 Posts vorproduzieren und einplanen. Reicht für 20 Wochen bei 1 Post/Woche.',
   'Damit die Personal Brand in der Abi-Phase nicht stirbt, ohne dass du Zeit investierst.'],
 ]],
]},
{id:'p4',name:'Abi-Modus',from:'2028-01-01',to:'2028-05-31',ziel:5000,groups:[
 ['Halten, nicht wachsen',[
  ['p4-halten','Bestandskunden laufen ohne Ausfall',
   'Editor macht Rohschnitt, du machst Feinschnitt und Grading. Drehtage auf ein Minimum. Keine neuen Kunden, keine Kaltakquise, kein neues Modul.',
   'Du hast gesagt, du willst dich nicht überarbeiten. Das hier ist der Plan dafür. Ein Einbruch auf 4.000 € in dieser Phase ist eingeplant, kein Scheitern.'],
  ['p4-post','1 Post/Woche aus dem Puffer',
   'Freitags 15 Minuten: einen vorproduzierten Post veröffentlichen. Mehr nicht.',
   'Sichtbarkeit halten mit null kreativem Aufwand.'],
  ['p4-abi','Abitur bestanden',
   'Sommer 2028. Danach: Phase 5, Agenturaufbau, Entscheidung Studium vs. Vollzeit.',
   'Das eigentliche Ziel dieser Phase.'],
 ]],
]},
];

// --- Wochenrhythmus ---------------------------------------------------
// Zwei Modi: normal (Mo–Sa) und klausur (nur das Nötigste).
export const WEEK_NORMAL=[['Mo','Akquise — 5 Kontakte recherchiert und angeschrieben'],['Di','Kundenarbeit'],['Mi','Lernen — ein Modul-Block'],['Do','Kundenarbeit'],['Fr','Personal Brand — 3 Posts fertig und geplant'],['Sa','Produktion — Auto-Shoot oder Kundendreh (alle 1–2 Wochen)']];
export const WEEK_KLAUSUR=[['Di','Kundenarbeit'],['Do','Kundenarbeit'],['Fr','1 Post']];
