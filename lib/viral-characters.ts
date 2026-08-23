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

export type ViralStoryTopic = {
  id: string;
  title: string;
  category: string;
  hook: string;
  conversation: string;
  cliffhanger: string;
  directorBrief: string;
};

/*
 * Die sichtbaren Kurzangaben sind für Kundinnen und Kunden.
 * directorBrief ist die bereits vollständig ausgearbeitete Regiegrundlage,
 * sodass niemand selbst einen langen Prompt schreiben muss.
 */
export const VIRAL_STORY_TOPICS = [
  {
    id: "caught-kiss",
    title: "Auf frischer Tat",
    category: "Fremdgehen",
    hook:
      "Die Hauptfigur öffnet die Terrassentür und sieht den heimlichen Kuss selbst.",
    conversation:
      "Vorwurf, konkrete Ausrede, Aussage der dritten Figur und ein Teilgeständnis.",
    cliffhanger:
      "Die dritte Figur zeigt einen zweiten identischen Ring.",
    directorBrief:
      "Fremdgehen auf frischer Tat: Die betrogene Hauptfigur öffnet nachts die Terrassentür und sieht die beschuldigte Figur die dritte Figur eindeutig küssen. Dieser sichtbare Kuss ist der primäre Beweis; ein Handy darf höchstens später ein Zeitraum-Detail bestätigen. Danach folgen die direkte Frage, eine überprüfbare Ausrede, die widersprechende Aussage der dritten Figur und ein Teilgeständnis. Am Ende zeigt die dritte Figur einen zweiten identischen Verlobungsring.",
  },
  {
    id: "double-promise",
    title: "Zwei Versprechen gleichzeitig",
    category: "Doppelleben",
    hook:
      "Zwei Figuren erscheinen gleichzeitig mit demselben Geschenk und derselben Liebeserwartung.",
    conversation:
      "Beide vergleichen konkrete Versprechen, Orte und Zeitpunkte.",
    cliffhanger:
      "Aus der Tasche fällt noch ein drittes persönliches Geschenk.",
    directorBrief:
      "Doppeltes Liebesversprechen: Zwei Figuren treffen gleichzeitig am Feuerkorb ein und tragen sichtbar dasselbe besondere Armband, das ihnen die beschuldigte Figur jeweils exklusiv geschenkt hat. Beide nennen nacheinander Ort, Zeitpunkt und Wortlaut des Versprechens. Die beschuldigte Figur versucht die Geschenke als Missverständnis darzustellen. Am Ende fällt aus ihrer Tasche ein drittes gleiches Armband.",
  },
  {
    id: "secret-wedding",
    title: "Heimliche Hochzeit",
    category: "Beziehungsschock",
    hook:
      "Unter dem normalen Outfit wird beim Streit sichtbar ein Ehering entdeckt.",
    conversation:
      "Die Figuren klären, wer verheiratet ist, seit wann und wer davon wusste.",
    cliffhanger:
      "Die vermeintliche Ehepartnerin betritt in Hochzeitskleidung die Villa.",
    directorBrief:
      "Heimliche Hochzeit: Während eines Streits rutscht der Ärmel der beschuldigten Figur hoch und ein versteckter Ehering wird sichtbar. Die Hauptfigur fragt konkret, seit wann die Ehe besteht; die dritte Figur gesteht, bei der Trauung dabei gewesen zu sein. Die beschuldigte Figur behauptet, die Ehe sei längst vorbei. Am Ende öffnet sich die Villatür und die vermeintliche Ehepartnerin erscheint in Hochzeitskleidung.",
  },
  {
    id: "recoupling-betrayal",
    title: "Verrat bei der Paarwahl",
    category: "Dating-Show",
    hook:
      "Die beschuldigte Figur wechselt vor allen sichtbar zur dritten Figur.",
    conversation:
      "Ein geheimes Morgenversprechen trifft auf die öffentliche neue Wahl.",
    cliffhanger:
      "Die verlassene Figur zieht den gemeinsamen Wohnungsschlüssel hervor.",
    directorBrief:
      "Verrat bei der Paarwahl: Die beschuldigte Figur stellt sich bei der Paarzeremonie demonstrativ neben die dritte Figur und lässt die bisherige Partnerfigur allein stehen. Die verlassene Figur nennt das konkrete Versprechen vom selben Morgen; die dritte Figur enthüllt, dass die Entscheidung schon seit drei Tagen feststand. Am Ende zeigt die verlassene Figur den gemeinsamen Wohnungsschlüssel und fragt, wer dort gestern geschlafen hat.",
  },
  {
    id: "stolen-necklace",
    title: "Das gestohlene Schmuckstück",
    category: "Diebstahl",
    hook:
      "Die vermisste Kette fällt sichtbar aus der Tasche der falschen Verbündeten.",
    conversation:
      "Fundort, Motiv und eine heimliche Übergabe werden konkret geklärt.",
    cliffhanger:
      "Die Besitzerin erkennt darin den Schlüssel zu einem verschlossenen Fach.",
    directorBrief:
      "Gestohlenes Schmuckstück: Beim Aufstehen fällt die lange vermisste Halskette sichtbar aus der Tasche der vermeintlich loyalen Figur. Die Besitzerin konfrontiert sie sofort mit Fundort und Zeitpunkt. Die beschuldigte Figur behauptet, die dritte Figur habe ihr die Kette gegeben; diese widerspricht und nennt eine heimliche Übergabe am Pool. Am Ende öffnet die Besitzerin mit dem Anhänger ein bislang verschlossenes Fach.",
  },
  {
    id: "secret-alliance",
    title: "Geheime Allianz",
    category: "Intrige",
    hook:
      "Die Hauptfigur beobachtet eine heimliche Übergabe eines eindeutigen Team-Symbols.",
    conversation:
      "Absprachen, Gegenleistung und die geplante Zielperson werden benannt.",
    cliffhanger:
      "Der Verbündete enthüllt, dass die Hauptfigur selbst Teil des Plans war.",
    directorBrief:
      "Geheime Allianz: Die Hauptfigur beobachtet hinter einer offenen Terrassentür, wie zwei Figuren heimlich ein unverwechselbares goldenes Team-Symbol austauschen und sich per Handschlag verbünden. In der Konfrontation werden die geplante Abstimmung, die Gegenleistung und die Zielperson konkret benannt. Eine Figur leugnet, die andere gesteht nur einen Teil. Am Ende enthüllt sie, dass die Hauptfigur ursprünglich selbst als dritte Verbündete eingeplant war.",
  },
  {
    id: "ex-arrives",
    title: "Der Ex zieht ein",
    category: "Bombshell",
    hook:
      "Die neue Figur tritt ein und wird sofort mit einer vertrauten Umarmung begrüßt.",
    conversation:
      "Die aktuelle Beziehung, das Trennungsdatum und ein heimliches Treffen kollidieren.",
    cliffhanger:
      "Der Ex besitzt noch den Schlüssel zum Schlafzimmer der beschuldigten Figur.",
    directorBrief:
      "Ex-Partner als Bombshell: Eine neue Figur betritt die Villa und die beschuldigte Figur begrüßt sie reflexartig mit einer deutlich zu vertrauten Umarmung. Die aktuelle Partnerfigur verlangt das echte Trennungsdatum. Der Ex nennt ein heimliches Treffen vom Vorabend, während die beschuldigte Figur behauptet, seit Monaten keinen Kontakt zu haben. Am Ende zieht der Ex den noch funktionierenden Schlüssel zum Schlafzimmer der beschuldigten Figur hervor.",
  },
  {
    id: "suitcase-secret",
    title: "Geheimnis im Koffer",
    category: "Cliffhanger",
    hook:
      "Beim hektischen Packen fällt ein fremdes persönliches Kleidungsstück heraus.",
    conversation:
      "Besitz, letzte Nacht und eine vertauschte Ausrede werden überprüfbar.",
    cliffhanger:
      "Im Koffer liegt zusätzlich ein gepacktes Ticket für zwei Personen.",
    directorBrief:
      "Geheimnis im Koffer: Eine Figur packt wütend, dabei fällt sichtbar ein unverwechselbares Kleidungsstück der dritten Figur aus dem Koffer. Die Partnerfigur fragt, warum es dort liegt; die beschuldigte Figur nennt eine konkrete, aber falsche Erklärung. Die dritte Figur widerspricht und sagt, wann sie das Stück zuletzt trug. Am Ende wird unter der Kleidung ein bereits gepacktes Reiseset für zwei Personen entdeckt.",
  },
  {
    id: "challenge-sabotage",
    title: "Sabotage vor der Challenge",
    category: "Wettbewerb",
    hook:
      "Eine Figur wird sichtbar beim Manipulieren des gegnerischen Requisits erwischt.",
    conversation:
      "Tat, Auftraggeber und versprochener Vorteil werden konkret offengelegt.",
    cliffhanger:
      "Die sabotierte Figur enthüllt eine zweite, absichtlich gestellte Falle.",
    directorBrief:
      "Sabotierte Villa-Challenge: Die Hauptfigur erwischt eine andere Figur sichtbar dabei, das farbige Challenge-Requisit des gegnerischen Teams zu vertauschen. Die Täterfigur behauptet, allein gehandelt zu haben. Die dritte Figur nennt jedoch den versprochenen Vorteil und die genaue Absprache. Am Ende zeigt die Hauptfigur, dass das manipulierte Requisit nur eine Falle war und die echte Entscheidung noch bevorsteht.",
  },
  {
    id: "prize-money",
    title: "Das verschwundene Preisgeld",
    category: "Geld & Loyalität",
    hook:
      "Ein geheimer Geldumschlag wird sichtbar in einer privaten Tasche entdeckt.",
    conversation:
      "Herkunft, versprochene Teilung und ein geplanter Alleingang werden benannt.",
    cliffhanger:
      "Eine zweite Figur öffnet einen noch größeren versteckten Umschlag.",
    directorBrief:
      "Verschwundenes Preisgeld: Beim Streit öffnet sich eine private Tasche und ein dicker versiegelter Geldumschlag fällt sichtbar heraus. Die Figuren klären konkret, wem das Geld versprochen war und wann es heimlich genommen wurde. Die beschuldigte Figur behauptet, es für alle sichern zu wollen; die dritte Figur enthüllt den geplanten Alleingang. Am Ende öffnet sie ihrerseits einen noch größeren versteckten Umschlag.",
  },
  {
    id: "two-engagements",
    title: "Zwei Verlobungen",
    category: "Liebesdreieck",
    hook:
      "Zwei Figuren halten gleichzeitig sichtbar passende Verlobungsringe hoch.",
    conversation:
      "Antragsort, Datum und das doppelte Zukunftsversprechen werden verglichen.",
    cliffhanger:
      "Die beschuldigte Figur trägt selbst einen Ring mit einer dritten Farbe.",
    directorBrief:
      "Doppelte Verlobung: Zwei Figuren halten bei der Konfrontation gleichzeitig ihre jeweils passenden Verlobungsringe hoch und merken, dass beide von derselben Figur stammen. Sie vergleichen Antragsort, Datum und Zukunftsversprechen. Die beschuldigte Figur nennt einen Ring eine Fälschung, doch die Gravur-Symbole sind sichtbar identisch. Am Ende wird an ihrer eigenen Hand ein dritter Ring in einer anderen Farbe entdeckt.",
  },
  {
    id: "false-alibi",
    title: "Die aufgeflogene Ausrede",
    category: "Lüge",
    hook:
      "Die beschuldigte Figur kommt in fremder Jacke aus dem falschen Zimmer.",
    conversation:
      "Ort, Nachtzeit und Besitzer der Jacke widersprechen sich direkt.",
    cliffhanger:
      "Die dritte Figur kommt mit der fehlenden Hälfte des Outfits herein.",
    directorBrief:
      "Aufgeflogene Ausrede: Die beschuldigte Figur tritt morgens sichtbar aus dem Schlafzimmer der dritten Figur und trägt deren unverwechselbare Jacke. Die Partnerfigur fragt nach Ort und Nachtzeit; die erste Ausrede widerspricht dem sichtbaren Zimmer und dem Kleidungsstück. Die dritte Figur nennt ein konkretes gemeinsames Detail, versucht aber die Beziehung herunterzuspielen. Am Ende erscheint sie mit der fehlenden Hälfte des zusammengehörigen Outfits.",
  },
] as const satisfies readonly ViralStoryTopic[];

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
      "Ruby sieht zu Beginn selbst, wie Melo und Ora sich hinter dem Feuerkorb heimlich küssen. Sie konfrontiert beide sofort; Ora nennt den Zeitpunkt ihres ersten Kusses, Melo leugnet, und als Cliffhanger zeigt Ora einen zweiten identischen Ring.",
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
      "Ora zieht als Bombshell ein und Melo begrüßt sie sichtbar mit einer viel zu vertrauten Umarmung. Ruby fragt nach ihrem echten Trennungsdatum; Ora nennt ein Treffen vom Vorabend und zeigt am Ende den noch funktionierenden Schlüssel zu Melos Zimmer.",
  },
  {
    id: "phone-evidence",
    title: "Erwischt + Handy-Beweis",
    badge: "Viral",
    description: "Ruby sieht den Kuss; die Nachricht bestätigt nur den Zeitraum.",
    previewVideoPath: "/viral-templates/phone-evidence.mp4",
    characterIds: [
      "ruby-strawberry",
      "melo-watermelon",
      "ora-orange",
    ],
    topic:
      "Ruby sieht zuerst selbst, wie Melo und Ora sich auf der Poolterrasse küssen. Das sichtbare Fremdgehen ist der Hauptbeweis. Erst danach bestätigt eine kurze Sprachnachricht auf Melos Handy, dass die Affäre seit drei Monaten läuft. Melo leugnet, bis Ora den ersten Treffpunkt konkret nennt.",
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
      "Melo stellt sich bei der Paarzeremonie sichtbar neben Ora und lässt Ruby allein. Ruby hält den Ring vom Antrag am selben Morgen hoch; Ora enthüllt, dass die neue Paarwahl seit drei Tagen abgesprochen war. Am Ende zeigt Ruby ihren gemeinsamen Wohnungsschlüssel.",
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
      "Ruby packt nach Melos Geständnis sichtbar ihren Koffer; dabei fällt Oras unverwechselbares Armband aus Melos Jacke. Melo behauptet, Ruby habe es dort versteckt. Ora widerspricht mit einem konkreten Detail und entdeckt am Ende unter der Kleidung ein vorbereitetes Reiseset für zwei.",
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
      "Ruby öffnet nachts die Terrassentür und sieht Melo und Ora eindeutig küssen. Sie stellt beide sofort zur Rede. Ora gesteht den Kuss, behauptet aber, Melo habe Ruby längst verlassen. Als Cliffhanger öffnet sich die Tür erneut und eine zweite Partnerfigur betritt die Villa.",
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

    "PRIMÄRER SICHTBARER BEWEIS: Der zentrale Verrat oder Regelbruch wird als eindeutige Handlung im Bild gezeigt, bevor oder während er ausgesprochen wird. Bei Fremdgehen sieht die betrogene Figur den Kuss, die vertraute Umarmung, das Händchenhalten, das gemeinsame Verlassen eines Zimmers oder eine vergleichbar eindeutige intime Situation selbst. Ein Handy, Foto, Chat, Brief oder Beleg darf nur ein zusätzliches Detail bestätigen und niemals der einzige oder wichtigste Beweis sein.",

    "VISUELLE KAUSALITÄT: Zeige Ursache, Entdeckung und Reaktion in dieser Reihenfolge. Die Kamera zeigt zuerst die konkrete Handlung oder den eindeutig zuordenbaren Gegenstand, dann die Figur, die ihn entdeckt, danach das Gesicht der beschuldigten Figur. Keine abstrakten Beweis-Close-ups ohne sichtbaren Besitzer, Ort oder Handlung.",

    "Gib jeder Figur eine klare Trash-TV-Rolle, die aus ihrer Persönlichkeit entsteht: betrogene Hauptfigur, Provokateur, Geheimnisträger, Versuchung oder zweifelhafter Verbündeter. Lege vor der Szenenplanung eindeutig fest: bestehende Beziehung, konkrete verbotene Handlung, wer sie direkt sieht, ergänzendes Beweisstück, überprüfbare Ausrede, Gegenenthüllung und persönliche Konsequenz.",

    "In jeder Szene wird sichtbar gestritten. Plane mindestens drei deutlich erkennbare übertriebene Reaktionen pro 15-Sekunden-Abschnitt: anklagendes Zeigen, Unterbrechen, Augenrollen, empörtes Wegdrehen, entsetztes Zurückweichen, feindselige Seitenblicke oder riesige Doppeltakes. Niemand steht ruhig erklärend herum; der Streit bleibt ohne körperliche Gewalt.",

    "Erzähle wie eine zugespitzte, fortsetzbare TikTok-Microdrama-Serie: Skandal, Vorwürfe, Geheimnisse, starke Reaktionen, Gegenenthüllung und Cliffhanger. Keine Dokumentation, keine Reportage, keine Wissensvermittlung und kein erklärender Moderatorstil.",

    targetDurationSeconds === 60
      ? "Verbindliche Dramaturgie für eine Minute mit vier 15-Sekunden-Dialogbeats: Beat 1 zeigt sofort die verbotene Handlung selbst und die erste direkte Konfrontation; Beat 2 enthält die konkrete Antwort des Beschuldigten sowie ein überprüfbares Detail oder eine Ausrede; Beat 3 liefert die Aussage der dritten Figur, einen Widerspruch, ein Teilgeständnis oder ein zusätzliches Beweisstück; Beat 4 zeigt die persönliche Konsequenz, eine Gegenenthüllung und endet mit einem konkreten neuen Beweis, Namen, Ereignis oder einer eintretenden Figur als Cliffhanger."
      : `Verbindliche Dramaturgie: Nutze ${dialogueBeatCount} klar aufeinander aufbauende 15-Sekunden-Dialogbeats – Skandal, Beweis, direkte Antwort, Eskalation, Gegenenthüllung und einen konkreten Cliffhanger.`,

    "Jeder 15-sekündige Abschnitt nutzt echte interne Schnitte: 0–2 Sekunden schockierender Cold Open, 2–5 Sekunden weite Einstellung der konkreten Handlung oder Entdeckung, 5–9 Sekunden beschuldigte Figur mit direkter Antwort, 9–12 Sekunden Zeuge oder Gegenreaktion, 12–15 Sekunden neue sichtbare Enthüllung oder überraschender Sting.",

    "Die ersten zwei Sekunden zeigen bereits die Konsequenz oder den Skandal, nicht Vorgeschichte oder Zusammenfassung. Das Ende bleibt bewusst offen und serienfähig: eine Tür geht auf, ein neues Beweisstück erscheint, eine Figur reagiert geschockt oder ein Geheimnis wird nur halb enthüllt. Kein ruhiges Abschlussbild und keine vollständige Versöhnung.",

    "Die Figuren handeln wie erwachsene Menschen. Keine Kindergeschichte, keine Gewalt, keine Sexualisierung und keine Ähnlichkeit zu bekannten geschützten Figuren.",

    "Plane das Bild vertikal für TikTok. Schreibe kurze, natürliche deutsche Dialoge, in denen alle ausgewählten Figuren mindestens einmal sprechen. Zeige beim Satz die jeweils sprechende Figur mit natürlicher Mund-, Gesichts- und Körperbewegung. Die endgültigen festen deutschen Figurenstimmen werden anschließend szenengenau im Studio gemischt.",

    `Beginne den Dialog bereits im ersten Story-Beat. Jeder weitere Abschnitt enthält mindestens eine neue, handlungsrelevante Aussage. Die einzelnen Sätze müssen einfach aussprechbar, höchstens ${
      targetDurationSeconds <= 8
        ? "sechs"
        : "neun"
    } Wörter lang und klar der jeweils sichtbaren Figur zugeordnet sein. Innerhalb eines 15-Sekunden-Abschnitts sind mehrere kurze direkte Sprecherwechsel erlaubt, wenn sie natürlich hineinpassen. Kein Erzähler und kein Voice-over.`,

    "DIALOGLOGIK: Lege vor dem Schreiben eindeutig fest, wer wen betrogen hat, welche Beziehung bestand, welches sichtbare Beweisstück den Betrug belegt, wie lange das Geheimnis besteht und was die dritte Figur wusste. Jede Antwort muss direkt auf den vorherigen Satz reagieren und zusätzlich eine konkrete neue Information liefern.",

    "Bei einer Fremdgeh-Geschichte müssen Bild und Dialog den Partner, die dritte Person, die tatsächlich beobachtete Handlung und mindestens ein Geständnis oder eine überprüfbare Lüge verständlich benennen. Verwende einfache konkrete Wörter wie Kuss, Umarmung, Zimmer, Ring, gestern oder drei Monate statt nur er, sie, das und alles.",

    "Verbotene leere Platzhaltersätze sind unter anderem: Das ist alles völlig anders; Du verstehst das nicht; Frag ihn lieber nicht; Und das ist erst der Anfang; Das hier ändert alles; Warte ab; Ich kann das erklären. Ein Cliffhanger nennt immer das konkrete neue Geheimnis oder Beweisstück.",

    "AUSSPRACHE-SICHERES DEUTSCH: Nutze kurze Hauptsätze, häufige Alltagswörter und ausgeschriebene Zahlen. Keine Abkürzungen, englischen Füllwörter, Ziffern, Hashtags, Schrägstriche oder künstlichen Zusammensetzungen wie Hotelkuss. Sage stattdessen Kuss im Hotel und Zimmer zweiundvierzig.",

    "Erfinde alle fehlenden Details selbst und schließe die Planung ohne Rückfrage ab.",
  ].join("\n\n");
}
