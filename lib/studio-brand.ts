export const STUDIO_NAME = "KI Video Studio";
export const STUDIO_URL = "https://ki-video-studio.vercel.app";

export const STUDIO_BRAND_CONTEXT = `
FESTER MARKEN- UND PRODUKTKONTEXT

- Du arbeitest direkt innerhalb der bereits existierenden Plattform "${STUDIO_NAME}".
- Die offizielle Webseite ist ${STUDIO_URL}.
- Die Plattform bietet die Bereiche "Video erstellen", "Song erstellen" und "Bild erstellen".
- Wenn der Nutzer von "meiner Webseite", "meiner eigenen Webseite", "dieser Webseite", "unserer Webseite" oder "deiner Webseite" spricht, meint er ${STUDIO_NAME} unter ${STUDIO_URL}.
- Erfinde in diesem Fall niemals eine andere KI-Plattform, eine neue Marke oder eine generische Fantasie-Webseite.
- Wenn der Nutzer Werbung für diese Webseite verlangt, plane ausdrücklich eine Marken- und Produktwerbung für ${STUDIO_NAME}. Zeige eine reale Person, die die bestehende Webseite auf Smartphone oder Computer benutzt und dort Video, Song oder Bild auswählt.
- Name und Internetadresse der Marke müssen im Story-Kontext eindeutig stehen. Sichtbare Schrift wird später möglichst aus einer echten Referenzaufnahme der Webseite übernommen und darf nicht als Fantasieschrift neu erfunden werden.
`.trim();

const ADVERTISEMENT_PATTERN =
  /\b(?:werb(?:ung|e|evideo|efilm)?|promo(?:tion|video)?|anzeige|reklame|marketing|commercial|advert(?:isement|ising)?)\b/i;

const STUDIO_REFERENCE_PATTERN =
  /(?:ki[\s-]?video[\s-]?studio|ki-video-studio\.vercel\.app|(?:mein(?:e|er|en|em)?|eigen(?:e|er|en|em)?|dein(?:e|er|en|em)?|sein(?:e|er|en|em)?|ihr(?:e|er|en|em)?|unser(?:e|er|en|em)?|dies(?:e|er|en|em)?)\s+(?:(?:eigen|aktuell)(?:e|er|en|em)?\s+)?(?:webseite|website|homepage|seite))/i;

export function isStudioWebsiteAdvertisement(value: string): boolean {
  return (
    ADVERTISEMENT_PATTERN.test(value) &&
    STUDIO_REFERENCE_PATTERN.test(value)
  );
}

export function buildStudioAdvertisementDirection(): string {
  return [
    `This is an advertisement for the real, existing product ${STUDIO_NAME} (${STUDIO_URL}).`,
    `Show the authentic ${STUDIO_NAME} website interface on the device display, based on the supplied official reference image.`,
    "The interface uses a dark premium design with violet accents and the three product areas Video, Songs and Bilder.",
    "Do not replace the real website with abstract neon waves, a fake app, a fictional logo or an invented interface.",
    "Treat the supplied website screenshot as a protected product reference: preserve its recognizable layout, colors and branding on the screen.",
  ].join(" ");
}
