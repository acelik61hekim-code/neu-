import StudioHome from "@/components/StudioHome";
import SeoContent, { type SeoFaq } from "@/components/SeoContent";
import { productJsonLd, productMetadata } from "@/lib/seo";
import { STUDIO_PATHS } from "@/lib/site";

const title = "KI-Song erstellen – mit eigenen Lyrics oder KI-Text";
const description =
  "Erstelle zwei vollständige KI-Song-Versionen mit Cover – instrumental, mit eigenen Lyrics oder neu geschriebenem KI-Songtext auf Deutsch, Türkisch oder Englisch.";

const faqs: SeoFaq[] = [
  {
    question: "Wie lang kann ein KI-Song werden?",
    answer: "Die passende Länge wird automatisch aus Songaufbau, Lyrics und Musikstil bestimmt. Du musst keine Minuten auswählen.",
  },
  {
    question: "Kann ich meine eigenen Lyrics verwenden?",
    answer: "Ja. Du kannst deinen eigenen Songtext eingeben, neue Lyrics von der KI schreiben lassen oder einen rein instrumentalen Song ohne Gesang erstellen.",
  },
  {
    question: "Sind auch türkische Songs möglich?",
    answer: "Ja. Das Songstudio unterstützt Deutsch, Türkisch und Englisch. Deinen gewünschten Musikstil beschreibst du frei mit eigenen Worten.",
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
  features: ["Zwei Song-Versionen mit Cover", "Eigene oder KI-generierte Lyrics", "Frei beschreibbarer Musikstil", "Instrumentale Musik"],
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
          "Erhalte zwei vollständige Song-Versionen samt Cover und M4A-Download.",
          "Nutze eigene Lyrics, einen KI-Songtext oder den Instrumentalmodus.",
          "Beschreibe deinen gewünschten Musikstil frei mit eigenen Worten.",
        ]}
        steps={[
          "Beschreibe Thema, Musikstil, Stimmung, Sprache und gewünschte Gesangsart.",
          "Gib eigene Lyrics ein oder lass einen passenden neuen Songtext durch die KI schreiben.",
          "Bezahle sicher und lade anschließend beide fertigen Versionen als M4A herunter.",
        ]}
        faqs={faqs}
      />
    </>
  );
}
