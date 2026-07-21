/* Merc Studios – minimaler Theme-Umschalter.
   Speichert die Auswahl nur lokal (localStorage), sendet nichts an einen Server. */
(function () {
  var root = document.documentElement;
  var btn = document.getElementById('theme-toggle');
  if (!btn) return;

  function current() {
    var set = root.getAttribute('data-theme');
    if (set) return set;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function apply(mode) {
    root.setAttribute('data-theme', mode);
    btn.setAttribute('aria-label', mode === 'dark' ? 'Zu hellem Design wechseln' : 'Zu dunklem Design wechseln');
    btn.textContent = mode === 'dark' ? '☀️' : '\u{1F319}';
    try { localStorage.setItem('theme', mode); } catch (e) {}
  }
  apply(current());
  btn.addEventListener('click', function () {
    apply(current() === 'dark' ? 'light' : 'dark');
  });
})();
