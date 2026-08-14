/*
 * Werbung — dezentes Banner unten (Learning C11) + Platzhalter-Rückfall.
 *
 * - Browser / Web: es gibt kein echtes AdMob → wir zeigen die HTML-Platzhalter-
 *   Leiste (dezenter Premium-Hinweis). So kann man das Layout hier testen.
 * - Native, kostenlos: UMP-Einwilligung (Learning D14) → echtes adaptives
 *   Banner unten. Lädt kein Banner (frisches Konto „code 3", Learning C12,
 *   oder Fehler), zeigen wir ebenfalls die Platzhalter-Leiste, damit unten
 *   nie eine leere Lücke bleibt.
 * - Premium: keine Werbung, keine Leiste, kein reservierter Platz.
 *
 * Die reservierte Höhe steckt in der CSS-Variablen --ad-height, damit Inhalte
 * nie hinter dem Banner verschwinden.
 */
(function () {
  "use strict";

  function isNative() {
    return !!(window.NativeBridge && window.NativeBridge.isNative());
  }
  function plugin() {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AdMob) || null;
  }
  function isPremium() {
    return !!(window.EDITION && window.EDITION.premium);
  }
  function setReservedHeight(px) {
    document.documentElement.style.setProperty("--ad-height", (px || 0) + "px");
  }
  function diag(msg) {
    if (window.Diag) window.Diag.set("ads", msg);
  }

  /*
   * Reserviert den Platz für die Platzhalter-Leiste. Bewusst mehrfach: allein
   * auf requestAnimationFrame ist kein Verlass — startet die App im
   * Hintergrund, läuft kein Frame, die Höhe bliebe 0 und die Leiste würde den
   * untersten Inhalt überdecken.
   */
  function reserveBarHeight() {
    const apply = () => {
      const bar = document.getElementById("ad-bar");
      if (!bar || bar.classList.contains("hidden")) return;
      if (window.Ads && window.Ads.keyboardOpen) return;
      const h = bar.offsetHeight;
      if (h > 0) setReservedHeight(h);
    };
    apply(); // sofort, falls bereits vermessbar
    requestAnimationFrame(apply); // nach dem nächsten Layout
    setTimeout(apply, 300); // Rückfall ohne laufende Frames
  }

  const Ads = {
    started: false,
    nativeBannerVisible: false,
    consentDone: false,
    privacyOptionsRequired: false,
    keyboardOpen: false,

    // Einstieg — wird von app.js nach dem Seeden der Edition aufgerufen.
    async init() {
      this.watchKeyboard();
      if (isPremium()) {
        await this.teardown();
        diag("aus (Premium)");
        return;
      }
      if (isNative() && plugin()) {
        await this.initNative();
      } else {
        this.showPlaceholder();
        diag("Platzhalter (Web/Testvorschau)");
      }
    },

    /* ------------------------------------------------------------ Tastatur */
    /*
     * Beim Tippen ist unten kein Platz für Werbung: Die Leiste ist am unteren
     * Rand verankert, das Fenster schrumpft aber, sobald die Tastatur aufgeht
     * — die Werbung sprang dadurch nach oben und verdeckte das Eingabefeld.
     * Solange ein Textfeld den Fokus hat, wird die Werbung daher ausgeblendet
     * und der reservierte Platz freigegeben.
     */
    watchKeyboard() {
      if (this._kbWatch) return;
      this._kbWatch = true;
      const isText = (el) =>
        !!el &&
        (el.tagName === "TEXTAREA" ||
          (el.tagName === "INPUT" &&
            !["checkbox", "radio", "button", "submit", "file"].includes(el.type)));

      document.addEventListener("focusin", (e) => {
        if (isText(e.target)) this.setKeyboardOpen(true);
      });
      document.addEventListener("focusout", () => {
        // kurz warten: beim Wechsel zwischen zwei Feldern bleibt die Tastatur
        setTimeout(() => {
          if (!isText(document.activeElement)) this.setKeyboardOpen(false);
        }, 120);
      });
    },

    setKeyboardOpen(open) {
      if (this.keyboardOpen === open) return;
      this.keyboardOpen = open;
      document.body.classList.toggle("keyboard-open", open);
      const bar = document.getElementById("ad-bar");
      if (open) {
        this._savedHeight = getComputedStyle(document.documentElement)
          .getPropertyValue("--ad-height")
          .trim();
        setReservedHeight(0);
      } else if (!isPremium()) {
        // Platz nur zurückgeben, wenn wieder etwas angezeigt wird
        if (this.nativeBannerVisible) {
          const h = parseInt(this._savedHeight, 10);
          if (h > 0) setReservedHeight(h);
        } else if (bar && !bar.classList.contains("hidden")) {
          reserveBarHeight();
        }
      }
      // Natives Banner mit aus-/einblenden (verdeckt sonst die Tastatur-Zeile)
      const AdMob = plugin();
      if (isNative() && AdMob && this.nativeBannerVisible) {
        try {
          if (open && AdMob.hideBanner) AdMob.hideBanner();
          else if (!open && AdMob.resumeBanner) AdMob.resumeBanner();
        } catch (e) {
          /* nicht kritisch */
        }
      }
    },

    // Nach Edition-Wechsel (Kauf / Test-Schalter) neu bewerten.
    async refresh() {
      if (isPremium()) {
        await this.teardown();
        diag("aus (Premium)");
      } else {
        await this.init();
      }
    },

    /* ------------------------------------------------------ Web-Platzhalter */
    showPlaceholder() {
      const bar = document.getElementById("ad-bar");
      if (!bar) return;
      bar.classList.remove("hidden");
      // Solange getippt wird, bleibt unten alles frei (CSS blendet die Leiste
      // aus) — dann auch keinen Platz reservieren.
      if (this.keyboardOpen) return;
      reserveBarHeight();
    },
    hidePlaceholder() {
      const bar = document.getElementById("ad-bar");
      if (bar) bar.classList.add("hidden");
    },

    /* --------------------------------------------------------------- Nativ */
    async initNative() {
      const AdMob = plugin();
      try {
        await AdMob.initialize({
          initializeForTesting: !!(window.MONETIZE && window.MONETIZE.ADS_TESTING),
        });
        const mayShow = await this.requestConsent(AdMob);
        if (!mayShow) {
          // Nutzer hat die Einwilligung verweigert (DSGVO): KEINE Werbung.
          // Die App läuft normal weiter, unten steht der dezente Hinweis.
          this.showPlaceholder();
          diag("keine Einwilligung → Werbung aus");
          return;
        }
        this.attachListeners(AdMob);
        await this.showBanner(AdMob);
      } catch (e) {
        diag("Fehler bei Init: " + (e && e.message ? e.message : e));
        this.showPlaceholder(); // niemals leere Lücke
      }
    },

    // UMP / DSGVO (Learning D14–D16)
    async requestConsent(AdMob) {
      try {
        let info = await AdMob.requestConsentInfo();
        if (info && info.status === "REQUIRED" && info.isConsentFormAvailable) {
          // Einwilligungsformular zeigen; danach den Status neu einlesen,
          // denn erst dann steht fest, ob der Nutzer zugestimmt hat.
          await AdMob.showConsentForm();
          try {
            info = await AdMob.requestConsentInfo();
          } catch (e) {
            /* alten Stand weiterverwenden */
          }
        }
        this.privacyOptionsRequired =
          info && info.privacyOptionsRequirementStatus === "REQUIRED";
        this.consentDone = true;
        // Karte „Werbe-Einstellungen ändern" nur zeigen, wenn nötig.
        const card = document.getElementById("ad-privacy-card");
        if (card) card.classList.toggle("hidden", !this.privacyOptionsRequired);

        /*
         * DSGVO (Learning D14): Nur wenn der Nutzer eingewilligt hat, darf
         * Werbung geladen werden. Meldet die Bibliothek canRequestAds ===
         * false, bleibt die Werbung aus — die App funktioniert normal weiter.
         * Ältere Plugin-Fassungen liefern das Feld nicht; dann nicht blockieren.
         */
        if (info && info.canRequestAds === false) return false;
        return true;
      } catch (e) {
        // Einwilligung fehlgeschlagen → im Zweifel keine Werbung laden.
        diag("Einwilligung fehlgeschlagen: " + (e && e.message ? e.message : e));
        return false;
      }
    },

    // „Werbe-Einstellungen ändern" (Learning D16)
    async showPrivacyOptions() {
      const AdMob = plugin();
      if (!AdMob) return;
      try {
        await AdMob.showPrivacyOptionsForm();
      } catch (e) {
        /* nichts anzuzeigen — kein Problem */
      }
    },

    attachListeners(AdMob) {
      if (this._listeners) return;
      this._listeners = true;
      try {
        AdMob.addListener("bannerAdSizeChanged", (info) => {
          const h = (info && (info.height || info.size)) || 0;
          if (h > 0) {
            this.nativeBannerVisible = true;
            this.hidePlaceholder();
            setReservedHeight(h);
            diag("Banner aktiv (" + h + "px)");
          }
        });
        AdMob.addListener("bannerAdFailedToLoad", (err) => {
          this.nativeBannerVisible = false;
          // Rückfall auf Platzhalter, damit unten nie eine Lücke klafft.
          this.showPlaceholder();
          const code = err && (err.code !== undefined ? err.code : err.message);
          diag("Banner-Fehler " + code + " → Platzhalter");
        });
        AdMob.addListener("bannerAdLoaded", () => {
          this.nativeBannerVisible = true;
          this.hidePlaceholder();
          diag("Banner geladen");
        });
      } catch (e) {
        /* Listener nicht kritisch */
      }
    },

    async showBanner(AdMob) {
      const adId = window.MONETIZE ? window.MONETIZE.bannerId() : "";
      if (!adId) {
        this.showPlaceholder();
        diag("keine Banner-ID → Platzhalter");
        return;
      }
      await AdMob.showBanner({
        adId,
        adSize: "ADAPTIVE_BANNER",
        position: "BOTTOM_CENTER",
        margin: 0,
        isTesting: !!(window.MONETIZE && window.MONETIZE.ADS_TESTING),
      });
      diag("Banner angefordert");
    },

    /* ------------------------------------------------------------ Aufräumen */
    async teardown() {
      this.hidePlaceholder();
      setReservedHeight(0);
      const AdMob = plugin();
      if (isNative() && AdMob) {
        try {
          await AdMob.removeBanner();
        } catch (e) {
          /* evtl. gar kein Banner aktiv */
        }
      }
      this.nativeBannerVisible = false;
    },
  };

  window.Ads = Ads;
})();
