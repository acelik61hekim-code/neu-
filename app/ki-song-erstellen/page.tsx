import StudioHome from "@/components/StudioHome";
import SeoContent, { type SeoFaq } from "@/components/SeoContent";
import { productJsonLd, productMetadata } from "@/lib/seo";
import { STUDIO_PATHS } from "@/lib/site";

const title = "KI-Song erstellen – mit eigenen Lyrics oder KI-Text";
const description =
  "Erstelle vollständige KI-Songs von 30 Sekunden bis vier Minuten – instrumental, mit eigenen Lyrics oder neu geschriebenem KI-Songtext auf Deutsch, Türkisch oder Englisch.";

const faqs: SeoFaq[] = [
  {
    question: "Wie lang kann ein KI-Song werden?",
    answer: "Zur Auswahl stehen ein 30-Sekunden-Clip sowie vollständige Songs mit zwei, drei oder vier Minuten Länge.",
  },
  {
    question: "Kann ich meine eigenen Lyrics verwenden?",
    answer: "Ja. Du kannst deinen eigenen Songtext eingeben, neue Lyrics von der KI schreiben lassen oder einen rein instrumentalen Song ohne Gesang erstellen.",
  },
  {
    question: "Sind auch türkische Songs möglich?",
    answer: "Ja. Das Songstudio unterstützt Deutsch, Türkisch und Englisch. Für türkische Musik stehen unter anderem dramatischer Arabesk und moderner Arabesk-Pop beziehungsweise Fantezi zur Auswahl.",
  },
];

export const metadata = productMetadata({
  title,
  description,
  path: STUDIO_PATHS.song,
  keywords: ["KI Song erstellen", "Song mit KI erstellen", "KI Musik Generator", "Song mit eigenen Lyrics", "türkischen Song erstellen"],
});

const jsonLd = productJsonLd({
  name: "KI-Song- und Musikgenerator",
  description,
  path: STUDIO_PATHS.song,
  category: "MultimediaApplication",
  lowPrice: "1.49",
  highPrice: "5.99",
  offerCount: 4,
  features: ["Songs bis vier Minuten", "Eigene oder KI-generierte Lyrics", "Deutsch, Türkisch und Englisch", "Instrumentale Musik"],
  faqs,
});

export default function SongStudioPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <StudioHome initialStudio="song" />
      <SeoContent
        active="song"
        eyebrow="KI-Musik online erstellen"
        title="Erstelle deinen eigenen vollständigen Song mit KI"
        intro="Lege Thema, Sprache, Stimmung, Musikstil und Gesangsart fest. Du kannst eigene Lyrics verwenden, einen neuen Songtext erstellen lassen, eine Sprachidee aufnehmen oder reine Instrumentalmusik erzeugen."
        benefits={[
          "Erzeuge Clips oder vollständige Songs mit zwei bis vier Minuten Länge.",
          "Nutze eigene Lyrics, einen KI-Songtext oder den Instrumentalmodus.",
          "Wähle unter anderem Pop, Rap, Arabesk, R&B, Rock und elektronische Musik.",
        ]}
        steps={[
          "Beschreibe Thema, Musikstil, Stimmung, Sprache und gewünschte Gesangsart.",
          "Gib eigene Lyrics ein oder lass einen passenden neuen Songtext durch die KI schreiben.",
          "Wähle die Songlänge, bezahle sicher und lade das fertige Ergebnis als MP3 herunter.",
        ]}
        faqs={faqs}
      />
    </>
  );
}
