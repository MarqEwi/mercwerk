/*
 * Brücke zwischen Web-App und nativer Capacitor-App.
 *
 * Grundsatz: Die App fragt IMMER window.NativeBridge — die Brücke entscheidet
 * per Feature-Detection, ob der native Weg (Capacitor-Plugins) oder das
 * bisherige Browser-Verhalten genutzt wird. So bleibt die Web-Version auf
 * GitHub Pages unverändert funktionsfähig.
 *
 * Nativ laufen Datei-Exporte über @capacitor/filesystem (Cache-Verzeichnis)
 * plus @capacitor/share (Teilen-Dialog) — a.download und window.print()
 * funktionieren im Android-WebView nicht zuverlässig.
 *
 * Hinweis Drucken: Die Impfbuch-App hat aktuell keine Druckfunktion. Sollte
 * eine dazukommen, gehört sie ebenfalls HIER hinein (natives Printer-Plugin,
 * im Browser window.print()).
 */
(function () {
  "use strict";

  function isNative() {
    return !!(
      window.Capacitor &&
      typeof window.Capacitor.isNativePlatform === "function" &&
      window.Capacitor.isNativePlatform()
    );
  }

  // Speichert/teilt eine Textdatei (z. B. JSON-Export).
  // Nativ: in den App-Cache schreiben und den Teilen-Dialog öffnen
  // (Nutzer wählt Ziel: Dateien, Drive, Mail …). Web: klassischer Download.
  async function saveTextFile(filename, text, mimeType) {
    if (isNative()) {
      const { Filesystem, Share } = window.Capacitor.Plugins;
      const result = await Filesystem.writeFile({
        path: filename,
        data: text,
        directory: "CACHE",
        encoding: "utf8",
      });
      await Share.share({
        title: filename,
        url: result.uri,
      });
      return;
    }
    // Browser-Fallback: bisheriges Verhalten
    const blob = new Blob([text], { type: mimeType || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  window.NativeBridge = { isNative, saveTextFile };
})();
