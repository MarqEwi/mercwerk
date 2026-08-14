/*
 * Zentraler Edition-Schalter + Diagnose.
 *
 * EINE Quelle der Wahrheit für „kostenlos (mit Werbung)" vs. „Premium":
 *   - window.EDITION            → In-Memory-Flags, die der restliche Code abfragt
 *   - window.Edition.set(flavor) → schaltet um und feuert das Event
 *     "edition:changed" (app.js persistiert dann + aktualisiert Werbung/UI)
 *
 * Der Kauf (purchase.js) und der Test-Schalter im Premium-Dialog rufen beide
 * NUR window.Edition.set("premium" | "free") auf — so gibt es genau einen Weg.
 * Persistiert wird der Status in app.js unter state.settings.premium.
 */
(function () {
  "use strict";

  window.EDITION = {
    flavor: "free", // "free" | "premium"
    adsEnabled: true, // Werbung nur in der kostenlosen Edition (und nur nativ)
    premium: false,
  };

  window.Edition = {
    isPremium() {
      return window.EDITION.flavor === "premium";
    },
    // Schaltet die Edition um (ohne selbst zu persistieren) und benachrichtigt
    // den Rest der App. `silent` unterdrückt das Event (nur für die Erst-
    // initialisierung aus dem gespeicherten Zustand).
    set(flavor, silent) {
      const premium = flavor === "premium";
      // Keine echte Änderung → nichts melden. Wichtig: Google Play liefert
      // den Kauf bei JEDEM App-Start erneut als „approved" — ohne diesen
      // Guard erschien darum bei jedem Start die „Premium aktiv"-Meldung.
      const unchanged = window.EDITION.premium === premium;
      window.EDITION.flavor = premium ? "premium" : "free";
      window.EDITION.premium = premium;
      window.EDITION.adsEnabled = !premium;
      if (window.Diag) window.Diag.set("edition", window.EDITION.flavor);
      if (!silent && !unchanged) {
        document.dispatchEvent(
          new CustomEvent("edition:changed", {
            detail: { flavor: window.EDITION.flavor },
          })
        );
      }
    },
  };

  /*
   * Diagnose-Statuszeile (Learning G25): zeigt am Gerät den letzten Stand von
   * Werbung & Kauf. Wird in „Über diese App" ausgegeben, sofern MONETIZE.DIAG
   * an ist. Vor der Veröffentlichung MONETIZE.DIAG auf false setzen.
   */
  window.Diag = {
    data: { ads: "—", purchase: "—", edition: "free" },
    set(key, value) {
      this.data[key] = value;
      this.render();
    },
    render() {
      const e = document.getElementById("diag-line");
      if (!e) return;
      if (!window.MONETIZE || !window.MONETIZE.DIAG) {
        e.textContent = "";
        return;
      }
      e.textContent =
        `Werbung: ${this.data.ads} · Kauf: ${this.data.purchase} · ` +
        `Edition: ${this.data.edition}`;
    },
  };
})();
