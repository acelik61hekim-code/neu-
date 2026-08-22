import type { VideoDurationSeconds } from "@/types/story";

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
  "Ein geheimer Flirt wird vor allen aufgedeckt",
  "Eine heimliche Allianz wird verraten",
  "Ein Beweisstück taucht im schlimmsten Moment auf",
  "Ein geheimes Doppelleben fliegt auf",
  "Ein Erbe verändert plötzlich alle Machtverhältnisse",
  "Eine falsche Identität wird entlarvt",
] as const;

export type ViralStoryTemplate = {
  id: string;
  title: string;
  badge: string;
  description: string;
  previewVideoPath: string;
  characterIds: readonly string[];
  topic: string;
};

export const VIRAL_STORY_TEMPLATES = [
  {
    id: "firepit-confrontation",
    title: "Feuerkorb-Eklat",
    badge: "Trending",
    description: "Ein heimlicher Kuss fliegt vor allen auf.",
    previewVideoPath: "/viral-templates/firepit-confrontation.mp4",
    characterIds: [
      "ruby-strawberry",
      "melo-watermelon",
      "ora-orange",
    ],
    topic:
      "Ruby konfrontiert Melo am Feuerkorb der Tropenvilla: Ora bestätigt den heimlichen Kuss und enthüllt einen zweiten Beweis.",
  },
  {
    id: "bombshell-arrival",
    title: "Bombshell-Einzug",
    badge: "Neu",
    description: "Die neue Kandidatin kennt ein gefährliches Geheimnis.",
    previewVideoPath: "/viral-templates/bombshell-arrival.mp4",
    characterIds: [
      "ruby-strawberry",
      "melo-watermelon",
      "ora-orange",
    ],
    topic:
      "Ora zieht als Bombshell in die Tropenvilla ein und verrät Ruby, dass Melo ihr vor der Sendung bereits die Liebe versprochen hat.",
  },
  {
    id: "phone-evidence",
    title: "Handy-Beweis",
    badge: "Viral",
    description: "Eine Nachricht zerstört Melos Ausrede.",
    previewVideoPath: "/viral-templates/phone-evidence.mp4",
    characterIds: [
      "ruby-strawberry",
      "melo-watermelon",
      "ora-orange",
    ],
    topic:
      "Ruby findet auf Melos Handy eine eindeutige Sprachnachricht von Ora; Melo leugnet alles, bis Ora den Treffpunkt nennt.",
  },
  {
    id: "recoupling-betrayal",
    title: "Recoupling-Verrat",
    badge: "Plot Twist",
    description: "Bei der Paarwahl wechselt Melo plötzlich die Seite.",
    previewVideoPath: "/viral-templates/recoupling-betrayal.mp4",
    characterIds: [
      "ruby-strawberry",
      "melo-watermelon",
      "ora-orange",
    ],
    topic:
      "Melo wählt bei der Paarzeremonie überraschend Ora; Ruby enthüllt daraufhin, dass Melo ihr am selben Morgen einen Antrag gemacht hat.",
  },
  {
    id: "suitcase-cliffhanger",
    title: "Koffer-Cliffhanger",
    badge: "Serie",
    description: "Ruby will gehen – dann fällt ein Beweis aus dem Koffer.",
    previewVideoPath: "/viral-templates/suitcase-cliffhanger.mp4",
    characterIds: [
      "ruby-strawberry",
      "melo-watermelon",
      "ora-orange",
    ],
    topic:
      "Ruby packt nach Melos Geständnis ihren Koffer; dabei fällt Oras Armband heraus und Ora beschuldigt plötzlich Ruby.",
  },
  {
    id: "caught-in-the-act",
    title: "Auf frischer Tat",
    badge: "Drama",
    description: "Die Terrassentür öffnet sich im schlimmsten Moment.",
    previewVideoPath: "/viral-templates/caught-in-the-act.mp4",
    characterIds: [
      "ruby-strawberry",
      "melo-watermelon",
      "ora-orange",
    ],
    topic:
      "Ruby erwischt Melo und Ora nachts auf der Terrasse; Ora behauptet, sie wollten Ruby nur vor einer größeren Lüge schützen.",
  },
] as const satisfies readonly ViralStoryTemplate[];

export function getViralCharacters(
  ids: readonly string[],
): ViralCharacter[] {
  const uniqueIds =
    new Set(ids);

  return VIRAL_CHARACTERS.filter(
    (character) =>
      uniqueIds.has(
        character.id,
      ),
  );
}

export function createViralStoryPrompt(
  ids: readonly string[],
  topic: string,
  targetDurationSeconds: VideoDurationSeconds = 30,
): string {
  const characters =
    getViralCharacters(
      ids,
    );

  /*
   * Neue Seedance-Struktur:
   *
   * 15 s  = 1 Dialogabschnitt
   * 30 s  = 2 Dialogabschnitte
   * 60 s  = 4 Dialogabschnitte
   * 120 s = 8 Dialogabschnitte
   *
   * 8 Sekunden bleiben nur für alte
   * Legacy-Aufträge kompatibel.
   */
  const dialogueBeatCount =
    targetDurationSeconds <= 8
      ? 1
      : targetDurationSeconds <= 15
        ? 1
        : 1 +
          Math.ceil(
            (
              targetDurationSeconds -
              15
            ) /
              15,
          );

  const characterList =
    characters
      .map(
        (
          character,
          index,
        ) =>
          `${index + 1}. ${character.name}: ${character.fixedAppearance} Persönlichkeit: ${character.personality}.`,
      )
      .join("\n");

  return [
    "TIKTOK-STORY-MODUS MIT FESTEN FIGUREN.",

    `Erstelle automatisch eine originelle, leicht verständliche und emotionale Kurzgeschichte zum Thema: ${topic}.`,

    `Plane die Geschichte ausdrücklich für ${targetDurationSeconds} Sekunden und ${dialogueBeatCount} aufeinanderfolgende Dialogabschnitte. Jeder neue Seedance-Abschnitt umfasst 15 Sekunden. Behandle eine einminütige Geschichte niemals wie eine verlängerte 30-Sekunden-Skizze.`,

    "Nutze ausschließlich die folgenden ausgewählten Hauptfiguren und verändere niemals ihre Fruchtart, Gesichter, Körperproportionen, Kleidung, Farben oder Namen:",

    characterList,

    "VERBINDLICHE BILDWELT: Alle Szenen spielen in derselben luxuriösen tropischen Dating-Show-Villa mit Poolterrasse, Feuerkorb, Palmen und warmem Abendlicht. Erlaubte Bereiche sind Feuerkorb, Poolterrasse, Lounge und Schlafzimmer dieser Villa. Keine Büros, Lagerhallen, Klassenzimmer, Straßen, Studios oder neutralen Innenräume.",

    "GESCHLOSSENE BESETZUNG: Im gesamten Bild erscheinen ausschließlich die oben ausgewählten Früchte. Keine Menschen, Moderatoren, Statisten, Zuschauer, Hände fremder Personen, Silhouetten, Spiegelbilder oder zusätzlichen Früchte. Ein Fruchtkopf darf niemals durch ein menschliches Gesicht oder einen menschlichen Kopf ersetzt werden.",

    "TEXTFREIES BILD: Absolut keine Untertitel, Bauchbinden, Titelkarten, Sprechblasen, Buchstaben, Wörter, Zahlen, Logos, Wasserzeichen, Schilder, Namensschilder oder lesbare Handy-, Koffer- und Bildschirmtexte. Beweise werden durch stumme Gegenstände und die Reaktionen der Figuren gezeigt, nicht durch lesbare Schrift.",

    "Gib jeder Figur eine klare Trash-TV-Rolle, die aus ihrer Persönlichkeit entsteht: betrogene Hauptfigur, Provokateur, Geheimnisträger, Versuchung oder zweifelhafter Verbündeter. Lege eine Beziehung, ein verborgenes Geheimnis und ein sichtbares Beweisstück fest.",

    "In jeder Szene wird sichtbar gestritten. Plane mindestens drei deutlich erkennbare übertriebene Reaktionen pro 15-Sekunden-Abschnitt: anklagendes Zeigen, Unterbrechen, Augenrollen, empörtes Wegdrehen, entsetztes Zurückweichen, feindselige Seitenblicke oder riesige Doppeltakes. Niemand steht ruhig erklärend herum; der Streit bleibt ohne körperliche Gewalt.",

    "Erzähle wie eine zugespitzte, fortsetzbare TikTok-Microdrama-Serie: Skandal, Vorwürfe, Geheimnisse, starke Reaktionen, Gegenenthüllung und Cliffhanger. Keine Dokumentation, keine Reportage, keine Wissensvermittlung und kein erklärender Moderatorstil.",

    targetDurationSeconds === 60
      ? "Verbindliche Dramaturgie für eine Minute mit vier 15-Sekunden-Dialogbeats: Beat 1 zeigt sofort das Fremdgehen oder ein eindeutiges Beweisstück und die erste direkte Konfrontation; Beat 2 enthält die konkrete Antwort des Beschuldigten sowie ein überprüfbares Detail oder eine Ausrede; Beat 3 liefert die Aussage der dritten Figur, einen Widerspruch, ein Teilgeständnis oder ein neues Beweisstück; Beat 4 zeigt die persönliche Konsequenz, eine Gegenenthüllung und endet mit einem konkreten neuen Beweis, Namen, Ereignis oder einer eintretenden Figur als Cliffhanger."
      : `Verbindliche Dramaturgie: Nutze ${dialogueBeatCount} klar aufeinander aufbauende 15-Sekunden-Dialogbeats – Skandal, Beweis, direkte Antwort, Eskalation, Gegenenthüllung und einen konkreten Cliffhanger.`,

    "Jeder 15-sekündige Abschnitt hat eigene Mini-Beats: 0–3 Sekunden sichtbarer Hook oder Vorwurf, 3–7 Sekunden konkreter Beweis oder neue Information, 7–11 Sekunden extremes Reaktions-Close-up und Gegenantwort, 11–15 Sekunden Eskalation, Gegenenthüllung oder überraschender Sting.",

    "Die ersten zwei Sekunden zeigen bereits die Konsequenz oder den Skandal, nicht Vorgeschichte oder Zusammenfassung. Das Ende bleibt bewusst offen und serienfähig: eine Tür geht auf, ein neues Beweisstück erscheint, eine Figur reagiert geschockt oder ein Geheimnis wird nur halb enthüllt. Kein ruhiges Abschlussbild und keine vollständige Versöhnung.",

    "Die Figuren handeln wie erwachsene Menschen. Keine Kindergeschichte, keine Gewalt, keine Sexualisierung und keine Ähnlichkeit zu bekannten geschützten Figuren.",

    "Plane das Bild vertikal für TikTok. Schreibe kurze, natürliche Dialoge, in denen alle ausgewählten Figuren mindestens einmal sprechen. Die jeweils sichtbare Figur spricht ihren Satz selbst hörbar und lippensynchron in der Szene; unterschiedliche Stimmen zwischen Einstellungen sind akzeptabel.",

    `Beginne den Dialog bereits im ersten Story-Beat. Jeder weitere Abschnitt enthält mindestens eine neue, handlungsrelevante Aussage. Die einzelnen Sätze müssen einfach aussprechbar, höchstens ${
      targetDurationSeconds <= 8
        ? "sechs"
        : "zehn"
    } Wörter lang und klar der jeweils sichtbaren Figur zugeordnet sein. Innerhalb eines 15-Sekunden-Abschnitts sind mehrere kurze direkte Sprecherwechsel erlaubt, wenn sie natürlich hineinpassen. Kein Erzähler und kein Voice-over.`,

    "DIALOGLOGIK: Lege vor dem Schreiben eindeutig fest, wer wen betrogen hat, welche Beziehung bestand, welches sichtbare Beweisstück den Betrug belegt, wie lange das Geheimnis besteht und was die dritte Figur wusste. Jede Antwort muss direkt auf den vorherigen Satz reagieren und zusätzlich eine konkrete neue Information liefern.",

    "Bei einer Fremdgeh-Geschichte müssen die Dialoge den Partner, die dritte Person, das Beweisstück und mindestens ein Geständnis oder eine überprüfbare Lüge verständlich benennen. Verwende konkrete Wörter wie Kuss, Nachricht, Foto, Hotelrechnung, Hochzeit oder Zeitraum statt nur er, sie, das und alles.",

    "Verbotene leere Platzhaltersätze sind unter anderem: Das ist alles völlig anders; Du verstehst das nicht; Frag ihn lieber nicht; Und das ist erst der Anfang; Das hier ändert alles; Warte ab; Ich kann das erklären. Ein Cliffhanger nennt immer das konkrete neue Geheimnis oder Beweisstück.",

    "Schreibe natürliches gesprochenes Deutsch. Keine künstlichen Zusammensetzungen wie Hotelkuss und keine falsch getrennten Zahlwörter wie vierzig zwei; sage stattdessen Kuss im Hotel und Zimmer zweiundvierzig.",

    "Erfinde alle fehlenden Details selbst und schließe die Planung ohne Rückfrage ab.",
  ].join("\n\n");
}