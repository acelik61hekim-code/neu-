import StudioHome from "@/components/StudioHome";
import SeoContent, { type SeoFaq } from "@/components/SeoContent";
import { VIDEO_PRICE_CENTS } from "@/lib/pricing";
import { productJsonLd, productMetadata } from "@/lib/seo";
import { STUDIO_PATHS } from "@/lib/site";

const title =
  "KI-Video erstellen aus Text – online mit KI";

const description =
  "Erstelle dein individuelles KI-Video aus einer Textidee oder lade deinen fertigen Song für ein passendes Musikvideo mit vollständiger Originaltonspur hoch.";

const faqs: SeoFaq[] = [
  {
    question:
      "Welche Videolängen kann ich erstellen?",

    answer:
      "Normale KI-Videos kannst du mit 15 Sekunden, 30 Sekunden, einer Minute oder zwei Minuten erstellen. Für Musikvideos übernimmt die Seite einen hochgeladenen Song vollständig und unterstützt dadurch eine exakte Songlänge von bis zu fünf Minuten.",
  },
  {
    question:
      "Welche Videoformate werden unterstützt?",

    answer:
      "Für Reels, TikTok und Shorts steht das vertikale Format 9:16 bereit. Für YouTube, Webseiten und filmische Projekte kannst du 16:9 verwenden.",
  },
  {
    question:
      "Kann ich das Ergebnis vor der Bezahlung prüfen?",

    answer:
      "Der KI-Regisseur entwickelt zunächst Story und Szenenplan. Zusätzlich kannst du eine visuelle Vorschau erzeugen, bevor du das vollständige Video bestellst.",
  },
  {
    question:
      "Kann ich meinen eigenen Song für ein Musikvideo hochladen?",

    answer:
      "Ja. Lade deinen fertigen Song hoch und beschreibe deine Bildidee. Tempo, Stimmung und Energieverlauf werden für die Szenenplanung analysiert; der vollständige Originalsong bleibt anschließend die einzige finale Tonspur des Musikvideos.",
  },
];

export const metadata =
  productMetadata({
    title,
    description,

    path:
      STUDIO_PATHS.video,

    keywords: [
      "KI Video erstellen",
      "Text zu Video KI",
      "KI Videogenerator",
      "KI Reel erstellen",
      "AI Video erstellen",
    ],
  });

const jsonLd =
  productJsonLd({
    name:
      "KI-Videogenerator",

    description,

    path:
      STUDIO_PATHS.video,

    category:
      "MultimediaApplication",

    /*
     * Neue kleinste kaufbare Länge:
     * 15 Sekunden = 6,99 €.
     */
    lowPrice:
      String(
        VIDEO_PRICE_CENTS[
          15
        ] /
          100,
      ),

    highPrice:
      String(
        VIDEO_PRICE_CENTS[
          300
        ] /
          100,
      ),

    offerCount:
      7,

    features: [
      "Text zu Video",
      "Story- und Szenenplanung",
      "Formate 9:16 und 16:9",
      "Eigene Songs vollständig übernehmen",
      "Musikvideos bis zu fünf Minuten",
    ],

    faqs,
  });

export default function VideoStudioPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html:
            JSON.stringify(
              jsonLd,
            ),
        }}
      />

      <StudioHome
        initialStudio="video"
      />

      <SeoContent
        active="video"
        eyebrow="KI-Video online erstellen"
        title="Aus deiner Beschreibung entsteht ein individuelles KI-Video"
        intro="Beschreibe Handlung, Stil und gewünschte Stimmung. Der KI-Regisseur strukturiert deine Idee, plant passende Szenen und bereitet daraus ein Video für Social Media, YouTube oder ein filmisches Projekt vor."
        benefits={[
          "Erstelle normale KI-Videos bis zwei Minuten oder Musikvideos mit deinem vollständigen Song bis fünf Minuten.",

          "Erstelle vertikale 9:16-Videos oder filmische 16:9-Aufnahmen.",

          "Lass Tempo, Stimmung und Songverlauf analysieren, damit Szenen und Schnitte zu deiner Musik passen.",
        ]}
        steps={[
          "Wähle den Musikvideo-Modus, lade deinen fertigen Song hoch und bestimme Format und Schnittstil.",

          "Beschreibe deine Bildidee und lass Story, Figuren und Szenen passend zu den Songabschnitten planen.",

          "Prüfe die Vorschau, bezahle sicher und lade das fertige Musikvideo mit vollständiger Originaltonspur herunter.",
        ]}
        faqs={
          faqs
        }
      />
    </>
  );
}
