# KI-Video-Studio

Eine Webseite, auf der Besucher per Text-Prompt ein KI-Video (Google Veo 3.1
Fast) erstellen lassen können. Bezahlung per Stripe, einmalig pro Video.

## Wie die Seite funktioniert

1. Besucher schreibt einen Prompt und klickt "Video erstellen"
2. Stripe-Checkout öffnet sich (im Testmodus: keine echte Zahlung)
3. Nach erfolgreicher "Zahlung" ruft Stripe unseren Webhook auf
4. Der Webhook startet die Videoerstellung bei Google Veo
5. Die Erfolgsseite fragt alle paar Sekunden nach, ob das Video fertig ist,
   und zeigt es dann an

## Testen ohne eigene Programmierumgebung

Du brauchst dafür kein Node.js, kein Terminal und kein Abo. Wir nutzen
kostenlose Web-Oberflächen:

### Schritt 1: Code zu GitHub hochladen
1. Gehe auf github.com und logg dich ein (Konto ggf. vorher kostenlos anlegen)
2. Klicke oben rechts auf "+" → "New repository"
3. Name z.B. "ki-video-studio", auf "Create repository" klicken
4. Auf der nächsten Seite: "uploading an existing file" anklicken
5. Alle Dateien/Ordner aus diesem Projekt per Drag & Drop hochladen
   (WICHTIG: die Datei `.env.local` gibt es noch nicht, die brauchst du
   auch nicht hochzuladen — Schlüssel kommen gleich direkt in Vercel)
6. Unten auf "Commit changes" klicken

### Schritt 2: Bei Vercel importieren
1. Gehe auf vercel.com → "Sign up" → mit GitHub anmelden (kostenlos)
2. "Add New" → "Project" → dein gerade erstelltes Repository auswählen
3. Bei "Environment Variables" folgende Werte eintragen (siehe `.env.example`):
   - `GEMINI_API_KEY` – dein Google-Schlüssel
   - `STRIPE_SECRET_KEY` – dein Stripe Test-Secret-Key (`sk_test_...`)
   - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` – dein Stripe Test-Publishable-Key (`pk_test_...`)
   - `APP_URL` – trägst du erst nach dem ersten Deploy ein (siehe Schritt 3)
   - `STRIPE_WEBHOOK_SECRET` – trägst du in Schritt 4 ein
4. Auf "Deploy" klicken. Nach 1-2 Minuten bekommst du eine Live-URL wie
   `https://ki-video-studio-deinname.vercel.app`

### Schritt 3: APP_URL nachtragen
1. Gehe in Vercel zu deinem Projekt → "Settings" → "Environment Variables"
2. Trage bei `APP_URL` genau deine Vercel-URL ein (mit https://, ohne
   Schrägstrich am Ende)
3. Oben rechts "Redeploy" klicken, damit die Änderung übernommen wird

### Schritt 4: Stripe-Webhook einrichten
1. Gehe im Stripe-Dashboard (Testmodus!) zu "Entwickler" → "Webhooks"
2. "Endpoint hinzufügen" klicken
3. Als URL eintragen: `https://deine-vercel-url.vercel.app/api/webhook`
4. Als Ereignis auswählen: `checkout.session.completed`
5. Nach dem Speichern zeigt Stripe dir ein "Signing secret" (`whsec_...`)
   — das trägst du in Vercel als `STRIPE_WEBHOOK_SECRET` ein
6. Nochmal "Redeploy" in Vercel klicken

### Schritt 5: Testen
1. Öffne deine Vercel-URL im Browser
2. Gib einen Prompt ein, klicke "Video erstellen"
3. Bei der Stripe-Testkarte eingeben: Kartennummer `4242 4242 4242 4242`,
   beliebiges zukünftiges Datum, beliebige 3 Ziffern als CVC
4. Nach der "Zahlung" landest du auf der Erfolgsseite, die auf das Video wartet

## Bekannte Einschränkungen (okay für den Test, wichtig vor Live-Betrieb)

- Der Job-Speicher (`lib/store.ts`) ist ein einfacher Arbeitsspeicher-Store,
  keine echte Datenbank. Für den echten Betrieb später durch z.B. Vercel KV
  oder eine Postgres-Datenbank ersetzen.
- Die Video-Generierung läuft im Hintergrund nach der Webhook-Antwort weiter
  — auf Vercel kann das je nach Plan/Timeout-Limits abgeschnitten werden,
  wenn Veo länger als erwartet braucht. Für den Test reicht es meist.
- Modellname/Endpunkt für Veo (`lib/veo.ts`) basiert auf der aktuellen
  Preview-Doku von Google — vor dem Live-Gang bitte gegen
  https://ai.google.dev/gemini-api/docs/video prüfen, falls sich der
  Modellname geändert hat.
