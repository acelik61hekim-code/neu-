# KI-Video-Studio

Eine Webseite, auf der Besucher per Text-Prompt ein KI-Video (Google Veo 3.1
Fast) erstellen lassen können. Bezahlung per Stripe, einmalig pro Video.

## Wie die Seite funktioniert

1. Besucher schreibt einen Prompt und klickt "Video erstellen"
2. Stripe-Checkout öffnet sich (im Testmodus: keine echte Zahlung). Stripe zeigt
   automatisch die für den Kunden verfügbaren Methoden wie Karte, PayPal,
   Klarna, Apple Pay oder Link.
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
   - `OPENAI_API_KEY` – OpenAI-Schlüssel für den zentralen GPT-5.6-Terra-Dialogautor
   - `STRIPE_SECRET_KEY` – dein Stripe Test-Secret-Key (`sk_test_...`)
   - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` – dein Stripe Test-Publishable-Key (`pk_test_...`)
   - `APP_URL` – trägst du erst nach dem ersten Deploy ein (siehe Schritt 3)
   - `STRIPE_WEBHOOK_SECRET` – trägst du in Schritt 4 ein
   - `UPSTASH_REDIS_REST_URL` und `UPSTASH_REDIS_REST_TOKEN` – dauerhafter Job-Speicher
   - `BLOB_READ_WRITE_TOKEN` oder Vercel-Blob-Verknüpfung – private fertige Videos
   - `VEO_WORKFLOW_RENDER_ENABLED=true` – erst nach erfolgreichem Sicherheitstest
   - `VEO_WORKFLOW_MAX_DURATION_SECONDS` – zunächst höchstens `8`, später kontrolliert erhöhen
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

### Zahlungsmethoden aktivieren

Die Checkout-Sitzung verwendet dynamische Stripe-Zahlungsmethoden. Dadurch
entscheidet Stripe anhand von Land, Währung, Gerät und Kontofreigabe, welche
Methoden tatsächlich angezeigt werden.

1. Im Stripe-Dashboard unter "Einstellungen" → "Zahlungsmethoden" Klarna
   aktivieren.
2. Dort auch PayPal aktivieren und das Stripe-Konto einmal mit PayPal verbinden.
3. Karte aktiviert lassen; Apple Pay und Link werden auf unterstützten Geräten
   automatisch angeboten.
4. Die Aktivierung jeweils getrennt im Test- und später im Live-Modus prüfen.

Falls Stripe eine Methode nicht anzeigt, obwohl sie aktiviert ist, erfüllt die
konkrete Zahlung möglicherweise nicht deren Länder-, Währungs-, Betrags- oder
Kontovoraussetzungen.

### Schritt 5: Testen
1. Öffne deine Vercel-URL im Browser
2. Gib einen Prompt ein, klicke "Video erstellen"
3. Bei der Stripe-Testkarte eingeben: Kartennummer `4242 4242 4242 4242`,
   beliebiges zukünftiges Datum, beliebige 3 Ziffern als CVC
4. Nach der "Zahlung" landest du auf der Erfolgsseite, die auf das Video wartet

## Lokaler Test und Live-Betrieb

- Lokal werden Jobs zusätzlich unter `.video-backend-backups` gesichert. Fehlen
  Vercel-Blob-Zugangsdaten, werden fertige Videos dort privat gespeichert und
  weiterhin über die geschützte Download-Route ausgeliefert.
- In Produktion ist dieser Dateisystem-Fallback absichtlich deaktiviert. Dort
  müssen Upstash Redis und ein privater Vercel-Blob-Speicher verbunden sein.
- Der Stripe-Webhook bleibt der primäre Zahlungsweg. Die Erfolgsseite prüft eine
  zurückkehrende Checkout-Session zusätzlich direkt bei Stripe und kann den
  idempotenten Renderstart sicher nachholen.
- `VEO_WORKFLOW_MAX_DURATION_SECONDS` ist die Kosten-Sicherheitsgrenze. Sie darf
  erst nach einem erfolgreichen Test der jeweiligen Laufzeit erhöht werden.
- Vor dem Live-Gang Stripe vom Test- in den Live-Modus umstellen, einen separaten
  Live-Webhook anlegen und Checkout-Branding, Preise, Datenschutz, Impressum,
  Rückerstattung und Supportprozess kontrollieren.
- Modellname und Veo-Endpunkt vor dem Live-Gang gegen die aktuelle Google-Doku
  prüfen, da es sich weiterhin um Preview-Schnittstellen handeln kann.

## Abnahmekriterien vor dem Live-Gang

1. Produktions-Build läuft ohne Typ- oder Kompilierungsfehler.
2. Stripe-Testzahlung startet genau einen Renderauftrag.
3. Fortschrittsseite übersteht Aktualisieren und erneutes Öffnen.
4. Fertiges Video lässt sich abspielen und herunterladen.
5. Fehlender Blob-/Redis-Speicher wird vor einem Kundenauftrag erkannt.
6. Ein kompletter Test je freigeschalteter Laufzeit und je Bildformat ist dokumentiert.
