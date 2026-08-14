/*
 * Premium — einmaliger In-App-Kauf (Google Play Billing, Learning E17–E21).
 *
 * Plugin: cordova-plugin-purchase (v13) → global als window.CdvPurchase.
 * - Native: NON_CONSUMABLE-Produkt registrieren, initialisieren, auf
 *   „approved" hören → window.Edition.set("premium"). „Käufe wiederherstellen"
 *   ist Play-Pflicht.
 * - Browser/Web: kein echter Store → buy() schaltet Premium als TEST lokal um,
 *   damit sich die Freischaltung hier prüfen lässt.
 *
 * Der Kauf gelingt NUR in einer über Google Play installierten App
 * (Test-Track) mit eingerichtetem Händlerkonto — nicht in der direkt per
 * Android Studio aufgespielten Version (Learning E21).
 */
(function () {
  "use strict";

  function isNative() {
    return !!(window.NativeBridge && window.NativeBridge.isNative());
  }
  function cfg() {
    return window.MONETIZE || {};
  }
  function diag(msg) {
    if (window.Diag) window.Diag.set("purchase", msg);
  }

  const Purchase = {
    ready: false,
    owned: false,
    priceString: null,

    price() {
      return this.priceString || cfg().PRICE_FALLBACK || "";
    },

    async init() {
      if (isNative() && window.CdvPurchase) {
        this.initNative();
      } else {
        diag("Browser: Test-Modus");
      }
    },

    /* --------------------------------------------------------------- Nativ */
    initNative() {
      try {
        const CdvPurchase = window.CdvPurchase;
        const { store, ProductType, Platform } = CdvPurchase;
        const id = cfg().PRODUCT_ID;

        store.register([
          {
            id: id,
            type: ProductType.NON_CONSUMABLE,
            platform: Platform.GOOGLE_PLAY,
          },
        ]);

        store
          .when()
          .productUpdated(() => this.syncFromStore(store, id))
          .approved((t) => {
            // Kauf bestätigt → Premium freischalten und abschließen.
            window.Edition.set("premium");
            diag("Kauf bestätigt");
            try {
              t.finish();
            } catch (e) {
              /* egal */
            }
          })
          .receiptUpdated(() => this.syncFromStore(store, id));

        store.error((err) => {
          diag("Store-Fehler " + (err && err.code ? err.code : "") + " " + (err && err.message ? err.message : ""));
        });

        store.initialize([Platform.GOOGLE_PLAY]).then(() => {
          this.ready = true;
          this.syncFromStore(store, id);
          diag("Store bereit");
        });
      } catch (e) {
        diag("Init-Fehler: " + (e && e.message ? e.message : e));
      }
    },

    // Preis + Besitzstand aus dem Store übernehmen.
    syncFromStore(store, id) {
      try {
        const product = store.get(id);
        if (product) {
          const offer = product.getOffer && product.getOffer();
          const pricing =
            offer && offer.pricingPhases && offer.pricingPhases[0];
          if (pricing && pricing.price) this.priceString = pricing.price;
          if (product.owned) {
            this.owned = true;
            if (!window.EDITION.premium) window.Edition.set("premium");
          }
        }
        this.refreshDialogPrice();
      } catch (e) {
        /* nicht kritisch */
      }
    },

    /* -------------------------------------------------------------- Aktionen */
    async buy() {
      if (isNative() && window.CdvPurchase && this.ready) {
        try {
          const { store, Platform } = window.CdvPurchase;
          const product = store.get(cfg().PRODUCT_ID, Platform.GOOGLE_PLAY);
          const offer = product && product.getOffer && product.getOffer();
          if (!offer) {
            diag("Produkt noch nicht abrufbar");
            return { pending: true };
          }
          diag("Kauf gestartet …");
          await store.order(offer);
          return { pending: true };
        } catch (e) {
          diag("Kauf abgebrochen/Fehler: " + (e && e.message ? e.message : e));
          return { error: true };
        }
      }
      // Ohne Store (Browser/Web): nur im Entwicklermodus lokal freischalten.
      // Im Release gibt es Premium ausschließlich über den echten Kauf.
      if (cfg().DEV_UNLOCK) {
        window.Edition.set("premium");
        diag("Test-Freischaltung (Browser)");
        return { test: true };
      }
      diag("Kauf nur in der App möglich");
      return { unavailable: true };
    },

    async restore() {
      if (isNative() && window.CdvPurchase) {
        try {
          diag("Käufe werden wiederhergestellt …");
          await window.CdvPurchase.store.restorePurchases();
          return { ok: true };
        } catch (e) {
          diag("Wiederherstellen-Fehler: " + (e && e.message ? e.message : e));
          return { error: true };
        }
      }
      return { unavailable: true };
    },

    refreshDialogPrice() {
      const e = document.getElementById("premium-price");
      if (e) e.textContent = this.price();
    },
  };

  window.Purchase = Purchase;
})();
