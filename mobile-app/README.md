# KI Video Studio App

Native Android- und iPhone-App für [kivideostudio.de](https://kivideostudio.de).
Die App verbindet die vorhandenen Kundenkonten, Abos und KI-Studios mit einer
nativen mobilen Navigation.

## Enthalten

- Native Bereiche für Video, Songs, Bilder, Studio und Konto
- Persistente Anmeldung und sichere WebView-Navigation
- Offline- und Fehleranzeige
- Android-Zurück-Taste, Teilen und haptisches Feedback
- Kamera-, Mikrofon- und Dateiauswahl für eigene Medien
- Eigene Store-Symbole und Startbildschirm

## Prüfung

```bash
npm ci
npm run typecheck
npm run lint
npm run export:android
```

Bei Änderungen unter `mobile-app/` erstellt GitHub automatisch eine
installierbare Android-Test-App. Produktions-Builds für Google Play und Apple
werden über die Profile in `eas.json` erstellt, sobald die Store-Konten
verbunden sind.
