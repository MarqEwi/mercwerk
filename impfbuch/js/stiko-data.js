/*
 * STIKO-Impfschema (Standardimpfungen) — orientiert am Impfkalender der
 * Ständigen Impfkommission (RKI).
 *
 * STAND: Impfkalender 2026 (Epid. Bulletin 4/2026 vom 22.01.2026), inklusive
 * der COVID-19-Aktualisierung vom 09.07.2026 (Epid. Bulletin 28/2026) und der
 * Meningokokken-Änderung vom 30.10.2025. Reise-/Indikationsimpfungen nach
 * Epid. Bulletin 27/2026 (STIKO und DTG).
 *
 * PFLEGEHINWEIS: Die STIKO aktualisiert ihre Empfehlungen jährlich im Januar
 * (Epidemiologisches Bulletin) und zusätzlich unterjährig. Dieses Schema
 * deshalb mindestens einmal im Jahr gegen die Originalquellen prüfen — die
 * Links dazu stehen in SOURCES und werden im Info-Fenster angezeigt.
 *
 * Wie im echten Impfausweis ist JEDE Krankheit eine eigene Zeile (z. B. Tetanus,
 * Pertussis, Poliomyelitis). Kombinationsimpfstoffe (6-fach, Tdap-IPV, MMRV …)
 * werden als Voreinstellung angeboten und füllen mehrere Zeilen auf einmal.
 *
 * Alle Altersangaben in MONATEN (Jahre * 12).
 *
 * Feld-Modell je Impfung:
 *   id, name, fullName, group, info
 *   series    Grundserie: [{ label, ageMonths, note }]
 *   booster   optional wiederkehrende Auffrischung { intervalYears, fromAgeMonths, label, note }
 *   annual    optional jährliche Impfung { fromAgeMonths, seasonNote }
 *   adultOnly true → erst im Erwachsenenalter relevant
 *   onDemand  true → Indikations-/Reiseimpfung: erzeugt KEINE Fälligkeit „aus dem
 *             Nichts". Erst wenn eine Serie begonnen wurde, wird an die Folgedosis
 *             erinnert. Ohne Eintrag Status „Bei Bedarf".
 *   riskNote  optional Hinweis zur Indikation
 *   ageInfo   Klartext: für wen und in welchem Alter empfohlen (Info-Fenster)
 *   source    Schlüssel aus SOURCES → Quellenangabe im Info-Fenster
 *   noBooster Begründung, warum die App KEINE Auffrischung anzeigt
 *   retired   true → Empfehlung wurde zurückgezogen; bleibt dokumentierbar,
 *             wird aber nicht mehr als fällig angezeigt (mit Begründung)
 */

const MONTH = 1;
const YEAR = 12;

/*
 * Amtliche Quellen. Alle URLs vor Aufnahme auf Erreichbarkeit geprüft; das RKI
 * ändert seine Adressen gelegentlich — bei der jährlichen Pflege mitprüfen.
 */
const SOURCES = {
  kalender: {
    label: "RKI — STIKO-Impfkalender",
    url: "https://www.rki.de/DE/Themen/Infektionskrankheiten/Impfen/Impfkalender/impfkalender-node.html",
  },
  stiko: {
    label: "RKI — Empfehlungen der STIKO",
    url: "https://www.rki.de/DE/Themen/Infektionskrankheiten/Impfen/Staendige-Impfkommission/Empfehlungen-der-STIKO/empfehlungen-der-stiko-node.html",
  },
  reise: {
    label: "RKI — Reiseimpfempfehlungen (STIKO/DTG)",
    url: "https://www.rki.de/DE/Themen/Infektionskrankheiten/Impfen/Staendige-Impfkommission/Reiseimpfungen/reiseimpfungen-node.html",
  },
  meningokokken: {
    label: "RKI — Meningokokken-Impfempfehlung (Stand 30.10.2025)",
    url: "https://www.rki.de/SharedDocs/FAQs/DE/Impfen/Meningokokken/FAQ_MenACWY_Impfempfehlung.html",
  },
  meningokokken_b: {
    label: "RKI — Meningokokken-B-Impfempfehlung (Stand 30.10.2025)",
    url: "https://www.rki.de/SharedDocs/FAQs/DE/Impfen/Meningokokken/FAQ_MenB_Impfempfehlung.html",
  },
  covid: {
    label: "RKI — COVID-19-Impfung (Stand 09.07.2026)",
    url: "https://www.rki.de/DE/Themen/Infektionskrankheiten/Impfen/Impfungen-A-Z/COVID-19/covid-19-node.html",
  },
  rsv: {
    label: "RKI — RSV-Prophylaxe",
    url: "https://www.rki.de/DE/Themen/Infektionskrankheiten/Impfen/Impfungen-A-Z/RSV/rsv-node.html",
  },
};

const GROUPS = {
  basis: { label: "Grundimmunisierung (ab Säuglingsalter)", color: "#a62d20" },
  kind: { label: "Kindesalter", color: "#b35c09" },
  jugend: { label: "Jugendalter", color: "#8e44ad" },
  senior: { label: "Ab 60 Jahren", color: "#2c3e50" },
  indikation: { label: "Indikations-/Reiseimpfung", color: "#5b6768" },
  speziell: { label: "Spezielle Impfungen (Reise & Beruf)", color: "#6d4c41" },
  historisch: { label: "Früher übliche Impfungen", color: "#7a6a55" },
};

// Standard-Grundserie eines Säuglings (2+1-Schema).
const INFANT_SERIES = [
  { label: "1. Dosis", ageMonths: 2 * MONTH },
  { label: "2. Dosis", ageMonths: 4 * MONTH },
  { label: "3. Dosis", ageMonths: 11 * MONTH },
];

const STIKO_SCHEDULE = [
  /* ---------------------------- Grundimmunisierung (ab Säuglingsalter) --- */
  {
    id: "rsv_saeugling",
    name: "RSV-Schutz (Säugling)",
    fullName: "RSV-Prophylaxe mit Antikörpern (Nirsevimab)",
    group: "basis",
    info:
      "Kein Impfstoff, sondern eine einmalige Gabe fertiger Antikörper " +
      "(Nirsevimab). Sie schützt Neugeborene und Säuglinge in ihrer ersten " +
      "RSV-Saison — RS-Viren sind der häufigste Grund für " +
      "Krankenhausaufenthalte im ersten Lebensjahr.",
    diseaseTitle: "Was sind RS-Viren?",
    disease:
      "RS-Viren lösen Erkältungen und Atemwegsinfekte aus. Sie " +
      "verbreiten sich über Tröpfchen beim Husten und Niesen sowie über " +
      "Hände und Oberflächen. Fast alle Kinder stecken sich in den " +
      "ersten beiden Lebensjahren an; bei Säuglingen können die kleinen " +
      "Atemwege dabei anschwellen.",
    ageInfo:
      "Einmalig für alle Neugeborenen und Säuglinge in der ersten RSV-Saison " +
      "(Herbst/Winter). Versäumtes bis zum 1. Geburtstag nachholen.",
    noBooster:
      "Der Schutz ist nur für die erste RSV-Saison vorgesehen; danach ist keine " +
      "weitere Gabe empfohlen.",
    source: "rsv",
    series: [
      { label: "1 Gabe", ageMonths: 0, note: "1. RSV-Saison, meist Okt.–März" },
    ],
  },
  {
    id: "rotaviren",
    name: "Rotaviren",
    fullName: "Rotavirus-Gastroenteritis (Schluckimpfung)",
    group: "basis",
    info: "Erste Dosis ab einem Alter von 6 Wochen, Impfserie früh abschließen.",
    diseaseTitle: "Was sind Rotaviren?",
    disease:
      "Rotaviren verursachen Brechdurchfall bei Säuglingen und " +
      "Kleinkindern. Sie sind sehr ansteckend und werden über Spuren " +
      "von Stuhl an Händen, Spielzeug oder Lebensmitteln übertragen.",
    ageInfo:
      "Beginn ab 6 Wochen, möglichst bis zum Alter von 12 Wochen. Je nach " +
      "Impfstoff 2 oder 3 Schluckdosen. Die Serie muss spätestens mit 24 " +
      "bzw. 32 Wochen abgeschlossen sein — danach ist die Impfung nicht " +
      "mehr zugelassen.",
    source: "kalender",
    series: [
      { label: "1. Dosis", ageMonths: 1.5 * MONTH, note: "ab 6 Wochen" },
      { label: "2. Dosis", ageMonths: 3 * MONTH },
      { label: "3. Dosis", ageMonths: 4 * MONTH, note: "je nach Impfstoff" },
    ],
  },
  {
    id: "tetanus",
    name: "Tetanus",
    fullName: "Wundstarrkrampf (Tetanus)",
    group: "basis",
    info: "Grundimmunisierung als Säugling, Auffrischungen im Kindes-/Jugendalter, danach alle 10 Jahre.",
    diseaseTitle: "Was ist Wundstarrkrampf?",
    disease:
      "Die Bakterien stecken in Erde und Staub und gelangen über Wunden " +
      "in den Körper — oft über kleine Verletzungen bei der " +
      "Gartenarbeit. Ihr Gift führt zu schmerzhaften Muskelkrämpfen. " +
      "Von Mensch zu Mensch ist die Krankheit nicht übertragbar.",
    ageInfo:
      "Als Säugling mit 2, 4 und 11 Monaten (Sechsfach-Impfung). Frühgeborene erhalten eine zusätzliche Dosis mit 3 Monaten, also vier insgesamt. Auffrischungen mit 5–6 und 9–16 Jahren, danach lebenslang alle 10 Jahre.",
    source: "kalender",
    series: [
      { label: "1. Dosis", ageMonths: 2 * MONTH },
      { label: "2. Dosis", ageMonths: 4 * MONTH },
      { label: "3. Dosis", ageMonths: 11 * MONTH },
      { label: "Auffr. Vorschule", ageMonths: 5 * YEAR, note: "5–6 J. (Tdap)" },
      { label: "Auffr. Jugend", ageMonths: 9 * YEAR, note: "9–16 J. (Tdap-IPV)" },
    ],
    booster: {
      intervalYears: 10,
      fromAgeMonths: 18 * YEAR,
      label: "Auffrischung",
      note: "alle 10 Jahre (1× als Tdap)",
    },
  },
  {
    id: "diphtherie",
    name: "Diphtherie",
    fullName: "Diphtherie",
    group: "basis",
    info: "Grundimmunisierung als Säugling, Auffrischungen im Kindes-/Jugendalter, danach alle 10 Jahre.",
    diseaseTitle: "Was ist Diphtherie?",
    disease:
      "Eine bakterielle Infektion vor allem im Hals- und Rachenraum, " +
      "die über Tröpfchen beim Husten und Sprechen weitergegeben wird. " +
      "Das Bakteriengift kann auch Herz und Nerven belasten.",
    ageInfo:
      "Als Säugling mit 2, 4 und 11 Monaten (Sechsfach-Impfung). Frühgeborene erhalten eine zusätzliche Dosis mit 3 Monaten, also vier insgesamt. Auffrischungen mit 5–6 und 9–16 Jahren, danach lebenslang alle 10 Jahre — meist zusammen mit Tetanus.",
    source: "kalender",
    series: [
      { label: "1. Dosis", ageMonths: 2 * MONTH },
      { label: "2. Dosis", ageMonths: 4 * MONTH },
      { label: "3. Dosis", ageMonths: 11 * MONTH },
      { label: "Auffr. Vorschule", ageMonths: 5 * YEAR, note: "5–6 J. (Tdap)" },
      { label: "Auffr. Jugend", ageMonths: 9 * YEAR, note: "9–16 J. (Tdap-IPV)" },
    ],
    booster: {
      intervalYears: 10,
      fromAgeMonths: 18 * YEAR,
      label: "Auffrischung",
      note: "alle 10 Jahre (1× als Tdap)",
    },
  },
  {
    id: "pertussis",
    name: "Pertussis (Keuchhusten)",
    fullName: "Keuchhusten (Pertussis)",
    group: "basis",
    info: "Grundimmunisierung als Säugling, Auffrischungen im Kindes-/Jugendalter; im Erwachsenenalter einmalig mit der nächsten Td-Auffrischung (als Tdap).",
    diseaseTitle: "Was ist Keuchhusten?",
    disease:
      "Eine bakterielle Infektion der Atemwege mit wochenlangen, " +
      "anfallsartigen Hustenattacken. Sie ist hoch ansteckend und wird " +
      "über Tröpfchen übertragen — Erwachsene stecken oft unbemerkt " +
      "Säuglinge an.",
    ageInfo:
      "Als Säugling mit 2, 4 und 11 Monaten (Sechsfach-Impfung). Frühgeborene erhalten eine zusätzliche Dosis mit 3 Monaten, also vier insgesamt. Auffrischungen mit 5–6 und 9–16 Jahren. Erwachsene frischen einmalig zusammen mit der nächsten Tetanus-Impfung auf. Schwangere sollen in jeder Schwangerschaft im letzten Drittel geimpft werden.",
    source: "kalender",
    series: [
      { label: "1. Dosis", ageMonths: 2 * MONTH },
      { label: "2. Dosis", ageMonths: 4 * MONTH },
      { label: "3. Dosis", ageMonths: 11 * MONTH },
      { label: "Auffr. Vorschule", ageMonths: 5 * YEAR, note: "5–6 J. (Tdap)" },
      { label: "Auffr. Jugend", ageMonths: 9 * YEAR, note: "9–16 J. (Tdap-IPV)" },
    ],
  },
  {
    id: "poliomyelitis",
    name: "Poliomyelitis",
    fullName: "Kinderlähmung (Poliomyelitis)",
    group: "basis",
    info: "Grundimmunisierung als Säugling, Auffrischung im Jugendalter. Im Erwachsenenalter nur bei Reisen in Endemiegebiete auffrischen.",
    diseaseTitle: "Was ist Kinderlähmung?",
    disease:
      "Viren, die über verunreinigtes Wasser oder Spuren von Stuhl " +
      "aufgenommen werden. Meist verläuft die Infektion harmlos, in " +
      "seltenen Fällen kommt es zu bleibenden Lähmungen.",
    ageInfo:
      "Grundimmunisierung als Säugling (2, 4, 11 Monate), eine Auffrischung " +
      "im Alter von 9–16 Jahren. Fehlendes ist lebenslang nachholbar.",
    noBooster:
      "Nach der Auffrischung im Jugendalter sind in Deutschland keine " +
      "weiteren nötig. Die 10-Jahres-Regel gilt nur für Reisen in " +
      "Risikoländer und bestimmte Berufe.",
    source: "kalender",
    series: [
      { label: "1. Dosis", ageMonths: 2 * MONTH },
      { label: "2. Dosis", ageMonths: 4 * MONTH },
      { label: "3. Dosis", ageMonths: 11 * MONTH },
      { label: "Auffr. Jugend", ageMonths: 9 * YEAR, note: "9–16 J. (Tdap-IPV)" },
    ],
  },
  {
    id: "hib",
    name: "Haemophilus infl. b (Hib)",
    fullName: "Haemophilus influenzae Typ b",
    group: "basis",
    info: "Nur im Säuglingsalter nötig (Teil der 6-fach-Impfung).",
    diseaseTitle: "Was ist Hib?",
    disease:
      "Haemophilus influenzae Typ b sind Bakterien, die über Tröpfchen " +
      "übertragen werden. Bei kleinen Kindern können sie eine Hirnhaut- " +
      "oder Kehldeckelentzündung auslösen.",
    ageInfo:
      "Als Säugling mit 2, 4 und 11 Monaten (Sechsfach-Impfung). Frühgeborene erhalten eine zusätzliche Dosis mit 3 Monaten, also vier insgesamt. Ab 5 Jahren ist die Impfung bei gesunden Kindern nicht mehr nötig.",
    source: "kalender",
    series: INFANT_SERIES.map((d) => ({ ...d })),
  },
  {
    id: "hepatitis_b",
    name: "Hepatitis B",
    fullName: "Hepatitis B",
    group: "basis",
    info: "Bei Kindern in der 6-fach-Impfung enthalten; für Erwachsene mit erhöhtem Risiko nachholbar.",
    diseaseTitle: "Was ist Hepatitis B?",
    disease:
      "Eine Virusinfektion der Leber. Übertragen wird sie über Blut und " +
      "andere Körperflüssigkeiten, auch bei der Geburt von der Mutter " +
      "auf das Kind. Bei Säuglingen wird sie besonders oft chronisch.",
    ageInfo:
      "Als Säugling mit 2, 4 und 11 Monaten (Sechsfach-Impfung). Frühgeborene erhalten eine zusätzliche Dosis mit 3 Monaten, also vier insgesamt. Versäumtes wird bis zum 18. Geburtstag nachgeholt. Für Erwachsene ist es dann keine Standard-, sondern eine Indikationsimpfung (z. B. bei bestimmten Berufen).",
    source: "kalender",
    series: INFANT_SERIES.map((d) => ({ ...d })),
  },
  {
    id: "pneumokokken_kind",
    name: "Pneumokokken (Säugling)",
    fullName: "Pneumokokken-Konjugatimpfstoff (PCV)",
    group: "basis",
    info: "Grundimmunisierung im Säuglingsalter (2+1-Schema).",
    diseaseTitle: "Was sind Pneumokokken?",
    disease:
      "Bakterien, die viele Menschen im Nasen-Rachen-Raum tragen und " +
      "über Tröpfchen weitergeben. Sie können Mittelohr-, Lungen- und " +
      "Hirnhautentzündungen verursachen.",
    ageInfo:
      "Mit 2, 4 und 11 Monaten (Frühgeborene zusätzlich mit 3 Monaten). Ab 24 Monaten ist die Impfung nicht mehr als Standardimpfung empfohlen und wird auch nicht nachgeholt.",
    source: "kalender",
    series: INFANT_SERIES.map((d) => ({ ...d })),
  },
  {
    id: "meningokokken_b",
    name: "Meningokokken B",
    fullName: "Meningokokken der Serogruppe B",
    group: "basis",
    info: "Seit 2024 als Standardimpfung empfohlen.",
    diseaseTitle: "Was sind Meningokokken?",
    disease:
      "Bakterien, die über Tröpfchen und engen Kontakt übertragen " +
      "werden. Sie sind selten, können aber innerhalb von Stunden eine " +
      "Hirnhautentzündung oder Blutvergiftung auslösen. Die Gruppe B " +
      "ist in Deutschland die häufigste.",
    ageInfo:
      "Mit 2, 4 und 12 Monaten. Versäumtes soll spätestens bis zum 5. Geburtstag nachgeholt werden; danach besteht keine Standardempfehlung mehr.",
    source: "meningokokken_b",
    series: [
      { label: "1. Dosis", ageMonths: 2 * MONTH },
      { label: "2. Dosis", ageMonths: 4 * MONTH },
      { label: "3. Dosis", ageMonths: 12 * MONTH },
    ],
  },

  /* --------------------------------------------------------- Kindesalter -- */
  {
    id: "meningokokken_c",
    name: "Meningokokken C",
    fullName: "Meningokokken der Serogruppe C",
    group: "kind",
    retired: true,
    info:
      "Diese Impfung wird seit Oktober 2025 nicht mehr als Standardimpfung " +
      "empfohlen. Erkrankungen durch die Serogruppe C sind in Deutschland sehr " +
      "selten geworden. An ihre Stelle ist die Impfung gegen Meningokokken " +
      "ACWY mit 12–14 Jahren getreten.",
    diseaseTitle: "Was sind Meningokokken?",
    disease:
      "Bakterien, die über Tröpfchen und engen Kontakt übertragen " +
      "werden und eine Hirnhautentzündung oder Blutvergiftung auslösen " +
      "können. Erkrankungen durch die Gruppe C sind in Deutschland " +
      "inzwischen sehr selten.",
    ageInfo:
      "Früher: einmalig im 2. Lebensjahr. Heute keine Standardimpfung mehr — " +
      "bereits erhaltene Impfungen bleiben hier dokumentiert.",
    noBooster:
      "Die App zeigt hierzu keine Fälligkeit mehr an, weil die STIKO diese " +
      "Impfung nicht mehr empfiehlt. Wer sie als Kind erhalten hat, braucht " +
      "nichts weiter zu tun.",
    source: "meningokokken",
    series: [{ label: "1 Dosis", ageMonths: 12 * MONTH }],
  },
  {
    id: "mmr",
    name: "Masern-Mumps-Röteln",
    fullName: "Masern, Mumps, Röteln (MMR)",
    group: "kind",
    info: "Zwei Dosen; für nach 1970 Geborene ohne ausreichenden Schutz empfohlen.",
    diseaseTitle: "Was sind Masern, Mumps und Röteln?",
    disease:
      "Drei Virusinfektionen. Masern sind extrem ansteckend und " +
      "verbreiten sich über die Luft — auch ohne direkten Kontakt. " +
      "Mumps und Röteln werden über Tröpfchen übertragen; Röteln sind " +
      "vor allem in der Schwangerschaft gefährlich.",
    ageInfo:
      "Zwei Dosen mit 11 und 15 Monaten (Mindestabstand 4 Wochen). Es gibt KEINE obere Altersgrenze: Fehlendes kann in jedem Alter nachgeholt werden. Alle nach 1970 Geborenen ab 18 Jahren mit unklarem Impfstatus sollen einmalig eine MMR-Impfung erhalten.",
    source: "kalender",
    series: [
      { label: "1. Dosis", ageMonths: 11 * MONTH },
      { label: "2. Dosis", ageMonths: 15 * MONTH, note: "Mindestabstand 4 Wochen" },
    ],
  },
  {
    id: "varizellen",
    name: "Varizellen",
    fullName: "Windpocken (Varizellen)",
    group: "kind",
    info: "Zwei Dosen, meist parallel zur MMR-Impfung.",
    diseaseTitle: "Was sind Windpocken?",
    disease:
      "Eine sehr ansteckende Virusinfektion mit juckendem Ausschlag, " +
      "die schon über die Luft übertragen wird. Das Virus bleibt danach " +
      "lebenslang im Körper und kann Jahrzehnte später als Gürtelrose " +
      "zurückkehren.",
    ageInfo:
      "Zwei Dosen mit 11 und 15 Monaten. Bei Kindern und Jugendlichen ohne " +
      "Windpocken-Erkrankung jederzeit nachholbar. Als Standardimpfung für " +
      "Erwachsene nicht mehr vorgesehen — deshalb blendet die App sie ab 18 " +
      "aus.",
    noBooster:
      "Für Erwachsene gibt es keine Standardempfehlung mehr. Sie kann aber " +
      "bei besonderem Anlass sinnvoll sein — etwa bei Kinderwunsch ohne " +
      "durchgemachte Windpocken, vor einer Therapie, die das Immunsystem " +
      "unterdrückt, oder im Gesundheitsdienst. Das klärt am besten deine " +
      "Ärztin oder dein Arzt. Über die Schaltfläche „Trotzdem einblenden“ " +
      "holst du die Impfung jederzeit zurück in die Liste.",
    source: "kalender",
    series: [
      { label: "1. Dosis", ageMonths: 11 * MONTH },
      { label: "2. Dosis", ageMonths: 15 * MONTH },
    ],
  },

  /* --------------------------------------------------------- Jugendalter -- */
  {
    id: "hpv",
    name: "HPV",
    fullName: "Humane Papillomviren",
    group: "jugend",
    info: "Für alle Jugendlichen; 2 Dosen bei Beginn im Alter von 9–14 Jahren.",
    diseaseTitle: "Was sind humane Papillomviren?",
    disease:
      "Sehr verbreitete Viren, die beim Haut- und Schleimhautkontakt " +
      "übertragen werden, meist beim Sex. Die meisten Infektionen " +
      "heilen von selbst; manche Virustypen können nach Jahren Krebs " +
      "auslösen — etwa am Gebärmutterhals, aber auch bei Männern.",
    ageInfo:
      "Für alle Kinder und Jugendlichen von 9 bis 14 Jahren — Mädchen wie " +
      "Jungen. In diesem Alter genügen 2 Dosen im Abstand von mindestens 5 " +
      "Monaten. Wer erst mit 15 Jahren oder später beginnt, braucht 3 Dosen. " +
      "Versäumtes bis zum 18. Geburtstag nachholen.",
    source: "kalender",
    series: [
      { label: "1. Dosis", ageMonths: 9 * YEAR, note: "ab 9 Jahren" },
      { label: "2. Dosis", ageMonths: 9 * YEAR + 6 * MONTH, note: "Abstand 5 Monate" },
    ],
  },

  /* -------------------------------------------------------- Ab 60 Jahren -- */
  {
    id: "influenza",
    name: "Influenza (Grippe)",
    fullName: "Saisonale Influenza",
    group: "senior",
    info: "Jährlich für Personen ab 60 Jahren (Impfung im Herbst).",
    diseaseTitle: "Was ist die echte Grippe?",
    disease:
      "Eine Virusinfektion, die über Tröpfchen in der Luft übertragen " +
      "wird. Anders als eine Erkältung beginnt sie meist plötzlich mit " +
      "hohem Fieber. Die Viren verändern sich jedes Jahr, deshalb wird " +
      "jährlich neu geimpft.",
    ageInfo:
      "Jährlich ab 60 Jahren, am besten im Herbst. Für Schwangere, chronisch Kranke und medizinisches Personal gilt sie unabhängig vom Alter. Ab 60 wird ein Hochdosis-Impfstoff verwendet.",
    source: "kalender",
    annual: { fromAgeMonths: 60 * YEAR, seasonNote: "am besten Okt.–Dez." },
    adultOnly: true,
  },
  {
    id: "pneumokokken_senior",
    name: "Pneumokokken (ab 60)",
    fullName: "Pneumokokken-Impfung im Alter",
    group: "senior",
    info: "Einmalige Impfung für Personen ab 60 Jahren.",
    diseaseTitle: "Was sind Pneumokokken?",
    disease:
      "Bakterien, die über Tröpfchen übertragen werden und vor allem im " +
      "höheren Alter Lungenentzündungen verursachen können.",
    ageInfo:
      "Einmalig ab 60 Jahren mit dem 20-fach-Konjugatimpfstoff (PCV20).",
    noBooster:
      "Für den heutigen Impfstoff gibt es noch keine Empfehlung zur " +
      "Wiederholung — die App erinnert deshalb nicht daran.",
    source: "kalender",
    series: [{ label: "1 Dosis", ageMonths: 60 * YEAR }],
    adultOnly: true,
  },
  {
    id: "herpes_zoster",
    name: "Herpes zoster (Gürtelrose)",
    fullName: "Herpes zoster — Totimpfstoff",
    group: "senior",
    info: "Zwei Dosen für Personen ab 60 Jahren (Abstand 2–6 Monate).",
    diseaseTitle: "Was ist Gürtelrose?",
    disease:
      "Sie entsteht, wenn das Windpocken-Virus nach Jahrzehnten im " +
      "Körper wieder aktiv wird — meist an einer Körperhälfte als " +
      "schmerzhafter Ausschlag. Die Nervenschmerzen können lange " +
      "anhalten.",
    ageInfo:
      "Zwei Dosen ab 60 Jahren im Abstand von 2–6 Monaten. Bei Immunschwäche oder schweren chronischen Erkrankungen schon ab 18 Jahren.",
    source: "kalender",
    series: [
      { label: "1. Dosis", ageMonths: 60 * YEAR },
      { label: "2. Dosis", ageMonths: 60 * YEAR + 2 * MONTH, note: "Abstand 2–6 Monate" },
    ],
    adultOnly: true,
  },
  {
    id: "covid",
    name: "COVID-19",
    fullName: "COVID-19-Auffrischimpfung",
    group: "senior",
    info:
      "Seit Juli 2026 als Standardimpfung jährlich ab 75 Jahren empfohlen. " +
      "Die frühere Empfehlung, zunächst eine Basisimmunität aufzubauen, ist " +
      "entfallen.",
    diseaseTitle: "Was ist COVID-19?",
    disease:
      "Eine Infektion mit Coronaviren, die über Tröpfchen und feine " +
      "Schwebeteilchen in der Luft übertragen wird, besonders in " +
      "Innenräumen.",
    ageInfo:
      "Jährlich ab 75 Jahren. Für Menschen mit Vorerkrankungen oder erhöhtem " +
      "Risiko gilt die Empfehlung unabhängig vom Alter — bitte ärztlich klären.",
    source: "covid",
    annual: {
      fromAgeMonths: 75 * YEAR,
      seasonNote: "Spätsommer/Frühherbst, zum Saisonbeginn",
    },
    adultOnly: true,
  },
  {
    id: "rsv_senior",
    name: "RSV (ab 75)",
    fullName: "Respiratorische Synzytial-Viren (RSV)",
    group: "senior",
    info:
      "Einmalige Impfung gegen RS-Viren für alle ab 75 Jahren. RSV verläuft im " +
      "höheren Alter häufig schwer.",
    diseaseTitle: "Was sind RS-Viren?",
    disease:
      "Erreger von Atemwegsinfekten, die über Tröpfchen und Hände " +
      "übertragen werden. Im höheren Alter können sie zu schweren " +
      "Verläufen führen und bestehende Herz- oder Lungenerkrankungen " +
      "verschlechtern.",
    ageInfo:
      "Einmalig ab 75 Jahren, möglichst im Spätsommer oder Herbst vor der " +
      "RSV-Saison. Zwischen 60 und 74 Jahren bei schweren Vorerkrankungen oder " +
      "in Pflegeeinrichtungen — dann ärztlich klären.",
    noBooster:
      "Ob eine Wiederholung nötig ist, lässt sich nach heutiger Datenlage noch " +
      "nicht sagen. Die App erinnert deshalb bewusst nicht an eine Auffrischung.",
    source: "rsv",
    series: [
      { label: "1 Dosis", ageMonths: 75 * YEAR, note: "Spätsommer/Herbst" },
    ],
    adultOnly: true,
  },

  /* ----------------------------------------------- Indikations-/Reise ---- */
  {
    id: "fsme",
    name: "FSME (Zecken)",
    fullName: "Frühsommer-Meningoenzephalitis",
    group: "indikation",
    info: "Bei Aufenthalt in Risikogebieten; nach Grundimmunisierung Auffrischung alle 3–5 Jahre.",
    diseaseTitle: "Was ist FSME?",
    disease:
      "Ein Virus, das durch Zeckenstiche übertragen wird und Hirnhaut " +
      "und Gehirn entzünden kann. Es kommt nur in bestimmten Regionen " +
      "vor — in Deutschland vor allem im Süden. Nicht jede Zecke trägt " +
      "das Virus.",
    ageInfo:
      "Ab 12 Monaten, empfohlen bei Aufenthalt in Risikogebieten. Drei Dosen: " +
      "die zweite nach 1–3 Monaten, die dritte je nach Impfstoff 5–12 Monate " +
      "später.",
    noBooster:
      "Erste Auffrischung 3 Jahre nach der Grundimmunisierung, danach meist " +
      "alle 5 Jahre. Ab 50 bzw. 60 Jahren wieder alle 3 Jahre.",
    source: "reise",
    series: [
      { label: "1. Dosis", ageMonths: 12 * MONTH },
      { label: "2. Dosis", ageMonths: 13 * MONTH, note: "Abstand 1–3 Monate" },
      { label: "3. Dosis", ageMonths: 17 * MONTH, note: "Abstand 5–12 Monate" },
    ],
    onDemand: true,
    riskNote: "Nur bei Aufenthalt in Risikogebieten empfohlen.",
  },
  {
    id: "hepatitis_a",
    name: "Hepatitis A",
    fullName: "Hepatitis A (Reise-/Indikationsimpfung)",
    group: "indikation",
    info: "Vor Reisen in Regionen mit erhöhtem Risiko; zweite Dosis für langjährigen Schutz.",
    diseaseTitle: "Was ist Hepatitis A?",
    disease:
      "Eine Virusinfektion der Leber, die über verunreinigtes Wasser, " +
      "Lebensmittel oder Spuren von Stuhl an Händen übertragen wird. " +
      "Typisch für Reisen in Länder mit einfacheren hygienischen " +
      "Verhältnissen.",
    ageInfo:
      "Ab 12 Monaten. Zwei Dosen im Abstand von 6–12 Monaten geben " +
      "langjährigen Schutz.",
    noBooster:
      "Nach zwei Dosen besteht sehr langer Schutz; ob überhaupt eine " +
      "Auffrischung nötig ist, ist offiziell nicht geklärt. Die App nennt " +
      "deshalb keine Frist.",
    source: "reise",
    series: [
      { label: "1. Dosis", ageMonths: 12 * MONTH },
      { label: "2. Dosis", ageMonths: 18 * MONTH, note: "Abstand 6–12 Monate" },
    ],
    onDemand: true,
    riskNote: "Keine allgemeine Standardimpfung — v. a. für Reisende und Risikogruppen.",
  },

  /* -------------------------------- Spezielle Impfungen (Reise & Beruf) -- */
  {
    id: "gelbfieber",
    name: "Gelbfieber",
    fullName: "Gelbfieber (Yellow Fever)",
    group: "speziell",
    info: "Für viele Länder Pflicht (Nachweis im gelben Ausweis). Meist lebenslanger Schutz nach einer Impfung; nur in zugelassenen Gelbfieber-Impfstellen.",

    diseaseTitle: "Was ist Gelbfieber?",
    disease:
      "Eine Virusinfektion, die von Mücken übertragen wird und in " +
      "Teilen Afrikas und Südamerikas vorkommt. Schwere Verläufe " +
      "belasten Leber und Nieren.",
    ageInfo:
      "Ab 9 Monaten. Eine Dosis genügt. Unter 6 Monaten darf nicht geimpft " +
      "werden, zwischen 6 und 8 Monaten nur ausnahmsweise.",
    noBooster:
      "Das internationale Impfzertifikat gilt lebenslang — auch bereits " +
      "ausgestellte. Die App zeigt deshalb kein Ablaufdatum an. Vor einer " +
      "erneuten Reise ins Risikogebiet kann nach 10 Jahren einmalig " +
      "aufgefrischt werden; wer als Kleinkind geimpft wurde, schon nach 5 " +
      "Jahren.",
    source: "reise",
    series: [{ label: "1 Dosis", ageMonths: 9 * MONTH, note: "ab 9 Monaten" }],
    onDemand: true,
    riskNote: "Reise-/Pflichtimpfung für Endemiegebiete (Afrika, Südamerika).",
  },
  {
    id: "japanische_enzephalitis",
    name: "Japanische Enzephalitis",
    fullName: "Japanische Enzephalitis (JE)",
    group: "speziell",
    info: "Für Reisen in Endemiegebiete Asiens; Auffrischung vor erneuter Exposition.",
    diseaseTitle: "Was ist Japanische Enzephalitis?",
    disease:
      "Ein Virus, das von Mücken übertragen wird — vor allem in " +
      "ländlichen Gebieten Asiens, oft in der Nähe von Reisfeldern. " +
      "Selten, kann aber das Gehirn entzünden.",
    ageInfo:
      "Ab 2 Monaten. Zwei Dosen im Abstand von 28 Tagen; für Erwachsene von " +
      "18 bis 65 Jahren ist auch ein Schnellschema (Tag 0 und 7) möglich.",
    /* Das RKI beschreibt zwei Auffrischungen: eine nach 12–24 Monaten und
       eine weitere 10 Jahre danach. Was darüber hinaus gilt, sagt keine
       Quelle — deshalb hier ein Hinweis statt einer erfundenen Vorgabe.
       Rechnerisch führt die Gültigkeits-Überwachung den 10-Jahres-Takt fort
       (VALID_YEARS.japanische_enzephalitis). */
    noBooster:
      "Nach den beiden Grunddosen folgt eine Auffrischung nach 12–24 Monaten " +
      "(als 3. Impfung hinterlegt), eine weitere 10 Jahre danach. Für die " +
      "Zeit darüber hinaus gibt es keine ausdrückliche Vorgabe. Die App " +
      "rechnet dann weiter im Abstand von 10 Jahren, sobald du die " +
      "Gültigkeit überwachen lässt. Bei anhaltendem Risiko vor der Reise " +
      "ärztlich beraten lassen.",
    source: "reise",
    series: [
      { label: "1. Dosis", ageMonths: 12 * MONTH },
      { label: "2. Dosis", ageMonths: 12 * MONTH + 1 * MONTH, note: "Abstand 28 Tage" },
      {
        label: "1. Auffrischung",
        ageMonths: 12 * MONTH + 18 * MONTH,
        note: "12–24 Monate nach der 2. Dosis",
      },
    ],
    onDemand: true,
    riskNote: "Reiseimpfung für Asien/Pazifik.",
  },
  {
    id: "tollwut",
    name: "Tollwut",
    fullName: "Tollwut (Rabies) — präexpositionell",
    group: "speziell",
    info: "Vorsorgliche Impfung bei Reisen/Tätigkeiten mit Expositionsrisiko (3 Dosen).",
    diseaseTitle: "Was ist Tollwut?",
    disease:
      "Ein Virus, das über den Speichel infizierter Tiere übertragen " +
      "wird, meist durch Biss oder Kratzer — etwa von Hunden, Katzen " +
      "oder Fledermäusen. Sobald Beschwerden auftreten, verläuft sie " +
      "tödlich; eine sofortige Behandlung nach dem Kontakt schützt.",
    ageInfo:
      "Keine Altersgrenze — ab Geburt möglich. Grundimmunisierung mit 3 Dosen " +
      "an Tag 0, 7 und 21 (oder 28). Bei gesunder Immunabwehr ist auch ein " +
      "Kurzschema mit 2 Dosen (Tag 0 und 7) möglich; bei fortbestehendem " +
      "Risiko folgt dann spätestens nach einem Jahr eine dritte Dosis.",
    noBooster:
      "Nach drei Dosen hält der Schutz laut STIKO sehr lange an — deshalb " +
      "erinnert die App nicht an eine Auffrischung. Wichtig: Nach einem Biss " +
      "oder Kratzer ist immer sofort ärztliche Hilfe nötig, auch wenn du " +
      "geimpft bist.",
    source: "reise",
    series: [
      { label: "1. Dosis", ageMonths: 12 * MONTH },
      { label: "2. Dosis", ageMonths: 12 * MONTH + 0.25 * MONTH, note: "Tag 7" },
      { label: "3. Dosis", ageMonths: 12 * MONTH + 0.9 * MONTH, note: "Tag 21–28" },
    ],
    onDemand: true,
    riskNote: "Reise-/Berufsimpfung (z. B. Tierärzte, Endemiegebiete).",
  },
  {
    id: "typhus",
    name: "Typhus",
    fullName: "Typhus abdominalis",
    group: "speziell",
    info: "Reiseimpfung bei erhöhtem Risiko; Schutz ca. 3 Jahre, dann Auffrischung.",
    diseaseTitle: "Was ist Typhus?",
    disease:
      "Eine bakterielle Infektion, die über verunreinigtes Wasser und " +
      "Lebensmittel aufgenommen wird und über Tage steigendes, hohes " +
      "Fieber verursacht.",
    ageInfo:
      "Spritze (Typhim Vi) ab 2 Jahren, Schluckimpfung (Typhoral L) ab 5 " +
      "Jahren. Die Schluckimpfung besteht aus 3 Kapseln an Tag 1, 3 und 5.",
    noBooster:
      "Je nach Impfstoff unterschiedlich: Die Spritze schützt etwa 3 Jahre — " +
      "dieser Wert ist hinterlegt. Bei der Schluckimpfung wird dagegen " +
      "jährlich aufgefrischt.",
    source: "reise",
    series: [{ label: "1 Dosis", ageMonths: 12 * MONTH }],
    onDemand: true,
    riskNote: "Reiseimpfung für Regionen mit mangelnder Hygiene.",
  },
  {
    id: "meningokokken_acwy",
    name: "Meningokokken ACWY",
    fullName: "Meningokokken der Serogruppen A, C, W, Y",
    group: "jugend",
    info:
      "Seit 2026 Standardimpfung für alle Jugendlichen: eine Dosis eines " +
      "Vierfach-Konjugatimpfstoffs im Alter von 12–14 Jahren. Sie ersetzt die " +
      "frühere Meningokokken-C-Impfung im Kleinkindalter.",
    diseaseTitle: "Was sind Meningokokken?",
    disease:
      "Bakterien, die über Tröpfchen und engen Kontakt übertragen " +
      "werden. Sie können plötzlich eine Hirnhautentzündung oder " +
      "Blutvergiftung auslösen. Diese Impfung deckt die vier Gruppen A, " +
      "C, W und Y ab.",
    ageInfo:
      "Einmalig mit 12–14 Jahren, unabhängig vom bisherigen Impfstatus. " +
      "Versäumte Impfungen bis zum 25. Geburtstag nachholen.",
    noBooster:
      "Die STIKO empfiehlt derzeit keine Auffrischung — eine Dosis genügt. " +
      "Für Reisen in Risikogebiete (z. B. Pilgerreise nach Mekka) kann ärztlich " +
      "eine erneute Impfung angeraten werden.",
    source: "meningokokken",
    series: [
      { label: "1 Dosis", ageMonths: 12 * YEAR, note: "12–14 Jahre" },
    ],
    riskNote:
      "Zusätzlich als Reise-/Indikationsimpfung (z. B. Pilgerreisen, Ausbrüche, " +
      "bestimmte Tätigkeiten) — dann ärztlich beraten lassen.",
  },
  {
    id: "cholera",
    name: "Cholera",
    fullName: "Cholera (Schluckimpfung)",
    group: "speziell",
    info: "Reiseimpfung bei erhöhtem Risiko (2 Dosen).",
    diseaseTitle: "Was ist Cholera?",
    disease:
      "Eine bakterielle Infektion aus verunreinigtem Wasser oder " +
      "Lebensmitteln, die zu heftigem, wässrigem Durchfall führt. Sie " +
      "tritt vor allem dort auf, wo sauberes Trinkwasser fehlt.",
    ageInfo:
      "Schluckimpfung ab 2 Jahren. Erwachsene und Kinder ab 6 Jahren: 2 Dosen " +
      "im Abstand von 1–6 Wochen. Kinder von 2 bis unter 6 Jahren brauchen 3 " +
      "Dosen.",
    noBooster:
      "Der hinterlegte Wert von 2 Jahren gilt für Erwachsene; bei Kindern " +
      "unter 6 Jahren sind es 6 Monate. Ist der Schutz abgelaufen, wird die " +
      "Grundimmunisierung komplett wiederholt.",
    source: "reise",
    series: [
      { label: "1. Dosis", ageMonths: 12 * MONTH },
      { label: "2. Dosis", ageMonths: 12 * MONTH + 0.5 * MONTH, note: "Abstand 1–6 Wochen" },
    ],
    onDemand: true,
    riskNote: "Reiseimpfung für Risikogebiete.",
  },

  /* ----------------------------------- Früher übliche Impfungen (Archiv) --
   * Impfungen aus alten Impfausweisen. Sie werden NICHT mehr empfohlen
   * (retired) und erzeugen daher keine Fälligkeit — man soll sie aber
   * eintragen können, damit der Impfpass vollständig ist.
   */
  {
    id: "pocken",
    name: "Pocken",
    fullName: "Pocken (Variola) — historisch",
    group: "historisch",
    retired: true,
    onDemand: true,
    diseaseTitle: "Was waren Pocken?",
    disease:
      "Eine schwere Virusinfektion, die über Tröpfchen und Hautkontakt " +
      "übertragen wurde. Die Pocken gelten seit 1980 weltweit als " +
      "ausgerottet — als bislang einzige Krankheit des Menschen.",
    info:
      "Wird nicht mehr geimpft. In Deutschland bestand bis 1976 eine " +
      "Impfpflicht, 1983 wurde die Impfung ganz eingestellt.",
    ageInfo:
      "Nur zur Dokumentation alter Impfausweise. Erkennbar oft an einer " +
      "runden, leicht eingesunkenen Narbe am Oberarm.",
    noBooster:
      "Die Krankheit gibt es nicht mehr — eine Auffrischung ist weder nötig " +
      "noch vorgesehen.",
    source: "stiko",
    series: [
      { label: "Erstimpfung", ageMonths: 12 * MONTH },
      { label: "Wiederimpfung", ageMonths: 6 * YEAR },
    ],
  },
  {
    id: "bcg",
    name: "Tuberkulose (BCG)",
    fullName: "Tuberkulose-Impfung (BCG) — historisch",
    group: "historisch",
    retired: true,
    onDemand: true,
    diseaseTitle: "Was ist Tuberkulose?",
    disease:
      "Eine bakterielle Infektion, die vor allem die Lunge befällt und über " +
      "Tröpfchen beim Husten übertragen wird. In Deutschland ist sie " +
      "selten geworden, weltweit aber weiterhin verbreitet.",
    info:
      "Wird in Deutschland nicht mehr empfohlen. Die STIKO hat die " +
      "BCG-Impfung 1998 zurückgezogen, weil die Tuberkulose hierzulande " +
      "selten ist und der Impfschutz nur begrenzt wirkte.",
    ageInfo:
      "Nur zur Dokumentation alter Impfausweise. Wurde früher meist im " +
      "Säuglingsalter gegeben; erkennbar oft an einer kleinen Narbe am " +
      "Oberarm.",
    noBooster:
      "Da die Impfung nicht mehr empfohlen wird, erinnert die App nicht an " +
      "eine Auffrischung.",
    source: "stiko",
    series: [{ label: "Impfung", ageMonths: 0 }],
  },
  {
    id: "masern_einzeln",
    name: "Masern (einzeln)",
    fullName: "Masern — Einzelimpfung (historisch)",
    group: "historisch",
    retired: true,
    onDemand: true,
    diseaseTitle: "Was sind Masern?",
    disease:
      "Eine extrem ansteckende Virusinfektion, die über die Luft übertragen " +
      "wird — auch ohne direkten Kontakt.",
    info:
      "Vor Einführung der Kombinationsimpfung wurde einzeln gegen Masern " +
      "geimpft. Heute wird immer der Dreifach-Impfstoff (MMR) verwendet.",
    ageInfo:
      "Nur zur Dokumentation alter Impfausweise. Wichtig: Zwei " +
      "dokumentierte Masern-Impfungen gelten als vollständiger Masernschutz " +
      "— auch wenn sie einzeln gegeben wurden. Bei Unsicherheit ärztlich " +
      "klären lassen.",
    source: "kalender",
    series: [
      { label: "1. Dosis", ageMonths: 12 * MONTH },
      { label: "2. Dosis", ageMonths: 6 * YEAR },
    ],
  },
  {
    id: "mumps_einzeln",
    name: "Mumps (einzeln)",
    fullName: "Mumps — Einzelimpfung (historisch)",
    group: "historisch",
    retired: true,
    onDemand: true,
    diseaseTitle: "Was ist Mumps?",
    disease:
      "Eine Virusinfektion, die über Tröpfchen übertragen wird und typisch " +
      "die Ohrspeicheldrüsen anschwellen lässt (Ziegenpeter).",
    info:
      "Wurde früher als Einzelimpfung mit einem Lebendimpfstoff gegeben. " +
      "Heute ist Mumps Teil der Dreifach-Impfung (MMR).",
    ageInfo:
      "Nur zur Dokumentation alter Impfausweise.",
    source: "kalender",
    series: [
      { label: "1. Dosis", ageMonths: 12 * MONTH },
      { label: "2. Dosis", ageMonths: 6 * YEAR },
    ],
  },
  {
    id: "roeteln_einzeln",
    name: "Röteln (einzeln)",
    fullName: "Röteln — Einzelimpfung (historisch)",
    group: "historisch",
    retired: true,
    onDemand: true,
    diseaseTitle: "Was sind Röteln?",
    disease:
      "Eine meist milde Virusinfektion mit Hautausschlag, die über " +
      "Tröpfchen übertragen wird. Gefährlich ist sie vor allem in der " +
      "Schwangerschaft, weil sie das ungeborene Kind schädigen kann.",
    info:
      "Wurde früher einzeln geimpft — vor allem bei Mädchen und jungen " +
      "Frauen. Heute ist Röteln Teil der Dreifach-Impfung (MMR).",
    ageInfo:
      "Nur zur Dokumentation alter Impfausweise. Vor einer Schwangerschaft " +
      "lohnt sich eine ärztliche Prüfung des Rötelnschutzes.",
    source: "kalender",
    series: [
      { label: "1. Dosis", ageMonths: 12 * MONTH },
      { label: "2. Dosis", ageMonths: 6 * YEAR },
    ],
  },
];

/*
 * Kombinationsimpfungen — ein Klick hakt alle abgedeckten Krankheiten ab,
 * sodass nichts doppelt erfasst werden muss.
 */
const COMBINATIONS = [
  {
    id: "6fach",
    name: "6-fach",
    full: "Tetanus-Diphtherie-Keuchhusten-Polio-Hib-Hepatitis B",
    example: "z. B. Hexyon, Infanrix hexa",
    targets: [
      "tetanus",
      "diphtherie",
      "pertussis",
      "poliomyelitis",
      "hib",
      "hepatitis_b",
    ],
  },
  {
    id: "5fach",
    name: "5-fach",
    full: "Tetanus-Diphtherie-Keuchhusten-Polio-Hib",
    example: "z. B. Infanrix-IPV+Hib",
    targets: ["tetanus", "diphtherie", "pertussis", "poliomyelitis", "hib"],
  },
  {
    id: "tdap_ipv",
    name: "Tdap-IPV",
    full: "Tetanus-Diphtherie-Keuchhusten-Polio",
    example: "z. B. Boostrix Polio, Repevax",
    targets: ["tetanus", "diphtherie", "pertussis", "poliomyelitis"],
  },
  {
    id: "tdap",
    name: "Tdap",
    full: "Tetanus-Diphtherie-Keuchhusten",
    example: "z. B. Boostrix",
    targets: ["tetanus", "diphtherie", "pertussis"],
  },
  {
    id: "td",
    name: "Td",
    full: "Tetanus-Diphtherie",
    example: "z. B. Td-pur",
    targets: ["tetanus", "diphtherie"],
  },
  {
    id: "mmrv",
    name: "MMRV",
    full: "Masern-Mumps-Röteln-Windpocken",
    example: "z. B. Priorix-Tetra, ProQuad",
    targets: ["mmr", "varizellen"],
  },
  {
    id: "twinrix",
    name: "Hepatitis A+B",
    full: "Hepatitis A + Hepatitis B",
    example: "z. B. Twinrix",
    targets: ["hepatitis_a", "hepatitis_b"],
  },
];

/*
 * Obere Altersgrenzen: id → Alter in Jahren, ab dem die STIKO die Impfung
 * nicht mehr empfiehlt bzw. ein Nachholen nicht mehr vorsieht. Oberhalb der
 * Grenze wird die Impfung automatisch eingeklappt und erzeugt keine
 * Fälligkeit mehr (bereits dokumentierte Impfungen bleiben sichtbar).
 */
const MAX_AGE_YEARS = {
  // 32 Wochen ≈ 0,62 Jahre — spätester Abschluss der Rotavirus-Serie
  rotaviren: 32 / 52,
  pneumokokken_kind: 2,
  meningokokken_b: 5, // Nachholen bis zum 5. Geburtstag
  hib: 5,
  rsv_saeugling: 1, // nur 1. RSV-Saison, Nachholen bis zum 1. Geburtstag
  hepatitis_b: 18, // Standardimpfung/Nachholen bis unter 18 Jahre
  hpv: 18, // Nachholen bis unter 18 Jahre
  // Standardimpfung nur für Kinder und Jugendliche. Für Erwachsene bleibt
  // sie bei besonderem Anlass möglich (siehe noBooster) — deshalb nur
  // ausblenden, nicht entfernen.
  varizellen: 18,
  meningokokken_acwy: 25, // Nachholen bis unter 25 Jahre
};
// Alter Name, weiterhin exportiert, damit nichts bricht.
const INFANT_ONLY = MAX_AGE_YEARS;

// Nachhol-Hinweise fürs Info-Fenster.
const CATCHUP_NOTES = {
  rotaviren:
    "Nur im Säuglingsalter (bis ca. 6 Monate) möglich – später weder nötig noch nachholbar.",
  hib:
    "Bei gesunden Kindern über 5 Jahren und Erwachsenen in der Regel nicht mehr erforderlich.",
  pneumokokken_kind:
    "Säuglingsimpfung. Für Ältere ist die separate Pneumokokken-Impfung ab 60 Jahren vorgesehen.",
  tetanus:
    "Als Erwachsener jederzeit nachholbar: fehlende Dosen werden ergänzt, danach Auffrischung alle 10 Jahre.",
  diphtherie:
    "Als Erwachsener jederzeit nachholbar: fehlende Dosen werden ergänzt, danach Auffrischung alle 10 Jahre.",
  pertussis:
    "Wird im Erwachsenenalter einmalig mit der nächsten Tetanus-Diphtherie-Auffrischung (als Tdap) nachgeholt.",
  poliomyelitis:
    "Fehlende Grundimmunisierung nachholbar; sonst Auffrischung vor allem vor Reisen in Endemiegebiete.",
  hepatitis_b:
    "Bei fehlender Grundimmunisierung und erhöhtem Risiko nachholbar.",
  meningokokken_b:
    "Nachholen bis zum 5. Geburtstag; danach besteht keine Standardempfehlung mehr.",
  meningokokken_c:
    "Wird nicht mehr nachgeholt — die Empfehlung ist seit Oktober 2025 entfallen. An ihre Stelle tritt Meningokokken ACWY mit 12–14 Jahren.",
  meningokokken_acwy:
    "Versäumte Impfungen bis zum 25. Geburtstag nachholen.",
  rsv_saeugling:
    "Nur für die erste RSV-Saison vorgesehen; spätestens bis zum 1. Geburtstag nachholen.",
  hpv:
    "Nachholen bis zum 18. Geburtstag; bei Impfbeginn ab 15 Jahren sind 3 Dosen nötig.",
  mmr:
    "Für nach 1970 Geborene mit fehlendem oder unklarem Schutz: eine Impfung dringend nachholen (Masernschutz).",
  varizellen:
    "Nachholen für Ungeimpfte ohne durchgemachte Windpocken (z. B. vor Schwangerschaft, med. Personal).",
  hpv:
    "Nachholen bis zum 18. Geburtstag empfohlen; ein späterer Beginn bringt geringeren Nutzen.",
};

// Ungefähre Schutzdauer in Jahren (für die „Gültigkeit überwachen"-Funktion).
// Nur Impfungen mit sinnvoll überwachbarer, endlicher Schutzdauer.
/*
 * Schutzdauer in Jahren für die Gültigkeits-Überwachung.
 *
 * Bewusst NICHT enthalten (Begründung steht je Impfung unter `noBooster` und
 * erscheint im Info-Fenster):
 *   gelbfieber          Impfzertifikat lebenslang gültig (WHO)
 *   meningokokken_acwy  STIKO empfiehlt keine Auffrischung
 *   pneumokokken_senior für PCV20 keine Wiederholungsempfehlung
 *   tollwut             Boosterfähigkeit hält laut STIKO Jahrzehnte an
 *   hepatitis_a         Auffrischbedarf offiziell „unklar" (mind. 10–20 Jahre)
 */
const VALID_YEARS = {
  typhus: 3, // Typhim Vi (Spritze); Schluckimpfung jährlich — siehe Info
  // Nach der 1. Auffrischung (3. Dosis, siehe series) folgt die zweite erst
  // 10 Jahre später. Weitere Auffrischungen sind nicht vorgesehen.
  japanische_enzephalitis: 10,
  cholera: 2, // Dukoral ab 6 Jahren; Kinder 2–6 J.: 6 Monate
  fsme: 3, // 1. Auffrischung nach 3 Jahren, danach 5 Jahre (ab 50/60 J.: 3)
  poliomyelitis: 10, // nur reisebezogen für Risikoländer
};

// Liefert die Kurzbezeichnung einer Impfung anhand ihrer ID.
function vaccineNameById(id) {
  const v = STIKO_SCHEDULE.find((x) => x.id === id);
  return v ? v.name : id;
}

// Für Import in app.js (klassische Skript-Einbindung ohne Module).
window.STIKO = {
  GROUPS,
  STIKO_SCHEDULE,
  COMBINATIONS,
  INFANT_ONLY,
  MAX_AGE_YEARS,
  CATCHUP_NOTES,
  VALID_YEARS,
  SOURCES,
  vaccineNameById,
  MONTH,
  YEAR,
};
