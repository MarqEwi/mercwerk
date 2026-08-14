/* Service Worker — Offline-Cache + Hintergrund-Erinnerungen. */

importScripts("js/reminders-db.js");

const CACHE = "impfpass-v88";
const ASSETS = [
  "index.html",
  "datenschutz.html",
  "css/styles.css",
  "js/edition.js",
  "js/monetize-config.js",
  "js/icons.js",
  "js/native-bridge.js",
  "js/notify.js",
  "js/ads.js",
  "js/purchase.js",
  "js/app.js",
  "js/stiko-data.js",
  "js/travel-data.js",
  "js/reminders-db.js",
  "images/paper.jpg",
  "images/paper.png",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-192.png",
  "icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request)
          .then((resp) => {
            const copy = resp.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
            return resp;
          })
          .catch(() => cached)
      );
    })
  );
});

/* -------------------------------------------------- Hintergrund-Erinnerung */

// Periodic Background Sync (Chromium, installierte PWA): prüft täglich die
// von der App vorberechneten Fälligkeiten und benachrichtigt höchstens 1×/Tag.
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "impf-check") {
    event.waitUntil(checkDueAndNotify());
  }
});

// Manuelles Auslösen aus der App (z. B. zum Testen) via One-off Sync.
self.addEventListener("sync", (event) => {
  if (event.tag === "impf-check") {
    event.waitUntil(checkDueAndNotify());
  }
});

async function checkDueAndNotify() {
  try {
    const data = (self.ReminderDB && (await self.ReminderDB.get("due"))) || null;
    if (!data || !data.items || !data.items.length) return;

    const today = new Date().toISOString().slice(0, 10);
    const lastNotified = await self.ReminderDB.get("lastNotified");
    if (lastNotified === today) return; // heute schon erinnert

    const names = data.items
      .map((d) => `${d.vaccine} (${d.profile})`)
      .slice(0, 3)
      .join(", ");
    await self.registration.showNotification("Impfpass — fällige Impfungen", {
      body: `${data.items.length} Impfung(en) anstehend: ${names}${
        data.items.length > 3 ? " …" : ""
      }`,
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      tag: "impf-due",
    });
    await self.ReminderDB.set("lastNotified", today);
  } catch (e) {
    /* still fehlschlagen — nächster Sync versucht es erneut */
  }
}

// Klick auf die Benachrichtigung öffnet/fokussiert die App.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((list) => {
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("index.html");
    })
  );
});
