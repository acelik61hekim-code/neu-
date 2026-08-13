export const IMAGE_QUALITIES = ["professional", "premium"] as const;
export const IMAGE_ASPECT_RATIOS = ["1:1", "4:5", "3:2", "2:3", "16:9", "9:16"] as const;
export const IMAGE_STYLES = ["photo", "product", "marketing", "poster", "illustration", "interior", "art"] as const;

export type ImageQuality = (typeof IMAGE_QUALITIES)[number];
export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];
export type ImageStyle = (typeof IMAGE_STYLES)[number];

export const IMAGE_PRICE_CENTS: Record<ImageQuality, number> = {
  professional: 199,
  premium: 349,
};

export function isImageQuality(value: unknown): value is ImageQuality {
  return typeof value === "string" && IMAGE_QUALITIES.includes(value as ImageQuality);
}

export function isImageAspectRatio(value: unknown): value is ImageAspectRatio {
  return typeof value === "string" && IMAGE_ASPECT_RATIOS.includes(value as ImageAspectRatio);
}

export function isImageStyle(value: unknown): value is ImageStyle {
  return typeof value === "string" && IMAGE_STYLES.includes(value as ImageStyle);
}

export function imageQualityLabel(value: ImageQuality): string {
  return value === "professional" ? "Professional 2K" : "Premium 4K";
}

export function imageModel(value: ImageQuality): string {
  return value === "professional" ? "gemini-3.1-flash-image" : "gemini-3-pro-image";
}

export function imageSize(value: ImageQuality): "2K" | "4K" {
  return value === "professional" ? "2K" : "4K";
}

export function buildProfessionalImagePrompt(input: {
  prompt: string;
  style: ImageStyle;
  aspectRatio: ImageAspectRatio;
  textInImage?: string;
  colorMood?: string;
  negativePrompt?: string;
}): string {
  const styleDirections: Record<ImageStyle, string> = {
    photo: "Create a highly realistic professional photograph with natural materials, physically plausible lighting, refined composition, authentic detail and premium color grading.",
    product: "Create a premium commercial product photograph suitable for a high-end advertising campaign, with controlled studio lighting, clean composition and precise materials.",
    marketing: "Create a polished professional marketing visual with strong hierarchy, intentional negative space and brand-ready composition.",
    poster: "Create a striking professional poster visual with cinematic composition, clear focal point and sophisticated graphic design.",
    illustration: "Create a refined editorial illustration with deliberate shapes, premium color harmony and crisp professional execution.",
    interior: "Create an architectural interior visualization with realistic scale, materials, lighting and publication-quality styling.",
    art: "Create a gallery-quality artistic image with a distinctive original visual language, intentional composition and rich detail.",
  };

  return [
    styleDirections[input.style],
    `CUSTOMER REQUEST: ${input.prompt.trim()}`,
    `OUTPUT COMPOSITION: ${input.aspectRatio} aspect ratio. Fill the complete canvas without borders or mockup frames.`,
    input.colorMood?.trim() ? `COLOR AND MOOD: ${input.colorMood.trim()}` : "",
    input.textInImage?.trim()
      ? `VISIBLE TEXT: Render exactly this text legibly and correctly: “${input.textInImage.trim()}”. Do not add other words.`
      : "Do not add captions, logos, signatures, watermarks or arbitrary text unless the customer explicitly requested them in the main description.",
    input.negativePrompt?.trim() ? `AVOID: ${input.negativePrompt.trim()}` : "",
    "The result must be an original image. Do not copy a living artist's signature style, copyrighted character, brand logo or an identifiable private person. No explanation; return only the final image.",
  ].filter(Boolean).join("\n\n");
}
