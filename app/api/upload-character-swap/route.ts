import { issueSignedToken } from '@vercel/blob';
import {
  handleUploadPresigned,
  type HandleUploadPresignedBody,
} from '@vercel/blob/client';

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/supabase/server';
import { getActiveVideoSubscription } from '@/lib/video-subscription';
import { hasOwnerAccess } from '@/lib/owner-access';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: 'Bitte melde dich an.' },
        { status: 401 }
      );
    }

    const owner = hasOwnerAccess(user);

    const subscription = owner
      ? null
      : await getActiveVideoSubscription(request).catch(() => null);

    if (!owner && !subscription) {
      return NextResponse.json(
        {
          error:
            'Für den Charaktertausch benötigst du ein Video-Abo.',
        },
        { status: 403 }
      );
    }

    const body =
      (await request.json()) as HandleUploadPresignedBody;

    if (body.type === 'blob.generate-presigned-url') {
      const rate = await checkRateLimit(
        request,
        'character-swap-upload',
        12,
        3600
      );

      if (!rate.allowed) {
        return NextResponse.json(
          {
            error:
              'Zu viele Uploads. Bitte später erneut versuchen.',
          },
          { status: 429 }
        );
      }
    }

    const result = await handleUploadPresigned({
      request,
      body,

      getSignedToken: async (pathname) => {
        if (
          !pathname.startsWith('character-swap/upload/') ||
          pathname.includes('..') ||
          pathname.length > 300
        ) {
          throw new Error('Ungültiger Uploadpfad.');
        }

        const image =
          pathname.includes('/reference-');

        const allowedContentTypes = image
          ? ['image/jpeg', 'image/png', 'image/webp']
          : ['video/mp4', 'video/quicktime'];

        const maximumSizeInBytes = image
          ? 5 * 1024 * 1024
          : 40 * 1024 * 1024;

        const validUntil =
          Date.now() + 15 * 60 * 1000;

        const token = await issueSignedToken({
          pathname,
          operations: ['put'],
          allowedContentTypes,
          maximumSizeInBytes,
          validUntil,
        });

        return {
          token,

          urlOptions: {
            allowedContentTypes,
            maximumSizeInBytes,
            validUntil,
            addRandomSuffix: true,
            tokenPayload: JSON.stringify({
              userId: user.id,
            }),
          },
        };
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error(
      'Character-Swap-Upload fehlgeschlagen:',
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Upload fehlgeschlagen.',
      },
      { status: 400 }
    );
  }
}