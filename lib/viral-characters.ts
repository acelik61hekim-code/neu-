export type ViralCharacter = {
  id: string;
  name: string;
  shortName: string;
  imagePath: string;
  personality: string;
  fixedAppearance: string;
  voiceName: string;
};

export const VIRAL_CHARACTERS = [
  {
    id: "ruby-strawberry",
    name: "Ruby, die Erdbeere",
    shortName: "Ruby",
    imagePath: "/viral-characters/ruby-strawberry.webp",
    personality: "selbstbewusst, emotional und schlagfertig",
    voiceName: "Kore",
    fixedAppearance:
      "Erwachsene anthropomorphe Erdbeerfrau mit reifem rotem Erdbeerkopf, ausdrucksstarken braunen Augen, kleinem grünen Blätterkranz, athletischem menschlichem Körper, cremefarbener Collegejacke, rotem Oberteil, roter Hose und roten Sneakern.",
  },
  {
    id: "bano-banana",
    name: "Bano, die Banane",
    shortName: "Bano",
    imagePath: "/viral-characters/bano-banana.webp",
    personality: "charmant, spontan und etwas naiv",
    voiceName: "Puck",
    fixedAppearance:
      "Erwachsener anthropomorpher Bananenmann mit gebogenem gelbem Bananenkopf, großen braunen Augen, schlankem menschlichem Körper, kobaltblauem Hoodie, dunkler Jeans und weißen Sneakern.",
  },
  {
    id: "pina-pineapple",
    name: "Pina, die Ananas",
    shortName: "Pina",
    imagePath: "/viral-characters/pina-pineapple.webp",
    personality: "ehrgeizig, elegant und kontrolliert",
    voiceName: "Aoede",
    fixedAppearance:
      "Erwachsene anthropomorphe Ananasfrau mit golden strukturiertem Ananaskopf, hohen grünen Blattspitzen, braunen Augen, erwachsenem menschlichem Körper, dunkelgrünem Blazer, schwarzem Oberteil, schwarzer Hose und schwarzen Schuhen.",
  },
  {
    id: "limo-lemon",
    name: "Limo, die Zitrone",
    shortName: "Limo",
    imagePath: "/viral-characters/limo-lemon.webp",
    personality: "witzig, neugierig und loyal",
    voiceName: "Charon",
    fixedAppearance:
      "Erwachsener anthropomorpher Zitronenmann mit leuchtend gelbem Zitronenkopf, einem grünen Blatt, braunen Augen, erwachsenem menschlichem Körper, violetter Bomberjacke, weißem Shirt, anthrazitfarbener Hose und weißen Sneakern.",
  },
  {
    id: "melo-watermelon",
    name: "Melo, die Wassermelone",
    shortName: "Melo",
    imagePath: "/viral-characters/melo-watermelon.webp",
    personality: "beschützend, ruhig und überraschend sensibel",
    voiceName: "Orus",
    fixedAppearance:
      "Erwachsener anthropomorpher Wassermelonenmann mit rundem dunkelgrün gestreiftem Wassermelonenkopf, kleinem roten Melonenstück oben rechts, grün-braunen Augen, kräftigem menschlichem Körper, burgunderroter Collegejacke, schwarzem Shirt, schwarzer Jeans und weißen Sneakern.",
  },
  {
    id: "ora-orange",
    name: "Ora, die Orange",
    shortName: "Ora",
    imagePath: "/viral-characters/ora-orange.webp",
    personality: "lebhaft, direkt und optimistisch",
    voiceName: "Leda",
    fixedAppearance:
      "Erwachsene anthropomorphe Orangenfrau mit leuchtend strukturiertem Orangenkopf, zwei grünen Blättern, braunen Augen, sportlichem menschlichem Körper, türkiser kurzer Jacke, weißem Oberteil, dunkler Jeans und orangefarbenen Sneakern.",
  },
  {
    id: "gino-grape",
    name: "Gino, die Traube",
    shortName: "Gino",
    imagePath: "/viral-characters/gino-grape.webp",
    personality: "clever, skeptisch und trocken-humorvoll",
    voiceName: "Fenrir",
    fixedAppearance:
      "Erwachsener anthropomorpher Traubenmann mit kompaktem Kopf aus glänzenden violetten Trauben, kleinem Stiel und grünem Weinblatt, braunen Augen, schlankem menschlichem Körper, senfgelbem Overshirt, schwarzem T-Shirt, schwarzer Hose und schwarzen Schuhen.",
  },
  {
    id: "ava-avocado",
    name: "Ava, die Avocado",
    shortName: "Ava",
    imagePath: "/viral-characters/ava-avocado.webp",
    personality: "besonnen, stilvoll und geheimnisvoll",
    voiceName: "Zephyr",
    fixedAppearance:
      "Erwachsene anthropomorphe Avocadofrau mit birnenförmigem hellgrünem Avocadokopf und dunkelgrünem Rand, braunen Augen, elegantem menschlichem Körper, korallfarbenem Blazer, cremefarbenem Outfit, rundem braunem Gürtelornament und grünen Schuhen.",
  },
] as const satisfies readonly ViralCharacter[];

export const VIRAL_STORY_TOPICS = [
  "Fremdgehen und überraschende Enthüllung",
  "Eifersucht mit unerwartetem Ende",
  "Geheimes Doppelleben",
  "Freundschaft wird auf die Probe gestellt",
  "Verwechslung mit großem Twist",
  "Peinliches Geheimnis wird öffentlich",
] as const;

export function getViralCharacters(ids: readonly string[]): ViralCharacter[] {
  const uniqueIds = new Set(ids);
  return VIRAL_CHARACTERS.filter((character) => uniqueIds.has(character.id));
}

export function createViralStoryPrompt(
  ids: readonly string[],
  topic: string,
): string {
  const characters = getViralCharacters(ids);
  const characterList = characters
    .map(
      (character, index) =>
        `${index + 1}. ${character.name}: ${character.fixedAppearance} Persönlichkeit: ${character.personality}.`,
    )
    .join("\n");

  return [
    "TIKTOK-STORY-MODUS MIT FESTEN FIGUREN.",
    `Erstelle automatisch eine originelle, leicht verständliche und emotionale Kurzgeschichte zum Thema: ${topic}.`,
    "Nutze ausschließlich die folgenden ausgewählten Hauptfiguren und verändere niemals ihre Fruchtart, Gesichter, Körperproportionen, Kleidung, Farben oder Namen:",
    characterList,
    "Erzähle wie überzeichnetes TikTok-Trash-TV: ein sofortiger zwischenmenschlicher Konflikt, Vorwürfe, Geheimnisse, starke Reaktionen, eine dramatische Enthüllung und ein abgeschlossener überraschender Höhepunkt. Keine Dokumentation, keine Reportage, keine Wissensvermittlung und kein erklärender Moderatorstil.",
    "Die Handlung braucht in den ersten zwei Sekunden einen sofort verständlichen visuellen Hook, danach klare Eskalationen, eine starke Enthüllung und ein abgeschlossenes überraschendes Ende.",
    "Die Figuren handeln wie erwachsene Menschen. Keine Kindergeschichte, keine Gewalt, keine Sexualisierung und keine Ähnlichkeit zu bekannten geschützten Figuren.",
    "Plane das Bild vertikal für TikTok. Keine eingeblendeten Texte. Schreibe kurze, natürliche Dialoge, in denen alle ausgewählten Figuren mindestens einmal sprechen. Die jeweils sichtbare Figur spricht ihren Satz selbst hörbar und lippensynchron in der Szene; unterschiedliche Stimmen zwischen Einstellungen sind akzeptabel.",
    "Beginne den Dialog bereits im ersten Story-Beat. Die Sätze müssen einfach aussprechbar, höchstens zwölf Wörter lang und klar der jeweils sichtbaren Figur zugeordnet sein. Kein Erzähler und kein Voice-over.",
    "Erfinde alle fehlenden Details selbst und schließe die Planung ohne Rückfrage ab.",
  ].join("\n\n");
}
