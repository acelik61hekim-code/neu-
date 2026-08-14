import HomePage from "@/app/page";
import SeoContent, { type SeoFaq } from "@/components/SeoContent";
import { productJsonLd, productMetadata } from "@/lib/seo";
import { STUDIO_PATHS } from "@/lib/site";

const title = "KI-Bilder erstellen – professionelle Bilder in 2K oder 4K";
const description =
  "Erstelle professionelle KI-Bilder nach deiner Beschreibung: Fotos, Produktbilder, Werbemotive, Poster und Illustrationen in vielen Formaten und bis zu 4K.";

const faqs: SeoFaq[] = [
  {
    question: "Welche Arten von KI-Bildern kann ich erstellen?",
    answer: "Möglich sind unter anderem fotorealistische Bilder, Produktfotografie, Werbemotive, Poster, Illustrationen, Architektur- und Interiorbilder sowie künstlerische Motive.",
  },
  {
    question: "Welche Auflösungen stehen zur Auswahl?",
    answer: "Du kannst Professional 2K für schnelle hochwertige Ergebnisse oder Premium 4K für maximale Details, Werbung und Print wählen.",
  },
  {
    question: "Welche Bildformate gibt es?",
    answer: "Das Bildstudio unterstützt 1:1, 4:5, 3:2, 2:3, 16:9 und 9:16 für Posts, Werbung, Webseiten, Poster, Stories und Reels.",
  },
];

export const metadata = productMetadata({
  title,
  description,
  path: STUDIO_PATHS.image,
  keywords: ["KI Bilder erstellen", "KI Bildgenerator", "AI Bilder erstellen", "KI Produktbilder", "professionelle KI Bilder"],
});

const jsonLd = productJsonLd({
  name: "Professioneller KI-Bildgenerator",
  description,
  path: STUDIO_PATHS.image,
  category: "GraphicsApplication",
  lowPrice: "1.99",
  highPrice: "3.49",
  offerCount: 2,
  features: ["Bilder in 2K oder 4K", "Sechs Bildformate", "Fotos, Werbung und Illustrationen", "Individuelle Farbstimmung und Text"],
  faqs,
});

export default function ImageStudioPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <HomePage initialStudio="image" />
      <SeoContent
        active="image"
        eyebrow="Professionelle KI-Bilder"
        title="Deine Beschreibung wird zu einem professionellen Wunschbild"
        intro="Beschreibe Motiv, Umgebung, Licht, Perspektive, Farben und alle wichtigen Details. Das Bildstudio erzeugt daraus ein individuelles Ergebnis für Social Media, Werbung, Webseiten oder Print."
        benefits={[
          "Wähle professionelle 2K- oder detailreiche Premium-4K-Qualität.",
          "Erstelle Fotos, Produktbilder, Poster, Werbemotive und Illustrationen.",
          "Bestimme Format, Farbstimmung, sichtbaren Text und unerwünschte Elemente.",
        ]}
        steps={[
          "Beschreibe dein Motiv möglichst genau und wähle den passenden Bildstil.",
          "Lege Format, Qualität, Farben und optional einen sichtbaren Text fest.",
          "Bezahle sicher, lass das Bild erzeugen und lade die hochauflösende Datei herunter.",
        ]}
        faqs={faqs}
      />
    </>
  );
}
