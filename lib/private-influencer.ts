import { Redis } from "@upstash/redis";

import type { VoiceoverVoiceName } from "@/lib/audio-options";

export const PRIVATE_INFLUENCER_MAX_IMAGES = 3;
export const PRIVATE_INFLUENCER_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export const PRIVATE_INFLUENCER_MAX_IMAGE_BYTES = 1_500_000;

export type PrivateInfluencerImage = {
  pathname: string;
  name: string;
  mimeType: string;
};

export type PrivateInfluencerProfile = {
  displayName: string;
  appearance: string;
  personality: string;
  contentStyle: string;
  audience: string;
  defaultCallToAction: string;
  voiceName: VoiceoverVoiceName;
  images: PrivateInfluencerImage[];
  updatedAt: number;
};

type PrivateInfluencerStoredImage = {
  dataBase64: string;
  mimeType: string;
};

const redis =
  process.env.UPSTASH_REDIS_REST_URL &&
  process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

const memoryProfiles = new Map<string, PrivateInfluencerProfile>();
const memoryImages = new Map<string, PrivateInfluencerStoredImage>();
const profileKey = (userId: string) => `account:${userId}:private-influencer`;
const imageKey = (pathname: string) => `private-influencer-image:${pathname}`;

function configuredOwnerEmails(): string[] {
  const configured = process.env.PRIVATE_INFLUENCER_EMAILS
    ?.split(",")
    .map((email) => email.trim().toLocaleLowerCase("de-DE"))
    .filter(Boolean);

  return configured?.length
    ? configured
    : ["info@kivideostudio.de"];
}

export function hasPrivateInfluencerAccess(email: string | null | undefined) {
  const normalized = email?.trim().toLocaleLowerCase("de-DE");
  return Boolean(normalized && configuredOwnerEmails().includes(normalized));
}

export function privateInfluencerUploadPrefix(userId: string) {
  return `private-influencers/${userId}/`;
}

export function isOwnedInfluencerImagePath(userId: string, pathname: string) {
  return (
    pathname.startsWith(privateInfluencerUploadPrefix(userId)) &&
    !pathname.includes("..") &&
    pathname.length <= 320
  );
}

export const privateInfluencerStore = {
  async get(userId: string): Promise<PrivateInfluencerProfile | null> {
    if (redis) {
      return (
        (await redis.get<PrivateInfluencerProfile>(profileKey(userId))) ?? null
      );
    }

    return memoryProfiles.get(userId) ?? null;
  },

  async set(userId: string, profile: PrivateInfluencerProfile): Promise<void> {
    if (redis) {
      await redis.set(profileKey(userId), profile);
      return;
    }

    memoryProfiles.set(userId, profile);
  },

  async setImage(
    userId: string,
    pathname: string,
    image: PrivateInfluencerStoredImage,
  ): Promise<void> {
    if (!isOwnedInfluencerImagePath(userId, pathname)) {
      throw new Error("Der Speicherpfad des Referenzbildes ist ungültig.");
    }

    if (redis) {
      await redis.set(imageKey(pathname), image);
      return;
    }

    memoryImages.set(imageKey(pathname), image);
  },

  async getImage(
    userId: string,
    pathname: string,
  ): Promise<PrivateInfluencerStoredImage | null> {
    if (!isOwnedInfluencerImagePath(userId, pathname)) return null;

    if (redis) {
      return (
        (await redis.get<PrivateInfluencerStoredImage>(imageKey(pathname))) ?? null
      );
    }

    return memoryImages.get(imageKey(pathname)) ?? null;
  },

  async deleteImage(userId: string, pathname: string): Promise<void> {
    if (!isOwnedInfluencerImagePath(userId, pathname)) return;

    if (redis) {
      await redis.del(imageKey(pathname));
      return;
    }

    memoryImages.delete(imageKey(pathname));
  },
};
