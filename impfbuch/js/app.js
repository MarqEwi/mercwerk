/* Impfpass-App — Logik, Fälligkeitsberechnung und Rendering.
 * Reine Vanilla-JS-PWA, alle Daten im localStorage (bleiben auf dem Gerät).
 * Unterstützt mehrere Personen (Familienprofile). */

(function () {
  "use strict";

  const {
    GROUPS,
    STIKO_SCHEDULE,
    COMBINATIONS,
    INFANT_ONLY,
    CATCHUP_NOTES,
    VALID_YEARS,
    SOURCES,
    vaccineNameById,
  } = window.STIKO;
  const COUNTRIES = (window.TRAVEL && window.TRAVEL.COUNTRIES) || [];
  const COUNTRY_INFO = (window.TRAVEL && window.TRAVEL.COUNTRY_INFO) || {};
  const REGION_DEFAULTS = (window.TRAVEL && window.TRAVEL.REGION_DEFAULTS) || {};
  const WORLD = (window.TRAVEL && window.TRAVEL.WORLD) || null;

  // Löst ein Land in konkrete Empfehlungen auf (Regions-Standard + Gelbfieber).
  function resolveCountry(c) {
    if (!c) return null;
    const def = REGION_DEFAULTS[c.region] || { required: [], recommended: [], note: "" };
    const required = (c.required || def.required || []).slice();
    let recommended = (c.recommended || def.recommended || []).slice();
    if (
      c.yf &&
      !required.includes("gelbfieber") &&
      !recommended.includes("gelbfieber")
    ) {
      recommended = ["gelbfieber", ...recommended];
    }
    return {
      code: c.code,
      name: c.name,
      region: c.region,
      required,
      recommended,
      note: c.note || def.note || "",
    };
  }

  // „Weltweit" = Vereinigung ALLER Reiseimpfungen aller Länder (in Schema-Reihenfolge).
  function worldTravelVaccines() {
    const set = new Set();
    COUNTRIES.forEach((raw) => {
      const c = resolveCountry(raw);
      c.required.forEach((id) => set.add(id));
      c.recommended.forEach((id) => set.add(id));
    });
    return STIKO_SCHEDULE.map((v) => v.id).filter((id) => set.has(id));
  }

  const countryById = (code) => {
    if (code === "world") {
      const w = resolveCountry(WORLD);
      w.recommended = worldTravelVaccines();
      w.required = [];
      return w;
    }
    return resolveCountry(COUNTRIES.find((c) => c.code === code));
  };
  const STORAGE_KEY = "impfpass_v1";

  // Fenster in Tagen: „bald fällig" beginnt so viele Tage vor dem Termin.
  const SOON_DAYS = 90;

  /* Termine, die weiter voraus liegen, stehen nicht in der Hauptliste,
     sondern in einem eingeklappten Bereich darunter. Sonst füllen Einträge
     wie „Pneumokokken ab 60" die Liste einer Dreißigjährigen mit Terminen,
     die sie noch Jahrzehnte nicht braucht — und der Eindruck entsteht, die
     App empfehle etwas Altersfremdes. */
  const VORSCHAU_TAGE = 5 * 365;

  const byId = (id) => STIKO_SCHEDULE.find((v) => v.id === id);
  const uid = (p) => p + Date.now() + Math.random().toString(36).slice(2, 6);

  /* ---------------------------------------------------------------- Speicher */

  function defaultProfile(name) {
    // vstate: id → "collapsed" (klein/grau) | "hidden" (komplett) | "shown" (Override)
    // travel: Länder-Codes, monitor: überwachte Impfungen (IDs)
    return {
      id: uid("p"),
      name: name || "Ich",
      birthdate: "",
      records: [],
      vstate: {},
      travel: [],
      monitor: [],
    };
  }

  function defaultData() {
    const p = defaultProfile("Ich");
    return {
      version: 2,
      activeProfileId: p.id,
      profiles: [p],
      settings: {
        notifyEnabled: false,
        theme: "light",
        setupDone: false,
        premium: false,
      },
    };
  }

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultData();
      return migrate(JSON.parse(raw));
    } catch (e) {
      console.warn("Konnte Daten nicht laden:", e);
      return defaultData();
    }
  }

  // Migriert Alt-Formate: v1 (einzelnes Profil) und alte Record-Struktur.
  function migrate(data) {
    // v1 → v2: einzelnes { profile, records } in profiles-Array überführen
    if (!data.profiles) {
      const prof = {
        id: uid("p"),
        name: (data.profile && data.profile.name) || "Ich",
        birthdate: (data.profile && data.profile.birthdate) || "",
        records: data.records || [],
      };
      data = {
        version: 2,
        activeProfileId: prof.id,
        profiles: [prof],
        settings: { notifyEnabled: false },
      };
    }
    if (!data.settings) data.settings = { notifyEnabled: false };
    if (!data.settings.theme) data.settings.theme = "light";
    if (data.settings.premium === undefined) data.settings.premium = false;
    // Bestandsnutzer mit Profildaten/Einträgen nicht erneut durch die
    // Ersteinrichtung schicken.
    if (data.settings.setupDone === undefined) {
      data.settings.setupDone = (data.profiles || []).some(
        (p) => p.birthdate || (p.records && p.records.length)
      );
    }

    // Record-Struktur je Profil auf { targets } normalisieren
    data.profiles.forEach((p) => {
      if (!p.vstate) p.vstate = {};
      if (!Array.isArray(p.travel)) p.travel = [];
      if (!Array.isArray(p.monitor)) p.monitor = [];
      // Alt-Format: hidden-Liste → komplett ausgeblendet
      if (Array.isArray(p.hidden)) {
        p.hidden.forEach((id) => {
          if (!p.vstate[id]) p.vstate[id] = "hidden";
        });
        delete p.hidden;
      }
      p.records = (p.records || []).map((r) => {
        if (r.targets) return r;
        return {
          id: r.id || uid("r"),
          date: r.date,
          product: r.product || "",
          batch: r.batch || "",
          doctor: r.doctor || "",
          targets: r.vaccineId ? [r.vaccineId] : [],
        };
      });
    });
    if (!data.profiles.length) return defaultData();
    if (!data.profiles.find((p) => p.id === data.activeProfileId))
      data.activeProfileId = data.profiles[0].id;
    return data;
  }

  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  let state = loadData();

  /* -------------------------------------------------------------- Premium */
  // Zentrale Gratis-Grenze: ohne Premium max. 2 Profile.
  const FREE_PROFILE_LIMIT = 2;
  const isPremium = () =>
    !!(state.settings && state.settings.premium) ||
    !!(window.EDITION && window.EDITION.premium);

  const activeProfile = () =>
    state.profiles.find((p) => p.id === state.activeProfileId) ||
    state.profiles[0];

  /* ------------------------------------------------------------ Datumshilfen */

  const MS_DAY = 24 * 60 * 60 * 1000;

  function parseDate(str) {
    if (!str) return null;
    const d = new Date(str + "T00:00:00");
    return isNaN(d) ? null : d;
  }

  function addMonths(date, months) {
    const d = new Date(date.getTime());
    const whole = Math.floor(months);
    const fracDays = Math.round((months - whole) * 30.44);
    d.setMonth(d.getMonth() + whole);
    d.setDate(d.getDate() + fracDays);
    return d;
  }

  function addYears(date, years) {
    return addMonths(date, years * 12);
  }

  function daysBetween(a, b) {
    return Math.round((b.getTime() - a.getTime()) / MS_DAY);
  }

  // Relative Zeitangabe für Fälligkeiten (Tage → Tage/Monate/Jahre).
  function relTime(days) {
    if (days == null) return "";
    if (days < 0) return `seit ${Math.abs(days)} Tagen`;
    if (days === 0) return "heute";
    if (days < 45) return `in ${days} Tagen`;
    if (days < 700) return `in ${Math.round(days / 30.44)} Monaten`;
    return `in ${Math.round(days / 365.25)} Jahren`;
  }

  function fmtDate(date) {
    if (!date) return "—";
    return date.toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

  function ageInMonths(birth, at) {
    return (at.getTime() - birth.getTime()) / MS_DAY / 30.44;
  }

  // Menschlich lesbares Alter aus Monaten (für das Info-Fenster).
  function formatAge(m) {
    if (m < 1.75) return Math.round(m * 4.345) + " Wochen";
    if (m < 24) return Math.round(m) + " Monaten";
    return Math.round(m / 12) + " Jahren";
  }

  /* ------------------------------------------ Records je Impfung ermitteln */

  // Alle Einträge eines Profils, die eine Impfung abdecken (inkl. Kombi).
  function recordsFor(profile, vaccineId) {
    return profile.records
      .filter((r) => r.targets && r.targets.includes(vaccineId))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  /* ------------------------------------------------ Fälligkeiten berechnen */

  // Liefert für jede Impfung den Status des nächsten Termins eines Profils.
  function computeDueItems(profile) {
    const birth = parseDate(profile.birthdate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const items = [];

    for (const vac of STIKO_SCHEDULE) {
      const records = recordsFor(profile, vac.id);
      const next = nextDue(vac, records, birth, today, isMonitored(vac.id, profile));
      items.push({
        vaccine: vac,
        records,
        doneCount: records.length,
        next,
        ...classify(next, today),
      });
    }
    return items;
  }

  // Fällige/überfällige Impfungen aller Profile (für Benachrichtigungen).
  function computeDueAcrossProfiles() {
    const out = [];
    for (const p of state.profiles) {
      for (const item of computeDueItems(p)) {
        if (displayStateFor(item.vaccine, p) !== "shown") continue;
        if (
          (item.status === "overdue" || item.status === "soon") &&
          item.next &&
          item.next.dueDate
        ) {
          out.push({
            profile: p.name,
            vaccine: item.vaccine.name,
            dueDate: item.next.dueDate.toISOString().slice(0, 10),
            status: item.status,
          });
        }
      }
    }
    return out;
  }

  // Bestimmt den nächsten fälligen Termin einer Impfung.
  function nextDue(vac, records, birth, today, monitored) {
    const done = records.length;

    if (vac.series && done < vac.series.length) {
      const dose = vac.series[done];
      const prevRec = done > 0 ? records[done - 1] : null;

      // Indikations-/Reiseimpfung ohne begonnene Serie: keine Fälligkeit erzeugen.
      if (vac.onDemand && !prevRec) {
        return { onDemand: true, label: dose.label, note: dose.note };
      }

      let dueDate = null;
      // Bei onDemand ausschließlich vom Vortermin rechnen (nicht vom Geburtsdatum).
      if (!vac.onDemand && birth) dueDate = addMonths(birth, dose.ageMonths);
      if (prevRec) {
        const prev = parseDate(prevRec.date);
        const gap = dose.ageMonths - vac.series[done - 1].ageMonths;
        const fromPrev = prev ? addMonths(prev, gap) : null;
        if (fromPrev && (!dueDate || fromPrev > dueDate)) dueDate = fromPrev;
      }
      return { dueDate, label: dose.label, note: dose.note, kind: "serie" };
    }

    if (vac.annual) {
      const last = done ? parseDate(records[done - 1].date) : null;
      let dueDate;
      if (last) {
        dueDate = addYears(last, 1);
      } else if (birth) {
        dueDate = addMonths(birth, vac.annual.fromAgeMonths);
        if (dueDate < today) dueDate = today;
      }
      return {
        dueDate,
        label: "Jährliche Impfung",
        note: vac.annual.seasonNote,
        kind: "annual",
      };
    }

    if (vac.booster) {
      const last = done ? parseDate(records[done - 1].date) : null;
      let dueDate;
      if (last) {
        dueDate = addYears(last, vac.booster.intervalYears);
      } else if (birth) {
        dueDate = addMonths(birth, vac.booster.fromAgeMonths);
      }
      return {
        dueDate,
        label: vac.booster.label,
        note: vac.booster.note,
        kind: "booster",
      };
    }

    // Gültigkeits-Überwachung: nach abgeschlossener Serie anhand der Schutzdauer.
    if (monitored && VALID_YEARS[vac.id] && done) {
      const last = parseDate(records[done - 1].date);
      const dueDate = last ? addYears(last, VALID_YEARS[vac.id]) : null;
      return {
        dueDate,
        label: "Auffrischung (Überwachung)",
        note: `Schutzdauer ca. ${VALID_YEARS[vac.id]} Jahre`,
        kind: "monitor",
      };
    }

    return null;
  }

  function classify(next, today) {
    if (!next) return { status: "complete", days: null };
    if (next.onDemand) return { status: "optional", days: null };
    if (!next.dueDate) return { status: "unknown", days: null };
    const days = daysBetween(today, next.dueDate);
    let status;
    if (days < 0) status = "overdue";
    else if (days <= SOON_DAYS) status = "soon";
    else status = "future";
    return { status, days };
  }

  const STATUS_META = {
    overdue: { label: "Überfällig", cls: "st-overdue" },
    soon: { label: "Bald fällig", cls: "st-soon" },
    future: { label: "Geplant", cls: "st-future" },
    complete: { label: "Abgeschlossen", cls: "st-complete" },
    optional: { label: "Bei Bedarf", cls: "st-optional" },
    unknown: { label: "Geburtsdatum fehlt", cls: "st-unknown" },
  };

  /* --------------------------------------------------------------- Rendering */

  const el = (sel) => document.querySelector(sel);
  const esc = (s) =>
    String(s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
    );

  function render() {
    renderProfiles();
    renderReminders();
    renderPass();
    renderHidden();
    renderCoach();
    renderBookShelf();
    renderTravelSelected();
    renderTravelPanel();
    renderPremiumCard();
    persistDueToDB();
  }

  /* --------------------------------------------- Reise- & Länderempfehlungen */

  let selectedTravelCode = ""; // aktuell angezeigtes Ziel (Code oder "world")

  function populateTravelSelect() {
    const sorted = COUNTRIES.slice().sort((a, b) =>
      a.name.localeCompare(b.name, "de")
    );
    const dl = el("#country-datalist");
    if (dl) {
      dl.innerHTML = sorted
        .map((c) => `<option value="${esc(c.name)}"></option>`)
        .join("");
    }
    const sel = el("#travel-country");
    if (sel) {
      const regions = [...new Set(COUNTRIES.map((c) => c.region))];
      sel.innerHTML =
        `<option value="">— Kontinent / Land —</option>` +
        regions
          .map(
            (r) =>
              `<optgroup label="${esc(r)}">` +
              COUNTRIES.filter((c) => c.region === r)
                .sort((a, b) => a.name.localeCompare(b.name, "de"))
                .map((c) => `<option value="${c.code}">${esc(c.name)}</option>`)
                .join("") +
              `</optgroup>`
          )
          .join("");
    }
  }

  function findCountryByName(name) {
    const n = name.trim().toLowerCase();
    return COUNTRIES.find((c) => c.name.toLowerCase() === n);
  }

  function renderTravelPanel() {
    if (selectedTravelCode) renderTravelResult(selectedTravelCode);
  }

  // Liste der aktiven Reiseziele („Ich reise in dieses Land").
  function renderTravelSelected() {
    const box = el("#travel-selected");
    if (!box) return;
    const active = activeProfile();
    const list = (active.travel || []).map(countryById).filter(Boolean);
    if (!list.length) {
      box.innerHTML = "";
      return;
    }
    box.innerHTML = `
      <div class="travel-mine">
        <div class="travel-mine-title">🧳 Meine Reiseziele</div>
        <div class="travel-mine-list">
          ${list
            .map(
              (c) =>
                `<span class="dest-chip">${esc(c.name)}
                   <button class="dest-x" data-code="${c.code}" title="Reiseziel entfernen">✕</button>
                 </span>`
            )
            .join("")}
        </div>
      </div>`;
    box.querySelectorAll(".dest-x").forEach((b) =>
      b.addEventListener("click", () => toggleTravel(b.dataset.code))
    );
  }

  // Impfstatus einer Impfung für die Reise-Übersicht.
  function travelVacStatus(id, profile) {
    const vac = byId(id);
    const recs = recordsFor(profile, id);
    const done = recs.length;
    if (done === 0) return { label: "fehlt", cls: "tv-missing" };
    const vy = VALID_YEARS[id];
    if (vy) {
      const last = parseDate(recs[recs.length - 1].date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const exp = last ? addYears(last, vy) : null;
      if (exp && exp < today) return { label: "abgelaufen", cls: "tv-expired" };
      if (exp) return { label: "gültig bis " + fmtDate(exp), cls: "tv-ok" };
    }
    const seriesLen = (vac.series || []).length;
    if (seriesLen && done < seriesLen)
      return { label: `${done}/${seriesLen} Dosen`, cls: "tv-partial" };
    return { label: "vorhanden", cls: "tv-ok" };
  }

  function renderTravelResult(code) {
    const box = el("#travel-result");
    if (!box) return;
    const c = countryById(code);
    if (!c) {
      box.innerHTML = `<p class="hint">Wähle oben ein Land, um die Impfempfehlungen zu sehen.</p>`;
      return;
    }
    const active = activeProfile();
    const going = (active.travel || []).includes(code);
    const listOf = (ids) =>
      ids
        .map((id) => {
          const st = travelVacStatus(id, active);
          return `<li><span class="tv-name">${esc(
            vaccineNameById(id)
          )}</span><span class="tv-status ${st.cls}">${esc(st.label)}</span></li>`;
        })
        .join("");

    const reqHtml = c.required.length
      ? `<div class="travel-block req"><h4>Pflicht bei Einreise</h4><ul class="travel-list">${listOf(
          c.required
        )}</ul></div>`
      : "";
    const recHtml = c.recommended.length
      ? `<div class="travel-block rec"><h4>Empfohlene Reiseimpfungen</h4><ul class="travel-list">${listOf(
          c.recommended
        )}</ul></div>`
      : "";

    // Zusammenfassung: was ist noch offen?
    const allIds = [...new Set([...c.required, ...c.recommended])];
    const open = allIds.filter(
      (id) => travelVacStatus(id, active).cls !== "tv-ok"
    );
    const summaryHtml = !active.birthdate
      ? ""
      : open.length
      ? `<div class="travel-summary open">Noch offen für diese Reise: ${open
          .map((id) => esc(vaccineNameById(id)))
          .join(", ")}</div>`
      : `<div class="travel-summary ok">✓ Alle empfohlenen Impfungen vorhanden bzw. aktuell</div>`;

    const info = COUNTRY_INFO[code];

    box.innerHTML = `
      <div class="travel-card">
        <div class="travel-head">
          <h3>${esc(c.name)}</h3>
          <span class="travel-region">${esc(c.region)}</span>
        </div>
        ${info ? `<p class="travel-info">ℹ️ ${esc(info)}</p>` : ""}
        ${summaryHtml}
        ${reqHtml}${recHtml}
        <div class="travel-block std">
          <h4>Immer prüfen</h4>
          <p>Standardimpfungen (Tetanus, Diphtherie, Keuchhusten, Poliomyelitis, MMR) sollten aktuell sein.</p>
        </div>
        ${c.note ? `<p class="travel-note">${esc(c.note)}</p>` : ""}
        ${
          !isPremium()
            ? `<button type="button" class="travel-toggle locked" id="travel-locked">
                 ${svgIcon("lock", "ic-inline")}
                 <span>${
                   code === "world"
                     ? "Weltweiten Impfschutz — Empfehlungen übernehmen"
                     : "Ich reise in dieses Land — Empfehlungen übernehmen"
                 }
                   <em class="premium-tag">Premium</em></span>
               </button>`
            : `<label class="travel-toggle ${going ? "on" : ""}">
                 <input type="checkbox" id="travel-going" ${going ? "checked" : ""} />
                 <span>${
                   code === "world"
                     ? "Weltweiten Impfschutz — Empfehlungen in Impfpass &amp; Fällig übernehmen"
                     : "Ich reise in dieses Land — Empfehlungen in Impfpass &amp; Fällig übernehmen"
                 }</span>
               </label>`
        }
        <p class="info-disclaimer">Kuratierte Auswahl, keine reisemedizinische Beratung. Bitte vor der Reise ärztlich beraten lassen (auch zu Malaria-Prophylaxe u. Ä.).</p>
      </div>`;
    const goingBox = el("#travel-going");
    if (goingBox) goingBox.addEventListener("change", () => toggleTravel(code));
    const locked = el("#travel-locked");
    if (locked)
      locked.addEventListener("click", () =>
        showPremiumDialog(
          `<p>Das Übernehmen von Reiseempfehlungen in deinen Impfpass ist eine <strong>Premium</strong>-Funktion.</p>` +
            `<p>Die Reise- und Länder-Infos sowie der Überblick bleiben kostenlos.</p>`
        )
      );
  }

  /* ------------------------------------------------- Impfungen aus-/einblenden */

  /*
   * Wird die Impfung aktuell nicht (mehr) empfohlen? Dann klappt sie die App
   * automatisch ein und erzeugt keine Fälligkeit mehr. Zwei Fälle:
   *  - `retired`: Empfehlung wurde zurückgezogen (z. B. Meningokokken C)
   *  - Alter über der Obergrenze aus MAX_AGE_YEARS
   * Bereits dokumentierte Impfungen bleiben immer normal sichtbar.
   */
  function isAgeNotRecommended(vac, profile, doneCount) {
    if (doneCount) return false; // bereits dokumentiert → normal anzeigen
    if (vac.retired) return true;
    const maxY = INFANT_ONLY[vac.id];
    if (maxY == null) return false;
    const birth = parseDate(profile.birthdate);
    if (!birth) return false;
    return ageInMonths(birth, new Date()) / 12 > maxY;
  }

  // Impfungen, die durch gewählte Reiseziele empfohlen/gefordert sind.
  function travelVaccineSet(profile) {
    const set = new Set();
    (profile.travel || []).forEach((code) => {
      const c = countryById(code);
      if (!c) return;
      (c.required || []).forEach((id) => set.add(id));
      (c.recommended || []).forEach((id) => set.add(id));
    });
    return set;
  }

  // Reiseziele, die eine bestimmte Impfung empfehlen/fordern.
  function travelCountriesFor(vacId, profile) {
    return (profile.travel || [])
      .map(countryById)
      .filter(
        (c) => c && (c.required.includes(vacId) || c.recommended.includes(vacId))
      );
  }

  const isMonitored = (id, profile) => (profile.monitor || []).includes(id);

  // Anzeigezustand: "shown" | "collapsed" (klein/grau) | "hidden" (komplett).
  function displayStateFor(vac, profile) {
    const s = profile.vstate && profile.vstate[vac.id];
    // Ausdrückliche Nutzer-Auswahl hat immer Vorrang (auch bei Reise/Überwachung).
    if (s === "hidden") return "hidden";
    if (s === "collapsed" || s === "age-hidden") return "collapsed";
    if (s === "shown") return "shown";
    // Reise-Empfehlung oder Überwachung blenden die Impfung ein.
    if (isMonitored(vac.id, profile) || travelVaccineSet(profile).has(vac.id))
      return "shown";
    const done = recordsFor(profile, vac.id).length;
    if (isAgeNotRecommended(vac, profile, done)) return "collapsed";
    return "shown";
  }

  // Vollständiger Hinweis, warum eine Impfung eingeklappt/ausgeblendet ist.
  function hiddenReason(vac, profile) {
    const s = profile.vstate && profile.vstate[vac.id];
    if (s === "age-hidden")
      return "Ausgeblendet, da in deinem Alter nicht mehr empfohlen oder nachholbar";
    if (s === "collapsed" || s === "hidden") return "Von dir ausgeblendet";
    const done = recordsFor(profile, vac.id).length;
    if (isAgeNotRecommended(vac, profile, done)) {
      if (vac.retired)
        return "Automatisch ausgeblendet — diese Impfung wird nicht mehr empfohlen";
      return "Automatisch ausgeblendet, da in deinem Alter nicht mehr empfohlen";
    }
    return "";
  }

  function setVState(id, stateVal) {
    const p = activeProfile();
    if (!p.vstate) p.vstate = {};
    p.vstate[id] = stateVal;
    saveData();
    render();
  }

  function toggleMonitor(id) {
    const p = activeProfile();
    if (!p.monitor) p.monitor = [];
    const wasMon = p.monitor.includes(id);
    p.monitor = wasMon
      ? p.monitor.filter((x) => x !== id)
      : [...p.monitor, id];
    // Überwachung aus → Impfung normal weiter anzeigen (nicht einklappen).
    if (wasMon) {
      if (!p.vstate) p.vstate = {};
      p.vstate[id] = "shown";
    }
    saveData();
    render();
  }

  function toggleTravel(code) {
    const p = activeProfile();
    if (!Array.isArray(p.travel)) p.travel = [];
    p.travel = p.travel.includes(code)
      ? p.travel.filter((c) => c !== code)
      : [...p.travel, code];
    saveData();
    render(); // aktualisiert Impfpass + Reise-Panel
  }

  // Verwaltung der komplett ausgeblendeten Impfungen im Profil-Tab.
  function renderHidden() {
    const box = el("#hidden-manager");
    const p = activeProfile();
    const hard = STIKO_SCHEDULE.filter((v) => (p.vstate || {})[v.id] === "hidden");
    if (!hard.length) {
      box.innerHTML = `<p class="hint">Keine Impfungen komplett ausgeblendet. Nicht relevante Impfungen erscheinen im Impfpass klein/grau und lassen sich dort über „Komplett ausblenden" ganz entfernen.</p>`;
      return;
    }
    box.innerHTML = hard
      .map(
        (v) =>
          `<button class="prof-chip hidden-chip" data-vaccine="${v.id}">${esc(
            v.name
          )} <span class="chip-plus">einblenden</span></button>`
      )
      .join("");
    box.querySelectorAll(".hidden-chip").forEach((chip) =>
      chip.addEventListener("click", () => setVState(chip.dataset.vaccine, "shown"))
    );
  }

  /* -------------------------------------------------- Info-Fenster je Impfung */

  // Bewertet, ob eine Impfung (dringend) nachzuholen ist — inkl. Altersgrenze.
  function catchupVerdict(item) {
    const vac = item.vaccine;
    const birth = parseDate(activeProfile().birthdate);
    const ageY = birth ? ageInMonths(birth, new Date()) / 12 : null;
    const maxY = INFANT_ONLY[vac.id];

    if (maxY != null && ageY != null && ageY > maxY && item.status !== "complete") {
      return {
        level: "na",
        title: "Nicht mehr nachzuholen",
        text: "Diese Impfung ist nur im Säuglings-/Kleinkindalter vorgesehen und in deinem Alter weder nötig noch nachholbar.",
      };
    }
    switch (item.status) {
      case "overdue":
        return {
          level: "urgent",
          title: "Dringend nachzuholen",
          text: "Diese Impfung ist nach STIKO überfällig. Sprich deine Ärztin/deinen Arzt an, um sie möglichst bald nachzuholen.",
        };
      case "soon":
        return {
          level: "soon",
          title: "Bald fällig",
          text: "Der nächste Termin steht in Kürze an – am besten frühzeitig einplanen.",
        };
      case "future":
        return {
          level: "ok",
          title: "Noch nicht fällig",
          text: "Aktuell kein Handlungsbedarf; der nächste empfohlene Termin liegt in der Zukunft.",
        };
      case "complete":
        return {
          level: "done",
          title: "Vollständig",
          text: "Alle empfohlenen Impfungen sind dokumentiert – derzeit kein Handlungsbedarf.",
        };
      case "optional":
        return {
          level: "optional",
          title: "Nur bei Bedarf",
          text: "Indikations-/Reiseimpfung – nur bei entsprechendem Risiko, Beruf oder bei Reisen nötig.",
        };
      default:
        return {
          level: "unknown",
          title: "Beurteilung nicht möglich",
          text: "Bitte ergänze das Geburtsdatum im Profil, um die Dringlichkeit einzuschätzen.",
        };
    }
  }

  function openInfoDialog(id) {
    const vac = byId(id);
    if (!vac) return;
    const item = computeDueItems(activeProfile()).find((i) => i.vaccine.id === id);
    const v = catchupVerdict(item);

    const schema = (vac.series || [])
      .map(
        (d) =>
          `<li>${esc(d.label)} — empfohlen mit ${formatAge(d.ageMonths)}${
            d.note ? ` <em>(${esc(d.note)})</em>` : ""
          }</li>`
      )
      .join("");
    const extra = [];
    if (vac.booster)
      extra.push(
        `<li>Auffrischung: alle ${vac.booster.intervalYears} Jahre${
          vac.booster.note ? ` <em>(${esc(vac.booster.note)})</em>` : ""
        }</li>`
      );
    if (vac.annual)
      extra.push(
        `<li>Jährliche Impfung ab ${formatAge(vac.annual.fromAgeMonths)}${
          vac.annual.seasonNote ? ` <em>(${esc(vac.annual.seasonNote)})</em>` : ""
        }</li>`
      );
    const catchup = CATCHUP_NOTES[id];
    const dstate = displayStateFor(vac, activeProfile());
    // „nicht empfohlen" (na) und ausgeblendete Impfungen zeigen KEIN Fälligkeitsdatum.
    const showNext =
      v.level !== "na" && dstate === "shown" && item.status !== "complete";
    const nextInfo =
      showNext && item.next && item.next.dueDate
        ? ` · nächste empfohlen: ${fmtDate(item.next.dueDate)}`
        : "";
    // Quellenangabe: verlinkt die amtliche Empfehlung, auf der die Angaben beruhen.
    const src = (SOURCES && SOURCES[vac.source]) || (SOURCES && SOURCES.kalender);
    const sourceBlock = src
      ? `<div class="info-section info-source">
           <h4>Quelle</h4>
           <p>Grundlage dieser Angaben:
             <a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.label)}</a>.
             Stand der hinterlegten Daten: Impfkalender 2026.
           </p>
         </div>`
      : "";
    const reason = hiddenReason(vac, activeProfile());
    const hiddenBlock =
      dstate !== "shown" && reason
        ? `<div class="info-section"><h4>Ausgeblendet</h4><p>${esc(reason)}${
            dstate === "hidden" ? " (komplett verborgen)" : ""
          }.</p></div>`
        : "";

    el("#info-body").innerHTML = `
      <div class="info-head">
        <div class="info-name">${esc(vac.name)}</div>
        <div class="info-full">${esc(vac.fullName)}</div>
      </div>
      <div class="verdict iv-${v.level}">
        <div class="verdict-title">${esc(v.title)}</div>
        <div class="verdict-text">${esc(v.text)}</div>
      </div>
      ${hiddenBlock}
      ${
        vac.disease
          ? `<div class="info-section info-disease"><h4>${esc(
              vac.diseaseTitle || "Die Krankheit"
            )}</h4><p>${esc(vac.disease)}</p></div>`
          : ""
      }
      <div class="info-section"><h4>Empfehlung</h4><p>${esc(vac.info)}</p></div>
      ${
        vac.ageInfo
          ? `<div class="info-section info-age"><h4>Für wen und ab welchem Alter</h4><p>${esc(
              vac.ageInfo
            )}</p></div>`
          : ""
      }
      ${catchup ? `<div class="info-section"><h4>Nachholen</h4><p>${esc(catchup)}</p></div>` : ""}
      ${
        vac.noBooster
          ? `<div class="info-section info-nobooster"><h4>Warum die App hier keine Auffrischung anzeigt</h4><p>${esc(
              vac.noBooster
            )}</p></div>`
          : ""
      }
      ${vac.riskNote ? `<div class="info-section"><h4>Hinweis</h4><p>${esc(vac.riskNote)}</p></div>` : ""}
      ${
        schema || extra.length
          ? `<div class="info-section"><h4>Impfschema</h4><ul class="info-schema">${schema}${extra.join("")}</ul></div>`
          : ""
      }
      <div class="info-section"><h4>Dein Stand</h4><p>${item.doneCount} Impfung(en) dokumentiert${nextInfo}.</p></div>
      ${sourceBlock}
      <p class="info-disclaimer">Diese Angaben ersetzen keine ärztliche Beratung. Maßgeblich ist immer die oben verlinkte Originalquelle.</p>`;
    el("#info-dialog").showModal();
  }

  /* ------------------------------------------------------- Starthilfe */

  /* Sprechblase unter dem Schnelleintrag. Sie erscheint nach der Einleitung
     — auch wenn diese übersprungen wurde — und hält niemanden auf: die App
     bleibt vollständig bedienbar. Sie verschwindet von selbst, sobald die
     erste Impfung eingetragen ist, spätestens auf Tippen von „Verstanden". */
  function renderCoach() {
    const box = el("#coach");
    if (!box) return;
    const s = state.settings || {};
    const p = activeProfile();
    const hatEintraege = (p.records || []).length > 0;
    const zeigen = !!s.setupDone && !s.coachDone && !hatEintraege;
    box.classList.toggle("hidden", !zeigen);
    if (!zeigen) return;

    /* Fehlt das Geburtsdatum, ist es der wichtigere der beiden Schritte —
       ohne es kann die App keine Fälligkeit berechnen. */
    el("#coach-text").innerHTML = p.birthdate
      ? `<strong>Jetzt die bisherigen Impfungen übertragen.</strong> Am
         schnellsten geht das mit dem <strong>Schnelleintrag</strong> oben:
         Dort trägst du alle Impfungen eines Termins auf einmal ein.`
      : `<strong>Zwei Schritte zum Start.</strong> Hinterlege unter
         <strong>Profil</strong> das Geburtsdatum — daraus berechnet die App
         die Fälligkeiten. Deine bisherigen Impfungen überträgst du dann am
         schnellsten über den <strong>Schnelleintrag</strong> oben.`;
  }

  function dismissCoach() {
    state.settings.coachDone = true;
    saveData();
    renderCoach();
  }

  /* ------------------------------------------------ Impfung im Pass suchen */

  /* Kombiniertes Feld: entweder aus der aufklappbaren Liste wählen oder
     tippen. Beides springt zur Impfung im Impfpass. */
  function setupVaccineSearch() {
    const feld = el("#vac-search-input");
    const liste = el("#vac-search-list");
    if (!feld || !liste) return;

    liste.innerHTML = STIKO_SCHEDULE.map((v) => {
      const zusatz = v.fullName && v.fullName !== v.name ? v.fullName : "";
      return `<option value="${esc(v.name)}">${esc(zusatz)}</option>`;
    }).join("");

    const finde = (text) => {
      const t = text.trim().toLowerCase();
      if (!t) return null;
      const passt = (s) => (s || "").toLowerCase();
      return (
        STIKO_SCHEDULE.find((v) => passt(v.name) === t) ||
        STIKO_SCHEDULE.find((v) => passt(v.fullName) === t) ||
        STIKO_SCHEDULE.find((v) => passt(v.name).includes(t)) ||
        STIKO_SCHEDULE.find((v) => passt(v.fullName).includes(t)) ||
        STIKO_SCHEDULE.find((v) => passt(v.disease).includes(t)) ||
        null
      );
    };

    const springe = () => {
      const v = finde(feld.value);
      if (!v) return;
      feld.value = "";
      feld.blur();
      // Komplett ausgeblendete Impfungen haben keine Zeile zum Anspringen.
      if (displayStateFor(v, activeProfile()) === "hidden") {
        showToast(`${v.name} ist ausgeblendet — unter „Profil" einblendbar.`);
        return;
      }
      gotoVaccineInPass(v.id);
    };

    feld.addEventListener("change", springe);
    feld.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        springe();
      }
    });
  }

  /* --------------------------------------------------------- Impfbuch-Regal */

  /* Jede Person bekommt ein eigenes Impfbuch. Die Angaben darin sind
     freiwillig und dienen nur der eigenen Übersicht — sie fließen in keine
     Berechnung ein und verlassen das Gerät nicht. */
  const BOOK_COLORS = [
    { id: "gelb", label: "Klassisch", value: "#d9a520" },
    { id: "rot", label: "Rot", value: "#b23a2e" },
    { id: "blau", label: "Blau", value: "#3d6b96" },
    { id: "gruen", label: "Grün", value: "#3f7a4d" },
    { id: "lila", label: "Lila", value: "#6b4a86" },
    { id: "braun", label: "Braun", value: "#7a5c3a" },
    { id: "grau", label: "Grau", value: "#5d6068" },
    { id: "tuerkis", label: "Türkis", value: "#2f7d7a" },
  ];
  /* Reihenfolge bestimmt die Anordnung: kurze Angaben stehen paarweise
     nebeneinander, mehrzeilige über die volle Breite. */
  const BOOK_FIELDS = [
    {
      key: "doctor",
      label: "Hausärztin / Hausarzt",
      placeholder: "Praxis oder Name",
    },
    { key: "insurer", label: "Krankenkasse", placeholder: "z. B. AOK" },
    {
      key: "insuranceNo",
      label: "Versichertennummer",
      placeholder: "auf der Gesundheitskarte",
    },
    {
      key: "bloodGroup",
      label: "Blutgruppe",
      placeholder: "z. B. 0 Rh+",
      options: ["A Rh+", "A Rh−", "B Rh+", "B Rh−", "AB Rh+", "AB Rh−", "0 Rh+", "0 Rh−"],
    },
    {
      key: "address",
      label: "Adresse",
      type: "textarea",
      placeholder: "Straße und Hausnummer, PLZ Ort",
    },
    {
      key: "allergies",
      label: "Allergien & Hinweise",
      type: "textarea",
      placeholder: "z. B. Unverträglichkeiten",
    },
    {
      key: "other",
      label: "Sonstiges",
      type: "textarea",
      placeholder: "Platz für alles Weitere",
    },
  ];

  function bookOf(profile) {
    return profile.book || (profile.book = { color: BOOK_COLORS[0].value });
  }

  // Dunklere Tönung derselben Farbe für Buchrücken und Kanten.
  function shade(hex, faktor) {
    const n = parseInt(hex.slice(1), 16);
    const mix = (v) => Math.max(0, Math.min(255, Math.round(v * faktor)));
    return (
      "#" +
      [(n >> 16) & 255, (n >> 8) & 255, n & 255]
        .map((v) => mix(v).toString(16).padStart(2, "0"))
        .join("")
    );
  }

  function initialsOf(name) {
    return (name || "?")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] || "")
      .join("")
      .toUpperCase();
  }

  /* Ein kleines Impfbuch als SVG — bewusst gezeichnet statt als Bilddatei,
     damit sich die Farbe frei wählen lässt und es auf jedem Bildschirm
     scharf bleibt. */
  function bookSvg(farbe, initialen) {
    const ruecken = shade(farbe, 0.72);
    const kante = shade(farbe, 0.86);
    return `
      <svg class="book-svg" viewBox="0 0 96 124" role="img" aria-hidden="true">
        <rect x="14" y="10" width="76" height="110" rx="7" fill="rgba(0,0,0,.22)"/>
        <rect x="8" y="4" width="80" height="112" rx="6" fill="${kante}"/>
        <rect x="8" y="4" width="14" height="112" rx="5" fill="${ruecken}"/>
        <rect x="20" y="7" width="65" height="106" rx="4" fill="${farbe}"/>
        <rect x="30" y="26" width="46" height="38" rx="3" fill="rgba(255,255,255,.88)"/>
        <text x="53" y="52" text-anchor="middle"
              font-family="Georgia, serif" font-size="21" font-weight="700"
              fill="${shade(farbe, 0.6)}">${esc(initialen)}</text>
        <rect x="30" y="74" width="46" height="4" rx="2" fill="rgba(255,255,255,.55)"/>
        <rect x="30" y="84" width="34" height="4" rx="2" fill="rgba(255,255,255,.4)"/>
        <rect x="30" y="94" width="40" height="4" rx="2" fill="rgba(255,255,255,.4)"/>
      </svg>`;
  }

  /* Zählt, was bei einer Person gerade ansteht — dieselbe Rechnung wie im
     Tab „Fällig", damit die Zahl am Buch und das Tab-Abzeichen übereinstimmen.
     Getrennt nach überfällig und bald, weil davon die Farbe abhängt. */
  function actionableCount(profile) {
    const leer = { gesamt: 0, ueberfaellig: 0 };
    if (!profile || !profile.birthdate) return leer;
    let gesamt = 0;
    let ueberfaellig = 0;
    for (const i of computeDueItems(profile)) {
      if (displayStateFor(i.vaccine, profile) !== "shown") continue;
      if (i.status === "overdue") {
        gesamt++;
        ueberfaellig++;
      } else if (i.status === "soon") gesamt++;
      else if (
        i.status === "optional" &&
        recordsFor(profile, i.vaccine.id).length === 0 &&
        (travelCountriesFor(i.vaccine.id, profile).length ||
          isMonitored(i.vaccine.id, profile))
      )
        gesamt++;
    }
    return { gesamt, ueberfaellig };
  }

  function renderBookShelf() {
    const shelf = el("#book-shelf");
    if (!shelf) return;
    const aktiv = activeProfile();
    shelf.innerHTML = state.profiles
      .map((p) => {
        const b = bookOf(p);
        const offen = actionableCount(p);
        // Gleiche Regel wie am Tab „Fällig": Rot nur bei Überfälligem.
        const abzeichen = offen.gesamt
          ? `<span class="book-badge${
              offen.ueberfaellig ? "" : " book-badge-soon"
            }" title="${offen.gesamt} Impfung(en) stehen an">${offen.gesamt}</span>`
          : "";
        /* Kein Button im Button — deshalb ein Behälter mit zwei getrennten
           Schaltflächen: das Buch wechselt die Person, der Knopf darunter
           öffnet die Angaben. */
        return `
          <div class="book ${p.id === aktiv.id ? "active" : ""}">
            <button class="book-select" data-pid="${p.id}"
                    title="Zu ${esc(p.name)} wechseln">
              <span class="book-art">${bookSvg(
                b.color || BOOK_COLORS[0].value,
                initialsOf(p.name)
              )}${abzeichen}</span>
              <span class="book-name">${esc(p.name)}</span>
            </button>
            <button class="btn-small book-edit" data-pid="${p.id}"
                    title="Farbe und Angaben von ${esc(p.name)} bearbeiten">
              Daten bearbeiten
            </button>
          </div>`;
      })
      .join("");
    shelf
      .querySelectorAll(".book-select")
      .forEach((b) => b.addEventListener("click", () => switchProfile(b.dataset.pid)));
    shelf
      .querySelectorAll(".book-edit")
      .forEach((b) => b.addEventListener("click", () => openBookDialog(b.dataset.pid)));
  }

  let bookEditId = null;

  function openBookDialog(pid) {
    const p = state.profiles.find((x) => x.id === pid);
    if (!p) return;
    bookEditId = pid;
    const b = bookOf(p);
    const farbe = b.color || BOOK_COLORS[0].value;

    el("#book-dlg-title").textContent = "Impfbuch von " + p.name;
    el("#book-preview").innerHTML = bookSvg(farbe, initialsOf(p.name));
    el("#book-colors").innerHTML = BOOK_COLORS.map(
      (c) =>
        `<button type="button" class="book-color${
          c.value.toLowerCase() === farbe.toLowerCase() ? " active" : ""
        }" data-color="${c.value}" style="--farbe:${c.value}" title="${c.label}">
           <span class="sr-only">${c.label}</span>
         </button>`
    ).join("");
    el("#book-color-free").value = farbe;
    el("#book-fields").innerHTML = BOOK_FIELDS.map((f) => {
      const wert = esc(b[f.key] || "");
      const platz = esc(f.placeholder || "");
      const listeId = f.options ? `book-opt-${f.key}` : "";
      const auswahl = f.options
        ? `<datalist id="${listeId}">${f.options
            .map((o) => `<option value="${esc(o)}"></option>`)
            .join("")}</datalist>`
        : "";
      const eingabe =
        f.type === "textarea"
          ? `<textarea rows="2" data-bookfield="${f.key}" placeholder="${platz}">${wert}</textarea>`
          : `<input type="text" data-bookfield="${f.key}" value="${wert}"
                    placeholder="${platz}" autocomplete="off"
                    ${listeId ? `list="${listeId}"` : ""} />`;
      return `<label class="book-field${f.type === "textarea" ? " wide" : ""}">
                <span class="book-field-label">${f.label}</span>
                ${eingabe}${auswahl}
              </label>`;
    }).join("");

    const waehle = (wert) => {
      el("#book-preview").innerHTML = bookSvg(wert, initialsOf(p.name));
      el("#book-color-free").value = wert;
      el("#book-colors")
        .querySelectorAll(".book-color")
        .forEach((c) =>
          c.classList.toggle("active", c.dataset.color.toLowerCase() === wert.toLowerCase())
        );
    };
    el("#book-colors")
      .querySelectorAll(".book-color")
      .forEach((c) => c.addEventListener("click", () => waehle(c.dataset.color)));
    el("#book-color-free").addEventListener("input", (e) => waehle(e.target.value));

    el("#book-dialog").showModal();
  }

  function saveBookDialog() {
    const p = state.profiles.find((x) => x.id === bookEditId);
    if (!p) return;
    const b = bookOf(p);
    b.color = el("#book-color-free").value;
    el("#book-fields")
      .querySelectorAll("[data-bookfield]")
      .forEach((f) => {
        const wert = f.value.trim();
        if (wert) b[f.dataset.bookfield] = wert;
        else delete b[f.dataset.bookfield];
      });
    saveData();
    render();
    el("#book-dialog").close();
  }

  /* -------------------------------------------------------------- Profile */

  function renderProfiles() {
    const active = activeProfile();

    // Umschalter im Deckblatt
    const sw = el("#profile-switch");
    sw.innerHTML =
      state.profiles
        .map(
          (p) =>
            `<option value="${p.id}" ${p.id === active.id ? "selected" : ""}>${esc(
              p.name
            )}</option>`
        )
        .join("") + `<option value="__add__">＋ Neue Person…</option>`;

    // Kopfzeile: Name + Alter
    const birth = parseDate(active.birthdate);
    const age = birth
      ? ` · ${Math.floor(ageInMonths(birth, new Date()) / 12)} Jahre`
      : "";
    el("#pass-holder").textContent = birth
      ? `${fmtDate(birth)}${age}`
      : "— (bitte im Profil ergänzen)";

    // Formular „aktives Profil"
    el("#profile-name").value = active.name || "";
    el("#profile-birthdate").value = active.birthdate || "";

    // Profil-Verwaltung (Chips)
    const mgr = el("#profile-manager");
    mgr.innerHTML = state.profiles
      .map(
        (p) =>
          `<button class="prof-chip ${p.id === active.id ? "active" : ""}" data-pid="${
            p.id
          }">${esc(p.name)}</button>`
      )
      .join("");
    mgr.querySelectorAll(".prof-chip").forEach((chip) =>
      chip.addEventListener("click", () => switchProfile(chip.dataset.pid))
    );

    el("#btn-delete-profile").disabled = state.profiles.length <= 1;
  }

  function switchProfile(pid) {
    if (pid === "__add__") return addProfile();
    state.activeProfileId = pid;
    saveData();
    render();
  }

  // ISO-Datum, das eine Anzahl Jahre in der Vergangenheit liegt.
  function dateYearsAgoISO(years) {
    const d = new Date();
    d.setFullYear(d.getFullYear() - years);
    return d.toISOString().slice(0, 10);
  }

  function addProfile() {
    // Gratis-Grenze: ohne Premium nur FREE_PROFILE_LIMIT Profile.
    if (!isPremium() && state.profiles.length >= FREE_PROFILE_LIMIT) {
      renderProfiles(); // Deckblatt-Select zurücksetzen (war evtl. auf „__add__")
      showPremiumDialog(
        `<p>In der kostenlosen Version kannst du bis zu <strong>${FREE_PROFILE_LIMIT} Profile</strong> anlegen — ideal für dich und eine weitere Person.</p>` +
          `<p>Mit <strong>Premium</strong> legst du <strong>beliebig viele</strong> Profile an, z. B. für die ganze Familie.</p>`
      );
      return;
    }
    el("#person-name").value = "";
    // Vorgabe 18 Jahre zurück — erspart langes Scrollen im Datums-Picker.
    el("#person-birthdate").value = dateYearsAgoISO(18);
    el("#person-dialog").showModal();
    el("#person-name").focus();
  }

  function submitPerson(e) {
    e.preventDefault();
    const name = el("#person-name").value.trim();
    if (!name) return;
    const p = defaultProfile(name);
    p.birthdate = el("#person-birthdate").value || "";
    state.profiles.push(p);
    state.activeProfileId = p.id;
    saveData();
    el("#person-dialog").close();
    render();
  }

  function cancelPersonDialog() {
    el("#person-dialog").close();
    renderProfiles(); // Auswahl im Deckblatt-Select zurücksetzen
  }

  function deleteProfile() {
    if (state.profiles.length <= 1) return;
    const active = activeProfile();
    showConfirm(
      "Person löschen",
      `<p>Das Profil <strong>${esc(active.name)}</strong> samt aller Impfeinträge wird <strong>unwiderruflich</strong> gelöscht.</p>`,
      "Endgültig löschen",
      () => {
        state.profiles = state.profiles.filter((p) => p.id !== active.id);
        state.activeProfileId = state.profiles[0].id;
        saveData();
        render();
      }
    );
  }

  function saveProfile() {
    const active = activeProfile();
    active.name = el("#profile-name").value.trim() || "Person";
    active.birthdate = el("#profile-birthdate").value;
    saveData();
    render();
  }

  /* ------------------------------------------------------------ Erinnerungen */

  function renderReminders() {
    const active = activeProfile();
    const box = el("#reminders");
    const count = el("#reminder-count");

    if (!active.birthdate) {
      count.classList.add("hidden");
      box.innerHTML = `<div class="form-card"><p class="hint" style="margin:0">Trage im Tab „Profil" das Geburtsdatum von <strong>${esc(
        active.name
      )}</strong> ein, damit die Fälligkeiten berechnet werden können.</p></div>`;
      return;
    }

    const shown = computeDueItems(active).filter(
      (i) => displayStateFor(i.vaccine, active) === "shown"
    );
    const due = []; // überfällig (Termin liegt in der Vergangenheit)
    const soon = []; // in den nächsten drei Monaten fällig
    const rec = []; // Reise-/Überwachungs-Empfehlung, noch nicht geimpft
    const upcoming = []; // künftige Termine mit Datum

    for (const i of shown) {
      const travelC = travelCountriesFor(i.vaccine.id, active);
      const mon = isMonitored(i.vaccine.id, active);
      const done = recordsFor(active, i.vaccine.id).length;
      if (i.status === "overdue") {
        due.push(i);
      } else if (i.status === "soon") {
        soon.push(i);
      } else if (i.status === "optional" && (travelC.length || mon) && done === 0) {
        rec.push({ item: i, countries: travelC, mon });
      } else if (i.status === "future" && i.next && i.next.dueDate) {
        upcoming.push(i);
      }
    }
    due.sort((a, b) => (a.days ?? 0) - (b.days ?? 0));
    soon.sort((a, b) => (a.days ?? 0) - (b.days ?? 0));
    upcoming.sort((a, b) => a.next.dueDate - b.next.dueDate);
    const bald = upcoming.filter((i) => i.days < VORSCHAU_TAGE);
    const spaeter = upcoming.filter((i) => i.days >= VORSCHAU_TAGE);

    const actionable = due.length + soon.length + rec.length;
    count.textContent = actionable;
    count.classList.toggle("hidden", actionable === 0);
    /* Rot schlägt Gelb: Sobald etwas überfällig ist, zählt nur noch das —
       auch wenn zusätzlich Termine bald anstehen. Gelb bleibt dem Fall
       vorbehalten, dass nichts überfällig, aber etwas in Sicht ist. */
    count.classList.toggle("badge-soon", due.length === 0 && actionable > 0);

    const dueCard = (i) => {
      const meta = STATUS_META[i.status];
      const when = relTime(i.days);
      const mon = isMonitored(i.vaccine.id, active) && i.doneCount > 0;
      const sub = mon
        ? `Auffrischung fällig ${fmtDate(i.next.dueDate)} (${when})`
        : `${esc(i.next.label)} · fällig ${fmtDate(i.next.dueDate)} (${when})`;
      const trav = travelCountriesFor(i.vaccine.id, active);
      const travTag = trav.length
        ? `<div class="rem-note">🧳 Reiseempfehlung: ${trav
            .map((c) => esc(c.name))
            .join(", ")}</div>`
        : "";
      return `
        <div class="reminder ${meta.cls} rem-clickable" data-goto="${i.vaccine.id}" title="Im Impfpass ansehen">
          <div class="rem-body">
            <div class="rem-title">${esc(i.vaccine.name)}</div>
            <div class="rem-sub">${sub}</div>
            ${travTag}
          </div>
          <button class="rem-action" data-vaccine="${i.vaccine.id}">Eintragen</button>
        </div>`;
    };

    const recCard = (e) => {
      const i = e.item;
      const why = e.countries.length
        ? `🧳 Für Reise empfohlen: ${e.countries.map((c) => esc(c.name)).join(", ")}`
        : `Zur Überwachung ausgewählt`;
      return `
        <div class="reminder st-soon rem-clickable" data-goto="${i.vaccine.id}" title="Im Impfpass ansehen">
          <div class="rem-body">
            <div class="rem-title">${esc(i.vaccine.name)}</div>
            <div class="rem-sub">Noch nicht geimpft</div>
            <div class="rem-note">${why}</div>
          </div>
          <button class="rem-action" data-vaccine="${i.vaccine.id}">Eintragen</button>
        </div>`;
    };

    const upcomingRow = (i) => {
      const mon = isMonitored(i.vaccine.id, active) && i.doneCount > 0;
      const label = mon
        ? `Gültig bis ${fmtDate(i.next.dueDate)}`
        : `${esc(i.next.label)}`;
      return `
        <div class="upcoming-row rem-clickable" data-goto="${i.vaccine.id}" title="Im Impfpass ansehen">
          <span class="up-date">${fmtDate(i.next.dueDate)}</span>
          <span class="up-body">
            <span class="up-title">${esc(i.vaccine.name)}</span>
            <span class="up-sub">${label} · ${relTime(i.days)}</span>
          </span>
        </div>`;
    };

    let html = "";
    if (actionable === 0) {
      html += `<div class="form-card"><p class="hint ok" style="margin:0">✓ Für ${esc(
        active.name
      )} ist aktuell keine Impfung fällig.</p></div>`;
    } else {
      // Rot: der Termin ist vorbei. Nur hier besteht echter Rückstand.
      if (due.length) {
        html += `
        <div class="pass-section">
          <div class="pass-section-head" style="--group-color:#c0392b"><span>Jetzt fällig</span></div>
          <div class="rem-group">${due.map(dueCard).join("")}</div>
        </div>`;
      }
      /* Gelb: steht in den nächsten drei Monaten an. Reise- und
         Überwachungs-Empfehlungen ohne festes Datum stehen ebenfalls hier —
         sie sind zu planen, aber nicht überfällig. */
      if (soon.length || rec.length) {
        html += `
        <div class="pass-section">
          <div class="pass-section-head" style="--group-color:#c8901f"><span>Bald fällig</span></div>
          <div class="rem-group">${
            soon.map(dueCard).join("") + rec.map(recCard).join("")
          }</div>
        </div>`;
      }
    }
    if (bald.length) {
      html += `
        <div class="pass-section">
          <div class="pass-section-head" style="--group-color:#4a7ba6"><span>Kommende Impftermine</span></div>
          <div class="upcoming-group">${bald.map(upcomingRow).join("")}</div>
        </div>`;
    }
    if (spaeter.length) {
      html += `
        <details class="pass-section upcoming-later">
          <summary>
            <span>Impftermine in 5 Jahren oder später</span>
            <span class="later-count">${spaeter.length}</span>
          </summary>
          <div class="upcoming-group">${spaeter.map(upcomingRow).join("")}</div>
        </details>`;
    }

    box.innerHTML = html;
    box.querySelectorAll(".rem-action").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation(); // nicht zusätzlich in den Impfpass springen
        openRecordDialog(btn.dataset.vaccine);
      });
    });
    // Tippen auf den Eintrag springt in den Impfpass zu genau dieser Impfung —
    // dort sind die bisherigen Eintragungen zu sehen.
    box.querySelectorAll("[data-goto]").forEach((row) => {
      row.addEventListener("click", () => gotoVaccineInPass(row.dataset.goto));
    });
  }

  /*
   * Wechselt in den Impfpass und hebt die gewählte Impfung kurz hervor. Ist
   * sie dort eingeklappt (z. B. altersbedingt), wird trotzdem hingesprungen —
   * die graue Zeile nennt dann den Grund.
   */
  function gotoVaccineInPass(vacId) {
    if (!vacId) return;
    activateTab("pass");
    const row = document.querySelector('[data-vac-row="' + vacId + '"]');
    if (!row) return;
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.classList.remove("vac-flash");
    void row.offsetWidth; // Animation neu starten, falls dieselbe Zeile
    row.classList.add("vac-flash");
    setTimeout(() => row.classList.remove("vac-flash"), 2200);
  }

  /* --------------------------------------------------------------- Impfpass */

  function renderPass() {
    const active = activeProfile();
    const items = computeDueItems(active)
      .map((i) => ({ ...i, dstate: displayStateFor(i.vaccine, active) }))
      .filter((i) => i.dstate !== "hidden");
    const byGroup = {};
    for (const item of items) {
      const g = item.vaccine.group;
      (byGroup[g] = byGroup[g] || []).push(item);
    }

    const container = el("#pass-pages");
    container.innerHTML = "";

    for (const [gid, meta] of Object.entries(GROUPS)) {
      const groupItems = byGroup[gid];
      if (!groupItems || !groupItems.length) continue;

      const section = document.createElement("div");
      section.className = "pass-section";
      section.innerHTML = `
        <div class="pass-section-head" style="--group-color:${meta.color}">
          <span>${meta.label}</span>
        </div>`;

      groupItems.forEach((item) => {
        section.appendChild(
          item.dstate === "collapsed"
            ? renderCollapsedRow(item, meta.color)
            : renderVaccineRow(item, meta.color)
        );
      });
      container.appendChild(section);
    }
  }

  // Kleine graue Zeile für eingeklappte Impfungen mit Info + Aktionen.
  function renderCollapsedRow(item, color) {
    const vac = item.vaccine;
    const reason = hiddenReason(vac, activeProfile());
    const row = document.createElement("div");
    row.className = "vac-row collapsed-row";
    row.dataset.vacRow = vac.id;
    row.innerHTML = `
      <div class="collapsed-head">
        <span class="collapsed-name">${esc(vac.name)}</span>
        <button class="btn-info" data-vaccine="${vac.id}" title="Grund & Informationen" aria-label="Informationen zu ${esc(vac.name)}">i</button>
        <span class="collapsed-note">${esc(reason || "ausgeblendet")}</span>
      </div>
      <div class="collapsed-actions">
        <button class="link-btn show-btn" data-vaccine="${vac.id}">Trotzdem einblenden</button>
        <button class="link-btn hard-btn" data-vaccine="${vac.id}">Komplett ausblenden</button>
      </div>`;
    row.querySelector(".btn-info").addEventListener("click", () =>
      openInfoDialog(vac.id)
    );
    row.querySelector(".show-btn").addEventListener("click", () =>
      setVState(vac.id, "shown")
    );
    row.querySelector(".hard-btn").addEventListener("click", () =>
      setVState(vac.id, "hidden")
    );
    return row;
  }

  function renderVaccineRow(item, color) {
    const vac = item.vaccine;
    const meta = STATUS_META[item.status];
    const row = document.createElement("div");
    row.className = "vac-row";
    row.dataset.vacRow = vac.id;

    let entriesHtml;
    if (item.records.length) {
      const rows = item.records
        .map((r, idx) => {
          const doseLabel =
            (vac.series && vac.series[idx] && vac.series[idx].label) ||
            (vac.booster ? vac.booster.label : "Impfung " + (idx + 1));
          const others = r.targets.filter((t) => t !== vac.id);
          const comboTag = others.length
            ? `<span class="combo-tag" title="Kombinationsimpfung">Kombi: ${others
                .map((t) => esc(vaccineNameById(t)))
                .join(", ")}</span>`
            : "";
          const productLine =
            r.product || r.batch
              ? `<span class="ve-product">${
                  r.product ? esc(r.product) : "—"
                }</span>`
              : `<span class="ve-product muted">—</span>`;
          const meta2 = [doseLabel];
          if (r.batch) meta2.push("Charge " + esc(r.batch));
          return `
            <div class="ve-row">
              <span class="ve-date">${fmtDate(parseDate(r.date))}</span>
              <span class="ve-mid">
                ${productLine}
                <span class="ve-meta">${meta2.join(" · ")}${
            comboTag ? " · " + comboTag : ""
          }</span>
              </span>
              <span class="ve-doctor${r.doctor ? "" : " muted"}">${
            r.doctor ? esc(r.doctor) : "—"
          }</span>
              <span class="ve-actions">
                <button class="ve-edit" data-rec="${r.id}" title="Eintrag bearbeiten">✎</button>
                <button class="ve-del" data-rec="${r.id}" title="Eintrag löschen">✕</button>
              </span>
            </div>`;
        })
        .join("");
      entriesHtml = `
        <div class="ve-head">
          <span>Datum</span><span>Impfstoff / Charge</span><span>Arzt / Stempel</span><span></span>
        </div>
        ${rows}`;
    } else {
      entriesHtml = `<div class="ve-empty">Noch keine Impfung eingetragen</div>`;
    }

    const active = activeProfile();
    const monitored = isMonitored(vac.id, active);
    const travelC = travelCountriesFor(vac.id, active);

    let nextHtml;
    if (item.status === "complete") {
      nextHtml = `<span class="next-complete">✓ vollständig</span>`;
    } else if (monitored && item.doneCount > 0 && item.next && item.next.dueDate) {
      nextHtml =
        item.status === "overdue"
          ? `<span class="next-overdue">⚠ Auffrischung fällig (seit ${fmtDate(
              item.next.dueDate
            )})</span>`
          : `<span class="next-valid">✓ Gültig bis ${fmtDate(
              item.next.dueDate
            )}</span>`;
    } else if (item.status === "optional") {
      nextHtml = `<span class="next-optional">Bei Bedarf / Reise</span>`;
    } else if (item.next && item.next.dueDate) {
      nextHtml = `<span class="next-date">Nächste: ${fmtDate(item.next.dueDate)}</span>`;
    } else {
      nextHtml = `<span class="next-date muted">—</span>`;
    }

    const badges = [];
    if (travelC.length)
      badges.push(
        `<span class="tag-travel">🧳 Reiseempfehlung: ${travelC
          .map((c) => esc(c.name))
          .join(", ")}</span>`
      );
    if (monitored)
      badges.push(`<span class="tag-monitor">Wird überwacht</span>`);
    const badgesHtml = badges.length
      ? `<div class="vac-badges">${badges.join("")}</div>`
      : "";

    /* „Wegen Alter ausblenden" nur dort anbieten, wo das Alter tatsächlich
       eine Rolle spielt: Impfungen mit oberer Altersgrenze, altersgebundene
       Gruppen (Kindes-/Jugendalter, ab 60) und früher übliche Impfungen.
       Bei Reise- und Indikationsimpfungen entscheidet nicht das Alter,
       sondern der Anlass — dort wäre der Knopf sinnlos. */
    const ALTERSGRUPPEN = ["kind", "jugend", "senior", "historisch"];
    const alterRelevant =
      INFANT_ONLY[vac.id] != null ||
      vac.retired === true ||
      ALTERSGRUPPEN.includes(vac.group);
    const ageHideBtn = alterRelevant
      ? `<button class="btn-hide btn-agehide" data-vaccine="${vac.id}" title="Ausblenden, weil sie in deinem Alter nicht mehr empfohlen ist">${svgIcon(
          "calendar",
          "ic-btn"
        )}Wegen Alter ausblenden</button>`
      : "";

    const canMonitor = VALID_YEARS[vac.id] || vac.group === "senior";
    const monitorBtn = canMonitor
      ? `<button class="btn-hide btn-monitor${
          monitored ? " active" : ""
        }" data-vaccine="${vac.id}" title="Gültigkeit dieser Impfung überwachen">${svgIcon(
          monitored ? "check" : "bell",
          "ic-btn"
        )}${monitored ? "Überwachung aktiv" : "Gültigkeit überwachen"}</button>`
      : "";

    row.innerHTML = `
      <div class="vac-head" style="--group-color:${color}">
        <div class="vac-title-wrap">
          <div class="vac-title">${esc(vac.name)}
            <button class="btn-info" data-vaccine="${vac.id}" title="Informationen & Dringlichkeit" aria-label="Informationen zu ${esc(vac.name)}">i</button>
          </div>
          <div class="vac-full">${esc(vac.fullName)}</div>
        </div>
        <span class="status-badge ${meta.cls}">${meta.label}</span>
      </div>
      <div class="vac-info">${esc(vac.info)}${
      vac.riskNote ? ` <em>${esc(vac.riskNote)}</em>` : ""
    }</div>
      ${badgesHtml}
      <div class="vac-entries">${entriesHtml}</div>
      <div class="vac-foot">
        ${nextHtml}
        <div class="foot-actions">
          ${monitorBtn}
          <button class="btn-hide btn-collapse" data-vaccine="${vac.id}" title="Diese Impfung ausblenden">${svgIcon(
      "ban",
      "ic-btn"
    )}Ausblenden</button>
          ${ageHideBtn}
          <button class="btn-small add-record" data-vaccine="${vac.id}">+ Impfung eintragen</button>
        </div>
      </div>`;

    row.querySelector(".add-record").addEventListener("click", () =>
      openRecordDialog(vac.id)
    );
    row.querySelector(".btn-collapse").addEventListener("click", () =>
      setVState(vac.id, "collapsed")
    );
    const alterBtn = row.querySelector(".btn-agehide");
    if (alterBtn)
      alterBtn.addEventListener("click", () => setVState(vac.id, "age-hidden"));
    const monBtn = row.querySelector(".btn-monitor");
    if (monBtn)
      monBtn.addEventListener("click", () => toggleMonitor(vac.id));
    row.querySelector(".btn-info").addEventListener("click", () =>
      openInfoDialog(vac.id)
    );
    row.querySelectorAll(".ve-del").forEach((btn) =>
      btn.addEventListener("click", () => deleteRecord(btn.dataset.rec))
    );
    row.querySelectorAll(".ve-edit").forEach((btn) =>
      btn.addEventListener("click", () => openEditRecord(btn.dataset.rec))
    );
    return row;
  }

  /* ---------------------------------------------------- Dialog: Bearbeiten */

  function openEditRecord(recId) {
    const active = activeProfile();
    const rec = active.records.find((r) => r.id === recId);
    if (!rec) return;
    el("#edit-id").value = rec.id;
    el("#edit-date").value = rec.date || "";
    el("#edit-product").value = rec.product || "";
    el("#edit-batch").value = rec.batch || "";
    el("#edit-doctor").value = rec.doctor || "";
    el("#edit-covers").textContent = rec.targets
      .map((t) => vaccineNameById(t))
      .join(", ");

    // Weitere Einträge am selben Tag? → Option „für alle" anbieten.
    const sameDay = active.records.filter((r) => r.date === rec.date);
    const wrap = el("#edit-allday-wrap");
    el("#edit-allday").checked = false;
    if (sameDay.length > 1) {
      wrap.classList.remove("hidden");
      el("#edit-allday-label").textContent = `Änderung auf alle ${sameDay.length} Impfungen vom ${fmtDate(
        parseDate(rec.date)
      )} anwenden (z. B. Kombinationsimpfung)`;
    } else {
      wrap.classList.add("hidden");
    }
    el("#edit-dialog").showModal();
  }

  function submitEditRecord(e) {
    e.preventDefault();
    const active = activeProfile();
    const rec = active.records.find((r) => r.id === el("#edit-id").value);
    if (!rec) return;
    const newDate = el("#edit-date").value;
    if (!newDate) return;
    const product = el("#edit-product").value.trim();
    const batch = el("#edit-batch").value.trim();
    const doctor = el("#edit-doctor").value.trim();
    const allDay = el("#edit-allday").checked;

    // Betroffene Einträge: nur dieser oder alle vom (alten) Tag.
    const targets = allDay
      ? active.records.filter((r) => r.date === rec.date)
      : [rec];
    targets.forEach((r) => {
      r.date = newDate;
      r.product = product;
      r.batch = batch;
      r.doctor = doctor;
    });
    saveData();
    el("#edit-dialog").close();
    render();
  }

  /* ---------------------------------------------------------- Dialog: Eintrag */

  let dialogPrimary = null;
  let recordDates = []; // gesammelte Impfdaten für den Einzel-Dialog

  function openRecordDialog(vaccineId) {
    const vac = byId(vaccineId);
    if (!vac) return;
    dialogPrimary = vaccineId;
    recordDates = [];

    el("#dlg-title").textContent = `Impfung eintragen — ${activeProfile().name}`;
    el("#dlg-date").value = new Date().toISOString().slice(0, 10);
    el("#dlg-product").value = "";
    el("#dlg-batch").value = "";
    el("#dlg-doctor").value = "";

    renderPresets(vaccineId);
    renderTargetChecklist(vaccineId, new Set([vaccineId]));
    renderRecordDates();
    el("#record-dialog").showModal();
  }

  function addRecordDate() {
    const d = el("#dlg-date").value;
    if (!d) return;
    if (!recordDates.includes(d)) {
      recordDates.push(d);
      recordDates.sort();
    }
    renderRecordDates();
  }

  function renderRecordDates() {
    const box = el("#dlg-datelist");
    if (!recordDates.length) {
      box.innerHTML = "";
      return;
    }
    box.innerHTML = recordDates
      .map(
        (d) =>
          `<span class="date-chip">${fmtDate(parseDate(d))}
             <button type="button" class="date-chip-x" data-date="${d}">✕</button>
           </span>`
      )
      .join("");
    box.querySelectorAll(".date-chip-x").forEach((btn) =>
      btn.addEventListener("click", () => {
        recordDates = recordDates.filter((x) => x !== btn.dataset.date);
        renderRecordDates();
      })
    );
  }

  function effectiveRecordDates() {
    if (recordDates.length) return recordDates.slice();
    const d = el("#dlg-date").value;
    return d ? [d] : [];
  }

  function renderPresets(vaccineId) {
    const relevant = COMBINATIONS.filter((c) => c.targets.includes(vaccineId));
    const box = el("#dlg-presets");
    if (!relevant.length) {
      box.innerHTML = "";
      box.classList.add("hidden");
      return;
    }
    box.classList.remove("hidden");
    box.innerHTML =
      `<div class="preset-hint">Kombinationsimpfung? Schnellauswahl:</div>` +
      relevant
        .map(
          (c) =>
            `<button type="button" class="preset-chip" data-combo="${c.id}">
               ${esc(c.name)} <span class="pc-full">${esc(c.full)}</span>
             </button>`
        )
        .join("");
    box.querySelectorAll(".preset-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const combo = COMBINATIONS.find((c) => c.id === chip.dataset.combo);
        applyPreset(combo);
      });
    });
  }

  function applyPreset(combo) {
    if (!combo) return;
    const set = new Set(combo.targets);
    set.add(dialogPrimary);
    renderTargetChecklist(dialogPrimary, set);
    if (!el("#dlg-product").value) el("#dlg-product").value = combo.full;
  }

  function renderTargetChecklist(primaryId, checkedSet) {
    const primary = byId(primaryId);
    const box = el("#dlg-targets");
    const extras = STIKO_SCHEDULE.filter((v) => v.id !== primaryId);
    const anyExtra = extras.some((v) => checkedSet.has(v.id));

    const extrasHtml = extras
      .map(
        (v) => `
        <label class="tgt-item">
          <input type="checkbox" value="${v.id}" ${
          checkedSet.has(v.id) ? "checked" : ""
        } />
          <span>${esc(v.name)}</span>
        </label>`
      )
      .join("");

    box.innerHTML = `
      <label class="tgt-item tgt-primary">
        <input type="checkbox" value="${primary.id}" ${
      checkedSet.has(primary.id) ? "checked" : ""
    } />
        <span>${esc(primary.name)}</span>
        <span class="tgt-primary-tag">gewählt</span>
      </label>
      <details class="tgt-more" ${anyExtra ? "open" : ""}>
        <summary>+ Weitere Impfung am selben Termin (Kombinationsimpfung)</summary>
        <div class="tgt-grid">${extrasHtml}</div>
      </details>`;
  }

  function submitRecord(e) {
    e.preventDefault();
    const targets = [
      ...el("#dlg-targets").querySelectorAll("input:checked"),
    ].map((i) => i.value);
    if (!targets.length && dialogPrimary) targets.push(dialogPrimary);
    if (!targets.length) return;

    const dates = effectiveRecordDates();
    if (!dates.length) return;
    const product = el("#dlg-product").value.trim();
    const batch = el("#dlg-batch").value.trim();
    const doctor = el("#dlg-doctor").value.trim();

    // Für jedes Datum ein Eintrag mit den gewählten (Kombi-)Impfungen.
    dates.forEach((date) => {
      activeProfile().records.push({
        id: uid("r"),
        date,
        product,
        batch,
        doctor,
        targets,
      });
    });
    saveData();
    el("#record-dialog").close();
    render();
  }

  let pendingDelete = null; // { recId, date }

  function deleteRecord(recId) {
    const active = activeProfile();
    const rec = active.records.find((r) => r.id === recId);
    if (!rec) return;
    const sameDay = active.records.filter((r) => r.date === rec.date);

    // Weitere Impfungen am selben Tag → Nachfrage mit Optionen.
    if (sameDay.length > 1) {
      pendingDelete = { recId, date: rec.date };
      el("#delete-msg").innerHTML = `Am <strong>${fmtDate(
        parseDate(rec.date)
      )}</strong> sind <strong>${sameDay.length}</strong> Impfungen eingetragen (evtl. eine Kombinations- oder Mehrfachimpfung).<br />Möchtest du nur diesen Eintrag oder alle Impfungen dieses Tages löschen?`;
      el("#delete-dialog").showModal();
      return;
    }

    const msg =
      rec.targets.length > 1
        ? "<p>Dieser Eintrag ist eine <strong>Kombinationsimpfung</strong> und zählt für mehrere Impfungen. Wirklich löschen?</p>"
        : `<p>Den Impfeintrag vom <strong>${fmtDate(
            parseDate(rec.date)
          )}</strong> wirklich löschen?</p>`;
    showConfirm("Impfeintrag löschen", msg, "Löschen", () => {
      active.records = active.records.filter((r) => r.id !== recId);
      saveData();
      render();
    });
  }

  function performDelete(scope) {
    if (!pendingDelete) return;
    const active = activeProfile();
    if (scope === "all") {
      active.records = active.records.filter(
        (r) => r.date !== pendingDelete.date
      );
    } else {
      active.records = active.records.filter(
        (r) => r.id !== pendingDelete.recId
      );
    }
    pendingDelete = null;
    el("#delete-dialog").close();
    saveData();
    render();
  }

  /* ------------------------------------------------------ Schnelleintrag */

  let quickDates = []; // gesammelte Impfdaten für den Schnelleintrag

  // Beliebig viele Impfungen UND beliebig viele Daten auf einmal eintragen.
  function openQuickDialog() {
    quickDates = [];
    el("#q-date").value = new Date().toISOString().slice(0, 10);
    el("#q-product").value = "";
    el("#q-doctor").value = "";
    el("#q-title").textContent = `Schnelleintrag — ${activeProfile().name}`;
    renderQuickPresets();
    renderQuickChecklist();
    renderQuickDates();
    updateQuickCount();
    el("#quick-dialog").showModal();
  }

  function addQuickDate() {
    const d = el("#q-date").value;
    if (!d) return;
    if (!quickDates.includes(d)) {
      quickDates.push(d);
      quickDates.sort(); // ISO-Datumsstrings sortieren chronologisch korrekt
    }
    renderQuickDates();
    updateQuickCount();
  }

  function renderQuickDates() {
    const box = el("#q-datelist");
    if (!quickDates.length) {
      box.innerHTML = "";
      return;
    }
    box.innerHTML = quickDates
      .map(
        (d) =>
          `<span class="date-chip">${fmtDate(parseDate(d))}
             <button type="button" class="date-chip-x" data-date="${d}">✕</button>
           </span>`
      )
      .join("");
    box.querySelectorAll(".date-chip-x").forEach((btn) =>
      btn.addEventListener("click", () => {
        quickDates = quickDates.filter((x) => x !== btn.dataset.date);
        renderQuickDates();
        updateQuickCount();
      })
    );
  }

  // Effektive Datumsliste: die gesammelten Chips, sonst das Einzelfeld.
  function effectiveQuickDates() {
    if (quickDates.length) return quickDates.slice();
    const d = el("#q-date").value;
    return d ? [d] : [];
  }

  function renderQuickPresets() {
    const box = el("#q-presets");
    box.innerHTML =
      `<div class="preset-hint">Kombinationsimpfung anhaken:</div>` +
      COMBINATIONS.map(
        (c) =>
          `<button type="button" class="preset-chip" data-combo="${c.id}">${esc(
            c.name
          )}</button>`
      ).join("");
    box.querySelectorAll(".preset-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const combo = COMBINATIONS.find((c) => c.id === chip.dataset.combo);
        combo.targets.forEach((t) => {
          const cb = el(`#q-checklist input[value="${t}"]`);
          if (cb) cb.checked = true;
        });
        if (!el("#q-product").value) el("#q-product").value = combo.full;
        updateQuickCount();
      });
    });
  }

  function renderQuickChecklist() {
    const box = el("#q-checklist");
    const active = activeProfile();
    let html = "";
    for (const [gid, meta] of Object.entries(GROUPS)) {
      // Nur komplett verborgene Impfungen ausschließen — altersbedingt
      // eingeklappte bleiben wählbar (z. B. Hib beim Nachtragen der
      // Kindheitsimpfungen über das 6-fach-Preset).
      const vacs = STIKO_SCHEDULE.filter(
        (v) => v.group === gid && displayStateFor(v, active) !== "hidden"
      );
      if (!vacs.length) continue;
      const items = vacs
        .map(
          (v) => `
          <label class="tgt-item">
            <input type="checkbox" value="${v.id}" />
            <span>${esc(v.name)}</span>
          </label>`
        )
        .join("");
      // Früher übliche Impfungen zugeklappt anbieten: Sie betreffen nur alte
      // Impfausweise und sollen die normale Auswahl nicht überladen.
      if (gid === "historisch") {
        html += `
          <details class="q-historic">
            <summary style="--group-color:${meta.color}">
              ${esc(meta.label)}
              <span class="q-historic-hint">Pocken, BCG, Masern/Mumps/Röteln einzeln …</span>
            </summary>
            <div class="q-group">${items}</div>
          </details>`;
        continue;
      }
      html += `<div class="q-group-head" style="--group-color:${meta.color}">${esc(
        meta.label
      )}</div><div class="q-group">`;
      html += items;
      html += `</div>`;
    }
    box.innerHTML = html;
    box.querySelectorAll("input").forEach((cb) =>
      cb.addEventListener("change", updateQuickCount)
    );
  }

  function updateQuickCount() {
    const n = el("#q-checklist").querySelectorAll("input:checked").length;
    const m = effectiveQuickDates().length;
    const total = n * m;
    const box = el("#q-count");
    if (total === 0) {
      box.textContent = "Nichts ausgewählt";
    } else {
      box.innerHTML = `<strong>${n}</strong> Impfung(en) × <strong>${m}</strong> Datum/Daten = <strong>${total}</strong> Eintrag/Einträge`;
    }
    el("#q-save").disabled = total === 0;
  }

  function submitQuick(e) {
    e.preventDefault();
    const dates = effectiveQuickDates();
    const product = el("#q-product").value.trim();
    const doctor = el("#q-doctor").value.trim();
    const ids = [
      ...el("#q-checklist").querySelectorAll("input:checked"),
    ].map((i) => i.value);
    if (!ids.length || !dates.length) return;

    // Jede angehakte Impfung wird für JEDES Datum als eigener Eintrag erfasst —
    // z. B. dieselbe Auffrischung über mehrere Jahre auf einmal nachtragen.
    ids.forEach((id) => {
      dates.forEach((date) => {
        activeProfile().records.push({
          id: uid("r"),
          date,
          product,
          batch: "",
          doctor,
          targets: [id],
        });
      });
    });
    saveData();
    el("#quick-dialog").close();
    render();
  }

  /* --------------------------------------------------- Import / Export / Reset */

  function exportData() {
    // Nur eine Person → direkt exportieren, sonst Auswahl anbieten.
    if (state.profiles.length <= 1) {
      downloadExport(state.profiles.map((p) => p.id));
      return;
    }
    const box = el("#export-list");
    box.innerHTML = state.profiles
      .map(
        (p) => `
        <label class="tgt-item">
          <input type="checkbox" value="${p.id}" checked />
          <span>${esc(p.name)}</span>
        </label>`
      )
      .join("");
    el("#export-dialog").showModal();
  }

  function doExport() {
    const ids = [
      ...el("#export-list").querySelectorAll("input:checked"),
    ].map((i) => i.value);
    if (!ids.length) return;
    el("#export-dialog").close();
    downloadExport(ids);
  }

  async function downloadExport(ids) {
    const profiles = state.profiles.filter((p) => ids.includes(p.id));
    if (!profiles.length) return;
    const data = {
      version: state.version || 2,
      activeProfileId: ids.includes(state.activeProfileId)
        ? state.activeProfileId
        : ids[0],
      profiles,
      settings: state.settings || { notifyEnabled: false },
    };
    const namePart =
      profiles.length === 1
        ? profiles[0].name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()
        : `${profiles.length}-personen`;
    const filename = `impfpass-${namePart}-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    // Läuft über die Native-Brücke: in der Android-App per Dateisystem +
    // Teilen-Dialog, im Browser als klassischer Download.
    try {
      await window.NativeBridge.saveTextFile(
        filename,
        JSON.stringify(data, null, 2),
        "application/json"
      );
    } catch (e) {
      console.warn("Export fehlgeschlagen:", e);
      showMessage(
        "Export fehlgeschlagen",
        "<p>Die Datei konnte nicht gespeichert/geteilt werden. Bitte versuche es erneut.</p>"
      );
    }
  }

  /* ----------------------------------------------------------------- Backup */

  function openBackup() {
    // Auswahl auf „Alles" zurücksetzen und Profil-Liste vorbereiten.
    el("#backup-dialog")
      .querySelectorAll('input[name="backup-scope"]')
      .forEach((r) => (r.checked = r.value === "all"));
    el("#backup-list").innerHTML = state.profiles
      .map(
        (p) => `
        <label class="tgt-item">
          <input type="checkbox" value="${p.id}" checked />
          <span>${esc(p.name)}</span>
        </label>`
      )
      .join("");
    updateBackupScopeUI();
    el("#backup-dialog").showModal();
  }

  function selectedBackupScope() {
    const r = el('#backup-dialog input[name="backup-scope"]:checked');
    return r ? r.value : "all";
  }

  // Profil-Auswahl nur bei „Bestimmte Profile" einblenden.
  function updateBackupScopeUI() {
    el("#backup-list").classList.toggle(
      "hidden",
      selectedBackupScope() !== "some"
    );
  }

  function doBackup() {
    const scope = selectedBackupScope();
    let ids;
    let includeSettings = false;
    if (scope === "all") {
      ids = state.profiles.map((p) => p.id);
      includeSettings = true;
    } else if (scope === "profiles") {
      ids = state.profiles.map((p) => p.id);
    } else {
      ids = [...el("#backup-list").querySelectorAll("input:checked")].map(
        (i) => i.value
      );
      if (!ids.length) return; // nichts gewählt
    }
    el("#backup-dialog").close();
    saveBackup(ids, includeSettings);
  }

  async function saveBackup(ids, includeSettings) {
    const profiles = state.profiles.filter((p) => ids.includes(p.id));
    if (!profiles.length) return;
    const data = {
      app: "impfbuch",
      type: "backup",
      version: state.version || 2,
      createdAt: new Date().toISOString(),
      includesSettings: !!includeSettings,
      activeProfileId: ids.includes(state.activeProfileId)
        ? state.activeProfileId
        : ids[0],
      profiles,
    };
    if (includeSettings) data.settings = state.settings;

    const filename = `impfbuch-backup-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    try {
      await window.NativeBridge.saveTextFile(
        filename,
        JSON.stringify(data, null, 2),
        "application/json"
      );
      showMessage(
        "Backup erstellt",
        `<p>${svgIcon(
          "check",
          "ic-inline"
        )} Deine Backup-Datei <strong>${esc(filename)}</strong> wurde erstellt${
          includeSettings ? " — inklusive Einstellungen" : ""
        }.</p>` +
          `<p class="hint" style="margin:8px 0 0">Bewahre die Datei sicher auf. Du kannst sie jederzeit über „Importieren" wiederherstellen.</p>`
      );
    } catch (e) {
      console.warn("Backup fehlgeschlagen:", e);
      showMessage(
        "Backup fehlgeschlagen",
        "<p>Die Datei konnte nicht gespeichert/geteilt werden. Bitte versuche es erneut.</p>"
      );
    }
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        // Vollständiges Backup (unser Format) inkl. Einstellungen?
        const restoreSettings =
          parsed &&
          parsed.app === "impfbuch" &&
          parsed.includesSettings &&
          parsed.settings;
        const data = migrate(parsed);
        const incoming = data.profiles || [];
        if (!incoming.length) throw new Error("Keine Profile in der Datei.");
        // Importierte Personen hinzufügen bzw. bestehende (nach id) ersetzen —
        // so löscht ein Teil-Export beim Einspielen keine anderen Personen.
        incoming.forEach((ip) => {
          const idx = state.profiles.findIndex((p) => p.id === ip.id);
          if (idx >= 0) state.profiles[idx] = ip;
          else state.profiles.push(ip);
        });
        if (!state.profiles.find((p) => p.id === state.activeProfileId))
          state.activeProfileId = state.profiles[0].id;
        if (restoreSettings) {
          // Einstellungen aus dem Backup übernehmen (Theme, Premium,
          // Erinnerungen, Ersteinrichtung).
          state.settings = Object.assign({}, state.settings, parsed.settings);
          if (window.Edition)
            window.Edition.set(state.settings.premium ? "premium" : "free", true);
        }
        saveData();
        applyTheme();
        renderThemeButtons();
        render();
        if (restoreSettings && window.Ads) window.Ads.refresh();
        showMessage(
          "Import erfolgreich",
          `<p>${svgIcon("check", "ic-inline")} ${incoming.length} Person(en) wurden importiert${
            restoreSettings ? " — inklusive Einstellungen" : ""
          }.</p>`
        );
      } catch (err) {
        showMessage(
          "Import fehlgeschlagen",
          `<p>Die Datei konnte nicht gelesen werden.</p><p class="muted">${esc(
            err.message
          )}</p>`
        );
      }
    };
    reader.readAsText(file);
  }

  function resetAll() {
    showConfirm(
      "Alle Daten löschen",
      "<p>Sämtliche Daten <strong>aller Personen</strong> werden <strong>unwiderruflich</strong> gelöscht.</p><p>Tipp: Vorher per „Exportieren“ eine Sicherung anlegen.</p>",
      "Alles löschen",
      () => {
        state = defaultData();
        saveData();
        render();
      }
    );
  }

  /* ---------------------------------------------------- Benachrichtigungen */

  const global = self;

  async function persistDueToDB() {
    scheduleRemindersSoon(); // Planung an den aktuellen Impfstand anpassen
    if (!global.ReminderDB) return;
    try {
      await global.ReminderDB.set("due", {
        generatedAt: Date.now(),
        items: computeDueAcrossProfiles(),
      });
    } catch (e) {
      /* IndexedDB evtl. nicht verfügbar — nicht kritisch */
    }
  }

  // Neuplanung gebündelt: render() läuft oft, das Planen soll aber nur einmal
  // nach der letzten Änderung passieren.
  let reminderTimer = null;
  function scheduleRemindersSoon() {
    if (!state.settings || !state.settings.notifyEnabled) return;
    clearTimeout(reminderTimer);
    reminderTimer = setTimeout(async () => {
      const res = await syncReminders();
      renderNotifyStatus(res);
    }, 1500);
  }

  // App-gestylter Meldungs-Dialog (Ersatz für hässliche Browser-Alerts).
  function showMessage(title, html) {
    el("#msg-title").textContent = title;
    el("#msg-body").innerHTML = html;
    el("#msg-dialog").showModal();
  }

  // App-gestylter Bestätigungs-Dialog (Ersatz für Browser-Confirms).
  let confirmAction = null;
  function showConfirm(title, html, confirmLabel, onConfirm) {
    el("#confirm-title").textContent = title;
    el("#confirm-body").innerHTML = html;
    el("#confirm-go").textContent = confirmLabel;
    confirmAction = onConfirm;
    el("#confirm-dialog").showModal();
  }

  /* -------------------------------------------------------------- Premium */

  // Zeigt den Premium-Dialog. `reasonHtml` (optional) erklärt oben, warum der
  // Dialog gerade erscheint (z. B. Profil-Grenze erreicht).
  function showPremiumDialog(reasonHtml) {
    const active = isPremium();
    const native = !!(window.NativeBridge && window.NativeBridge.isNative());
    el("#premium-reason").innerHTML =
      !active && reasonHtml ? `<div class="premium-reason">${reasonHtml}</div>` : "";
    el("#premium-status").innerHTML = active
      ? `<div class="premium-active">${svgIcon(
          "check",
          "ic-inline"
        )} Premium ist aktiv — vielen Dank für deine Unterstützung!</div>`
      : "";
    // Preis anzeigen (echter Store-Preis oder Fallback).
    const priceEl = el("#premium-price");
    if (priceEl && window.Purchase) priceEl.textContent = window.Purchase.price();
    // Kauf-Button nur ohne Premium. „Premium deaktivieren" ist ein reiner
    // Entwickler-Schalter und im Release komplett ausgeblendet.
    const devUnlock = !!(window.MONETIZE && window.MONETIZE.DEV_UNLOCK);
    el("#premium-go").classList.toggle("hidden", active);
    el("#premium-off").classList.toggle("hidden", !active || !devUnlock);
    // „Käufe wiederherstellen" nur nativ und nur solange nicht Premium.
    el("#premium-restore").classList.toggle("hidden", active || !native);
    el("#premium-dialog").showModal();
  }

  // Reaktion auf einen Edition-Wechsel (Kauf, Test-Schalter, Wiederherstellen).
  // Persistiert den Premium-Status und aktualisiert UI + Werbung.
  function onEditionChanged(e) {
    state.settings.premium = !!(window.EDITION && window.EDITION.premium);
    saveData();
    render();
    renderPremiumCard();
    if (window.Ads) window.Ads.refresh();
    if (el("#premium-dialog").open) el("#premium-dialog").close();
    if (e && e.detail && e.detail.flavor === "premium") {
      showMessage(
        "Premium aktiv",
        `<p>${svgIcon(
          "check",
          "ic-inline"
        )} Alle Premium-Funktionen sind freigeschaltet — und die Werbung ist deaktiviert.</p>`
      );
    }
  }

  // Aktualisiert die Premium-Schaltfläche unter „Profil".
  function renderPremiumCard() {
    const btn = el("#btn-premium");
    if (!btn) return;
    const active = isPremium();
    btn.classList.toggle("is-premium", active);
    btn.innerHTML = active
      ? `${svgIcon("gem")}<span>Premium aktiv</span>`
      : `${svgIcon("gem")}<span>Premium freischalten</span>`;
    const hint = el("#premium-hint");
    if (hint)
      hint.textContent = active
        ? "Beliebig viele Profile und länderspezifische Reiseempfehlungen sind freigeschaltet."
        : "Beliebig viele Profile und länderspezifische Reiseempfehlungen freischalten.";
  }

  // Schritt 1: schöner Erklär-Dialog, erst danach die Systemabfrage.
  function askNotifications() {
    el("#notify-dialog").showModal();
  }

  async function enableNotifications() {
    const perm = await window.Notify.requestPermission();
    if (perm === "unsupported") {
      showMessage(
        "Nicht unterstützt",
        "<p>Dieses Gerät unterstützt leider keine Benachrichtigungen.</p>"
      );
      return;
    }
    if (perm !== "granted") {
      showMessage(
        "Benachrichtigungen nicht erlaubt",
        "<p>Kein Problem — so schaltest du sie frei:</p>" +
          "<ol>" +
          "<li>App-Icon <strong>lange drücken</strong> → <strong>ⓘ App-Info</strong> → <strong>Benachrichtigungen</strong> → <strong>zulassen</strong></li>" +
          "<li>Danach hier erneut auf „Benachrichtigungen aktivieren“ tippen</li>" +
          "</ol>"
      );
      return;
    }
    state.settings.notifyEnabled = true;
    saveData();
    await persistDueToDB();
    const res = await syncReminders();
    renderNotifyStatus(res);
    showMessage(
      "Erinnerungen aktiv",
      `<p>${svgIcon("check", "ic-inline")} Alles eingerichtet!</p>` +
        (res && res.scheduled
          ? `<p>Es sind <strong>${res.scheduled} Erinnerung(en)</strong> eingeplant — sie kommen automatisch am Fälligkeitstag, auch wenn die App geschlossen ist.</p>`
          : "<p>Sobald eine Impfung fällig wird, meldet sich die App.</p>")
    );
  }

  /*
   * Plant die Erinnerungen neu. Wird beim Start und nach jeder Datenänderung
   * aufgerufen, damit die geplanten Termine immer zum aktuellen Impfstand
   * passen (z. B. nach dem Eintragen einer Impfung).
   */
  async function syncReminders() {
    try {
      if (!state.settings.notifyEnabled) return null;
      if (!(await window.Notify.hasPermission())) return null;
      return await window.Notify.schedule(upcomingForReminders());
    } catch (e) {
      console.warn("Erinnerungen konnten nicht geplant werden:", e);
      return null;
    }
  }

  // Alle künftig fälligen Impfungen aller Personen (inkl. überfälliger).
  function upcomingForReminders() {
    const out = [];
    for (const p of state.profiles) {
      for (const item of computeDueItems(p)) {
        if (displayStateFor(item.vaccine, p) !== "shown") continue;
        if (!item.next || !item.next.dueDate) continue;
        if (!["overdue", "soon", "future"].includes(item.status)) continue;
        out.push({
          profile: p.name,
          vaccine: item.vaccine.name,
          dueDate: item.next.dueDate.toISOString().slice(0, 10),
          status: item.status,
        });
      }
    }
    return out;
  }

  function renderNotifyStatus(res) {
    const e = el("#notify-status");
    if (!e) return;
    if (!state.settings.notifyEnabled) {
      e.textContent =
        "Erinnert an fällige Impfungen aller Personen — automatisch am Fälligkeitstag.";
      return;
    }
    if (res && res.scheduled)
      e.textContent = `Aktiviert — ${res.scheduled} Erinnerung(en) eingeplant.`;
    else if (res && res.mode === "beim Öffnen")
      e.textContent =
        "Aktiviert — Hinweis beim Öffnen der App (dieser Browser kann nicht im Hintergrund erinnern).";
    else e.textContent = "Aktiviert — es steht derzeit keine Impfung an.";
  }

  // Beim App-Start: überfällige Impfungen sofort melden (nur einmal täglich).
  /*
   * Hinweis beim Öffnen der App — NUR im Web. In der nativen App wäre er
   * doppelt und lästig: dort sind echte Erinnerungen auf die Fälligkeits-
   * termine eingeplant, und wer die App gerade offen hat, sieht den
   * „Fällig"-Tab ohnehin. Höchstens einmal pro Tag.
   */
  async function checkAndNotify(force) {
    try {
      if (window.NativeBridge && window.NativeBridge.isNative()) return;
      if (!state.settings.notifyEnabled && !force) return;
      if (!(await window.Notify.hasPermission())) return;
      const due = computeDueAcrossProfiles();
      if (!due.length) return;
      const today = new Date().toISOString().slice(0, 10);
      if (state.settings.lastNotified === today) return;
      const names = due
        .map((d) => `${d.vaccine} (${d.profile})`)
        .slice(0, 3)
        .join(", ");
      const ok = await window.Notify.showNow(
        "Impfbuch — fällige Impfungen",
        `${due.length} Impfung(en) anstehend: ${names}${
          due.length > 3 ? " …" : ""
        }`
      );
      if (ok) {
        state.settings.lastNotified = today;
        saveData();
      }
    } catch (e) {
      console.warn("Benachrichtigung fehlgeschlagen:", e);
    }
  }

  /* --------------------------------------------------------- Ersteinrichtung */

  let setupStep = 1;

  // Beim allerersten Start: zum Profil-Tab leiten und den Assistenten öffnen.
  function maybeStartSetup() {
    if (state.settings.setupDone) return;
    activateTab("settings");
    openSetup();
  }

  function openSetup() {
    setupStep = 1;
    const p = activeProfile();
    el("#setup-name").value = p.name === "Ich" ? "" : p.name;
    // Vorgabe 18 Jahre zurück, wenn noch kein Geburtsdatum gesetzt ist
    el("#setup-birthdate").value = p.birthdate || dateYearsAgoISO(18);
    showSetupStep();
    el("#setup-dialog").showModal();
  }

  function showSetupStep() {
    [1, 2, 3].forEach((n) =>
      el("#setup-step" + n).classList.toggle("hidden", n !== setupStep)
    );
    el("#setup-dots").textContent =
      ["● ○ ○", "○ ● ○", "○ ○ ●"][setupStep - 1];
  }

  // Schritt 2 → Profil übernehmen, weiter zu Schritt 3.
  function setupSaveProfile() {
    const p = activeProfile();
    const name = el("#setup-name").value.trim();
    if (name) p.name = name;
    p.birthdate = el("#setup-birthdate").value;
    saveData();
    render();
    setupStep = 3;
    showSetupStep();
  }

  // Abschluss: Flag setzen; optional direkt den Schnelleintrag öffnen.
  function finishSetup(openQuick) {
    state.settings.setupDone = true;
    saveData();
    el("#setup-dialog").close();
    render();
    if (openQuick) {
      activateTab("pass");
      openQuickDialog();
    } else if (activeProfile().birthdate) {
      activateTab("pass");
    }
  }

  // Überspringen: Flag setzen, im Profil-Tab bleiben (manuelle Einrichtung).
  function skipSetup() {
    state.settings.setupDone = true;
    saveData();
    el("#setup-dialog").close();
    // Auch beim Überspringen soll die Starthilfe erscheinen.
    renderCoach();
  }

  /* ----------------------------------------------------------- Darstellung */

  function resolvedTheme() {
    const choice = (state.settings && state.settings.theme) || "auto";
    if (choice !== "auto") return choice;
    return window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function applyTheme() {
    const resolved = resolvedTheme();
    document.documentElement.setAttribute("data-theme", resolved);
    const tc = document.querySelector('meta[name="theme-color"]');
    const bar =
      resolved === "dark"
        ? "#1c1913"
        : resolved === "neutral"
        ? "#f0a712"
        : "#e9c94a";
    if (tc) tc.setAttribute("content", bar);
  }

  function setTheme(choice) {
    state.settings.theme = choice;
    saveData();
    applyTheme();
    renderThemeButtons();
  }

  function renderThemeButtons() {
    const choice = (state.settings && state.settings.theme) || "auto";
    document.querySelectorAll(".theme-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.themeChoice === choice)
    );
  }

  /* ----------------------------------------------------------------- Tabs */

  function activateTab(name) {
    document
      .querySelectorAll(".tab")
      .forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    document
      .querySelectorAll(".tab-panel")
      .forEach((p) => p.classList.toggle("active", p.id === "panel-" + name));
    /* Der Einstellungsbereich hängt am Zahnrad, nicht an einem Tab — das
       Zahnrad übernimmt deshalb die Rolle der aktiven Schaltfläche. */
    const zahn = el("#btn-config");
    if (zahn) zahn.classList.toggle("active", name === "config");
    window.scrollTo({ top: 0 });
  }

  function setupTabs() {
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => activateTab(tab.dataset.tab));
    });
    const zahn = el("#btn-config");
    if (zahn)
      zahn.addEventListener("click", () =>
        activateTab(
          el("#panel-config").classList.contains("active") ? "pass" : "config"
        )
      );
  }

  /* ------------------------------------------------- Android-Zurück-Taste */

  // Kleine Einblendung am unteren Rand (z. B. „Erneut drücken zum Beenden").
  let toastTimer = null;
  function showToast(text) {
    const t = el("#toast");
    if (!t) return;
    t.textContent = text;
    t.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), 1800);
  }

  /*
   * Zurück-Taste: erst offene Dialoge schließen (über deren Abbrechen-Knopf,
   * damit Aufräum-Logik wie pendingDelete/confirmAction mitläuft), dann zum
   * Impfpass-Tab zurück, und erst zweimaliges Drücken kurz hintereinander
   * beendet die App.
   */
  const BACK_CANCEL = {
    "record-dialog": "#dlg-cancel",
    "quick-dialog": "#q-cancel",
    "edit-dialog": "#edit-cancel",
    "delete-dialog": "#del-cancel",
    "export-dialog": "#export-cancel",
    "backup-dialog": "#backup-cancel",
    "person-dialog": "#person-cancel",
    "premium-dialog": "#premium-close",
    "info-dialog": "#info-close",
    "msg-dialog": "#msg-ok",
    "confirm-dialog": "#confirm-cancel",
    "notify-dialog": "#notify-cancel",
    "book-dialog": "#book-cancel",
  };
  let lastBackPress = 0;

  function handleBack() {
    // 1) Offener Dialog? → schließen (wie Abbrechen)
    const dlg = document.querySelector("dialog[open]");
    if (dlg) {
      if (dlg.id === "setup-dialog") {
        // wie ESC: Überspringen zählt als erledigt (kein Nerv-Loop)
        state.settings.setupDone = true;
        saveData();
        dlg.close();
        renderCoach();
      } else {
        const btn = BACK_CANCEL[dlg.id] && el(BACK_CANCEL[dlg.id]);
        if (btn) btn.click();
        else dlg.close();
      }
      return "dialog";
    }
    /* 2) Einstellungsbereich offen? → zurück in den Impfpass. Er hängt an
       keinem Tab, also findet ihn die Prüfung darunter nicht. */
    const konfig = el("#panel-config");
    if (konfig && konfig.classList.contains("active")) {
      activateTab("pass");
      return "tab";
    }
    // 3) Nicht auf dem Impfpass-Tab? → dorthin zurück
    const active = document.querySelector(".tab.active");
    if (active && active.dataset.tab !== "pass") {
      activateTab("pass");
      return "tab";
    }
    // 3) Impfpass-Tab: doppelt drücken beendet die App
    const now = Date.now();
    if (now - lastBackPress < 2000) {
      const AppPlugin =
        window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      if (AppPlugin && AppPlugin.exitApp) AppPlugin.exitApp();
      return "exit";
    }
    lastBackPress = now;
    showToast("Erneut drücken zum Beenden");
    return "hint";
  }
  // Für die native Registrierung und zum Testen erreichbar machen.
  window.handleAndroidBack = handleBack;

  /* ------------------------------------------------------------------ Init */

  function init() {
    // Statische Emoji-Platzhalter durch moderne SVG-Icons ersetzen.
    if (window.hydrateIcons) window.hydrateIcons(document);

    setupTabs();

    applyTheme();
    document.querySelectorAll(".theme-btn").forEach((b) =>
      b.addEventListener("click", () => setTheme(b.dataset.themeChoice))
    );
    renderThemeButtons();
    if (window.matchMedia) {
      window
        .matchMedia("(prefers-color-scheme: dark)")
        .addEventListener("change", () => {
          if (((state.settings && state.settings.theme) || "auto") === "auto")
            applyTheme();
        });
    }

    el("#profile-switch").addEventListener("change", (e) =>
      switchProfile(e.target.value)
    );
    el("#profile-name").addEventListener("change", saveProfile);
    el("#profile-birthdate").addEventListener("change", saveProfile);
    el("#btn-add-profile").addEventListener("click", addProfile);
    el("#btn-delete-profile").addEventListener("click", deleteProfile);
    el("#person-form").addEventListener("submit", submitPerson);
    el("#person-cancel").addEventListener("click", cancelPersonDialog);
    el("#person-dialog").addEventListener("cancel", () => renderProfiles());

    populateTravelSelect();
    el("#travel-search").addEventListener("input", (e) => {
      const c = findCountryByName(e.target.value);
      if (c) {
        selectedTravelCode = c.code;
        el("#travel-country").value = c.code;
        renderTravelResult(c.code);
      }
    });
    el("#travel-country").addEventListener("change", (e) => {
      if (!e.target.value) return;
      selectedTravelCode = e.target.value;
      el("#travel-search").value = "";
      renderTravelResult(e.target.value);
    });
    el("#travel-world").addEventListener("click", () => {
      selectedTravelCode = "world";
      el("#travel-search").value = "";
      el("#travel-country").value = "";
      renderTravelResult("world");
    });

    el("#record-form").addEventListener("submit", submitRecord);
    el("#dlg-cancel").addEventListener("click", () => el("#record-dialog").close());
    el("#dlg-add-date").addEventListener("click", addRecordDate);
    el("#btn-quick").addEventListener("click", openQuickDialog);
    el("#quick-form").addEventListener("submit", submitQuick);
    el("#q-cancel").addEventListener("click", () => el("#quick-dialog").close());
    el("#q-add-date").addEventListener("click", addQuickDate);
    el("#q-date").addEventListener("change", updateQuickCount);
    el("#info-close").addEventListener("click", () => el("#info-dialog").close());
    el("#edit-form").addEventListener("submit", submitEditRecord);
    el("#edit-cancel").addEventListener("click", () => el("#edit-dialog").close());
    el("#del-cancel").addEventListener("click", () => {
      pendingDelete = null;
      el("#delete-dialog").close();
    });
    el("#del-one").addEventListener("click", () => performDelete("one"));
    el("#del-all").addEventListener("click", () => performDelete("all"));
    /* Export, Import und Backup stehen zweimal in der App — unter „Profil"
       und unter „Einstellungen". Deshalb über Klassen gebunden, nicht über
       IDs; die dürfen nur einmal vorkommen. */
    const alle = (sel, ereignis, fn) =>
      document.querySelectorAll(sel).forEach((b) => b.addEventListener(ereignis, fn));
    alle(".btn-export", "click", exportData);
    el("#export-go").addEventListener("click", doExport);
    el("#export-cancel").addEventListener("click", () =>
      el("#export-dialog").close()
    );
    alle(".btn-import", "click", () => el("#import-file").click());
    el("#import-file").addEventListener("change", (e) => {
      if (e.target.files[0]) importData(e.target.files[0]);
      e.target.value = "";
    });
    alle(".btn-backup", "click", openBackup);
    setupVaccineSearch();
    el("#book-save").addEventListener("click", saveBookDialog);
    el("#book-cancel").addEventListener("click", () => el("#book-dialog").close());
    el("#backup-go").addEventListener("click", doBackup);
    el("#backup-cancel").addEventListener("click", () =>
      el("#backup-dialog").close()
    );
    el("#backup-dialog")
      .querySelectorAll('input[name="backup-scope"]')
      .forEach((r) => r.addEventListener("change", updateBackupScopeUI));
    el("#btn-reset").addEventListener("click", resetAll);
    el("#btn-notify").addEventListener("click", askNotifications);
    el("#notify-cancel").addEventListener("click", () =>
      el("#notify-dialog").close()
    );
    el("#notify-go").addEventListener("click", () => {
      el("#notify-dialog").close();
      enableNotifications();
    });
    el("#msg-ok").addEventListener("click", () => el("#msg-dialog").close());
    el("#confirm-cancel").addEventListener("click", () => {
      confirmAction = null;
      el("#confirm-dialog").close();
    });
    el("#confirm-go").addEventListener("click", () => {
      const fn = confirmAction;
      confirmAction = null;
      el("#confirm-dialog").close();
      if (fn) fn();
    });

    // Ersteinrichtung
    el("#setup-start").addEventListener("click", () => {
      setupStep = 2;
      showSetupStep();
    });
    el("#setup-skip1").addEventListener("click", skipSetup);
    el("#setup-skip2").addEventListener("click", skipSetup);
    el("#setup-next").addEventListener("click", setupSaveProfile);
    el("#setup-quick").addEventListener("click", () => finishSetup(true));
    el("#setup-done").addEventListener("click", () => finishSetup(false));
    // ESC/Schließen ohne Abschluss zählt als Überspringen (kein Nerv-Loop)
    el("#setup-dialog").addEventListener("cancel", () => {
      state.settings.setupDone = true;
      saveData();
      renderCoach();
    });
    el("#coach-ok").addEventListener("click", dismissCoach);
    el("#btn-rerun-setup").addEventListener("click", openSetup);

    // Premium & Werbung
    el("#btn-premium").addEventListener("click", () => showPremiumDialog());
    el("#premium-close").addEventListener("click", () =>
      el("#premium-dialog").close()
    );
    // Kauf — läuft über Purchase (nativ: Google Play).
    el("#premium-go").addEventListener("click", async () => {
      if (!window.Purchase) return;
      const r = await window.Purchase.buy();
      if (r && r.unavailable) {
        el("#premium-dialog").close();
        showMessage(
          "Nur in der App erhältlich",
          "<p>Premium kann nur in der Android-App aus dem Google Play Store gekauft werden.</p>"
        );
      }
    });
    // Test-Schalter zum Deaktivieren (nur solange kein echter Kauf aktiv ist).
    el("#premium-off").addEventListener("click", () => {
      if (window.Edition) window.Edition.set("free");
    });
    el("#premium-restore").addEventListener("click", async () => {
      if (!window.Purchase) return;
      const r = await window.Purchase.restore();
      if (r && r.unavailable)
        showMessage(
          "Nur in der App",
          "<p>Käufe können nur in der über Google Play installierten App wiederhergestellt werden.</p>"
        );
    });
    el("#ad-bar-cta").addEventListener("click", () => showPremiumDialog());
    el("#btn-ad-privacy").addEventListener("click", () => {
      if (window.Ads) window.Ads.showPrivacyOptions();
    });
    document.addEventListener("edition:changed", onEditionChanged);

    renderNotifyStatus(null);

    render();
    maybeStartSetup();
    setTimeout(() => checkAndNotify(false), 800);

    // Erinnerungen: Android-Kanal anlegen und Planung auffrischen (Termine
    // können sich seit dem letzten Start verschoben haben).
    if (window.Notify) {
      window.Notify.init().then(async () => {
        const res = await syncReminders();
        renderNotifyStatus(res);
      });
    }

    // Android-Zurück-Taste übernehmen (sobald ein Listener registriert ist,
    // beendet Capacitor die App nicht mehr von selbst).
    if (window.NativeBridge && window.NativeBridge.isNative()) {
      const AppPlugin =
        window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      if (AppPlugin && AppPlugin.addListener) {
        AppPlugin.addListener("backButton", () => handleBack());
      }
    }

    // Monetarisierung starten: Edition aus gespeichertem Zustand übernehmen
    // (silent = ohne Event-Schleife), dann Kauf- und Werbe-Module initialisieren.
    if (window.Edition)
      window.Edition.set(state.settings.premium ? "premium" : "free", true);
    if (window.Purchase) window.Purchase.init();
    if (window.Ads) window.Ads.init();
    if (window.Diag) window.Diag.render();

    // Service Worker NUR im Web (github.io) registrieren — in der nativen
    // Capacitor-App sind die Dateien lokal, ein SW wäre dort nur Fehlerquelle.
    if (
      "serviceWorker" in navigator &&
      location.hostname.endsWith("github.io")
    ) {
      navigator.serviceWorker
        .register("sw.js")
        .catch((e) => console.warn("SW-Registrierung fehlgeschlagen:", e));
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
