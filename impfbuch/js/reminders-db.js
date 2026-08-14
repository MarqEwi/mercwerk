/* Winziger IndexedDB-Key-Value-Speicher, nutzbar sowohl im Fenster (app.js)
 * als auch im Service Worker (sw.js via importScripts). Über ihn legt die App
 * die vorberechneten Fälligkeiten ab, die der Hintergrund-Sync ausliest. */

(function (global) {
  "use strict";

  const DB_NAME = "impfpass_db";
  const STORE = "kv";

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function set(key, value) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function get(key) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const rq = tx.objectStore(STORE).get(key);
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
    });
  }

  global.ReminderDB = { set, get };
})(self);
