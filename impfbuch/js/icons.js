/*
 * Zentrales SVG-Icon-System (Linien-Stil, modern & professionell).
 *
 * Alle Icons erben die Textfarbe (currentColor) und passen sich damit
 * automatisch an Hell/Neutral/Dunkel an. Verwendung:
 *   - statisch im HTML:  <span class="ic" data-icon="bell"></span>
 *     → wird beim Start via hydrateIcons() befüllt
 *   - dynamisch im JS:   svgIcon("bell")
 */
(function () {
  "use strict";

  // Pfad-Inhalte je Icon (24×24-Raster, Linien-Stil).
  const P = {
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    zap: '<path d="M13 2 4.5 13.5H11l-1 8.5L20 10h-6.5z"/>',
    globe: '<circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19"/><path d="M12 2.5a15 15 0 0 1 0 19 15 15 0 0 1 0-19z"/>',
    plane: '<path d="M10.2 3.6c.5-.8 1.6-1.1 2.4-.6.5.3.8.9.8 1.5v4.6l6.9 3.7c.4.2.7.6.7 1.1v.6c0 .6-.6 1.1-1.2.9L13.4 13v3.6l1.7 1.5c.2.2.4.5.4.8v.5c0 .5-.5.9-1 .8L12 19.4l-2.5.8c-.5.2-1-.2-1-.8v-.5c0-.3.1-.6.4-.8l1.7-1.5V13l-6.4 2.4c-.6.2-1.2-.3-1.2-.9v-.6c0-.5.3-.9.7-1.1L10.2 9V4.5c0-.3.1-.6.2-.9z"/>',
    map: '<path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4z"/><path d="M9 4v13"/><path d="M15 6.5v13"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
    contrast: '<circle cx="12" cy="12" r="9.5"/><path d="M12 2.5a9.5 9.5 0 0 0 0 19z" fill="currentColor" stroke="none"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 2.82 1.17l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    refresh: '<path d="M21 4v6h-6"/><path d="M3 20v-6h6"/><path d="M18.5 9A7.5 7.5 0 0 0 6 6.3L3 9M21 15l-3 2.7A7.5 7.5 0 0 1 5.5 15"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 8l5-5 5 5"/><path d="M12 3v13"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V2"/>',
    pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    // Durchgestrichener Kreis — steht für „ausblenden"
    ban: '<circle cx="12" cy="12" r="9.5"/><path d="M5.4 5.4l13.2 13.2"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/>',
    info: '<circle cx="12" cy="12" r="9.5"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    shieldCheck: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
    syringe: '<path d="m18 2 4 4"/><path d="m17 7 3-3"/><path d="M19 9 8.7 19.3a2.4 2.4 0 0 1-3.4 0l-.6-.6a2.4 2.4 0 0 1 0-3.4L15 5"/><path d="m9 11 4 4"/><path d="m5 19-3 3"/><path d="m14 4 6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    crown: '<path d="M3 18h18"/><path d="M4 18 2.5 7l5 4L12 4l4.5 7 5-4L20 18z"/>',
    gem: '<path d="M6 3h12l4 6-10 13L2 9z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/>',
    archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/>',
  };

  const FILLED = new Set(["zap", "plane", "map", "crown"]);

  function svgIcon(name, extraClass) {
    const body = P[name];
    if (!body) return "";
    const cls = "ic-svg" + (extraClass ? " " + extraClass : "");
    const fill = FILLED.has(name) ? "currentColor" : "none";
    return (
      '<svg class="' + cls + '" viewBox="0 0 24 24" fill="' + fill + '" ' +
      'stroke="currentColor" stroke-width="1.9" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true">' + body + "</svg>"
    );
  }

  // Befüllt alle <… data-icon="name"> im DOM mit dem passenden SVG.
  function hydrateIcons(root) {
    (root || document).querySelectorAll("[data-icon]").forEach((el) => {
      if (el.dataset.iconDone) return;
      el.innerHTML = svgIcon(el.dataset.icon);
      el.dataset.iconDone = "1";
    });
  }

  window.svgIcon = svgIcon;
  window.hydrateIcons = hydrateIcons;
})();
