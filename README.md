# MERC App – Website

Statische Firmen-/Entwickler-Website für **MERC App** (Marc Ewers).
Dient als offizielle Entwickler-Präsenz, u. a. als Voraussetzung für ein
Google-Play-Console-Organisationskonto.

- Reines HTML/CSS/JS, **kein Build-Schritt**, **keine externen Abhängigkeiten**
  (kein CDN, keine Fonts von Dritten, kein Tracking, keine Cookies).
- Responsiv, mit automatischem Dark-Mode und manuellem Umschalter.

## Aufbau

| Datei | Inhalt |
|-------|--------|
| `index.html` | Startseite (Studio-Vorstellung + App-Übersicht) |
| `apps.html` | Apps/Portfolio (Sportabzeichen-Rechner, Impfbuch-App) |
| `impressum.html` | Impressum nach § 5 DDG |
| `datenschutz.html` | Datenschutzerklärung der Website (DSGVO) |
| `kontakt.html` | Kontakt (E-Mail-Verweis, kein Formular) |
| `assets/` | `style.css`, `theme.js`, `logo.svg` |
| `.nojekyll` | verhindert Jekyll-Verarbeitung auf GitHub Pages |

## Lokal testen

```bash
python3 -m http.server 8000
# -> http://localhost:8000
```

## Veröffentlichen über GitHub Pages

1. Neues **öffentliches** Repo `merc-studios` unter dem GitHub-Account `MarqEwi` anlegen.
2. Den Inhalt dieses Ordners in das Repo-Root legen und pushen (`main`-Branch).
3. Im Repo: **Settings → Pages → Build and deployment**
   - Source: *Deploy from a branch*
   - Branch: `main` / `/ (root)` → **Save**
4. Nach ein bis zwei Minuten ist die Seite erreichbar unter:
   **https://marqewi.github.io/merc-studios/**

Das bestehende Root-Repo `MarqEwi.github.io` (inkl. `/.well-known/assetlinks.json`)
bleibt davon vollständig unberührt.

## Optional: eigene Domain (z. B. merc-studios.de)

1. Domain bei einem Registrar registrieren.
2. Beim DNS-Anbieter setzen:
   - `A`-Records der Apex-Domain auf die vier GitHub-Pages-IPs
     (`185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`)
   - `CNAME` für `www` auf `marqewi.github.io`
3. Im Repo **Settings → Pages → Custom domain** die Domain eintragen und
   **Enforce HTTPS** aktivieren. GitHub legt dabei eine `CNAME`-Datei im Repo an.

Eine zur Website passende E-Mail-Domain (z. B. `kontakt@merc-studios.de`) hilft
zusätzlich bei der Verifizierung des Google-Play-Organisationskontos.

---

> Die enthaltenen Rechtstexte (Impressum, Datenschutz) sind sorgfältig erstellt,
> stellen jedoch **keine Rechtsberatung** dar.
