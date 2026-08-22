import { StudioHome } from "@/app/page";
import SeoContent, { type SeoFaq } from "@/components/SeoContent";
import { VIDEO_PRICE_CENTS } from "@/lib/pricing";
import { productJsonLd, productMetadata } from "@/lib/seo";
import { STUDIO_PATHS } from "@/lib/site";

const title =
  "KI-Video erstellen aus Text – online mit KI";

const description =
  "Erstelle dein individuelles KI-Video aus einer Textidee: mit Vorschau, Musik oder Sprache, verschiedenen Formaten und bis zu zwei Minuten Länge.";

const faqs: SeoFaq[] = [
  {
    question:
      "Welche Videolängen kann ich erstellen?",

    answer:
      "Du kannst aktuell zwischen 15 Sekunden, 30 Sekunden, einer Minute und zwei Minuten wählen. Längere Formate werden erst nach abgeschlossenen Qualitätstests freigeschaltet.",
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
          120
        ] /
          100,
      ),

    offerCount:
      4,

    features: [
      "Text zu Video",
      "Story- und Szenenplanung",
      "Formate 9:16 und 16:9",
      "Videos bis zu zwei Minuten",
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
          "Wähle zwischen 15 Sekunden, 30 Sekunden, einer Minute und zwei Minuten.",

          "Erstelle vertikale 9:16-Videos oder filmische 16:9-Aufnahmen.",

          "Bestimme Musik, Sprache, Schnittstil und eigene Referenzbilder.",
        ]}
        steps={[
          "Wähle Videolänge, Format, Schnittstil, Musik und gewünschte Sprache.",

          "Beschreibe deine Idee und lass Story, Figuren und Szenen durch den KI-Regisseur planen.",

          "Prüfe die Vorschau, bezahle sicher und lade das fertige Video anschließend herunter.",
        ]}
        faqs={
          faqs
        }
      />
    </>
  );
}