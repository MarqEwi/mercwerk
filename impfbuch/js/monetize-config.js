/*
 * Zentrale Konfiguration für Werbung (AdMob) und Premium-Kauf.
 *
 * ---------------------------------------------------------------------------
 * STAND: VERÖFFENTLICHUNG (scharf geschaltet).
 * Es laufen ECHTE Anzeigen. Niemals selbst auf Anzeigen tippen — Google
 * wertet das als Klickbetrug und sperrt AdMob-Konten (Learning C13).
 * Zum Weiterentwickeln vorübergehend ADS_TESTING/DIAG/DEV_UNLOCK auf true.
 * ---------------------------------------------------------------------------
 */
window.MONETIZE = {
  /* ------------------------------------------------------------- Werbung */
  // false = ECHTE Anzeigen (Release). true = Google-Test-Anzeigen.
  ADS_TESTING: false,

  // AdMob-App-ID steht im AndroidManifest (Learning C9), NICHT hier.
  //   Aktiv im Manifest: ca-app-pub-7311552668399418~3802208270 (echt)
  //   Test-App-ID (nur zum Entwickeln): ca-app-pub-3940256099942544~3347511713

  // Banner-Anzeigenblock-IDs (Android)
  BANNER_ID_TEST: "ca-app-pub-3940256099942544/6300978111",
  BANNER_ID_REAL: "ca-app-pub-7311552668399418/8655079709",

  bannerId() {
    return this.ADS_TESTING ? this.BANNER_ID_TEST : this.BANNER_ID_REAL;
  },

  /* -------------------------------------------------------- Premium-Kauf */
  // Produkt-ID (unveränderbar, muss exakt der Play-Console-Eingabe entsprechen,
  // Learning E20). Unterstrich erlaubt.
  PRODUCT_ID: "premium_unlock",
  // Kaufoptions-ID (nur Kleinbuchstaben/Ziffern/Bindestrich, KEIN Unterstrich).
  PRODUCT_OFFER_ID: "premium-unlock",
  // Anzeigepreis, falls der Store (noch) keinen echten Preis liefert.
  PRICE_FALLBACK: "2,99 €",

  /* -------------------------------------------------- Entwickler-Schalter */
  // Diagnose-Statuszeile in „Über diese App". Im Release aus (Learning G25).
  DIAG: false,
  /*
   * Test-Freischaltung von Premium ohne echten Kauf (Browser-Vorschau) und
   * der Knopf „Premium deaktivieren". Im Release AUS: sonst könnten Käufer
   * ihr Premium versehentlich abschalten und die Web-Version würde Premium
   * verschenken.
   */
  DEV_UNLOCK: false,
};
