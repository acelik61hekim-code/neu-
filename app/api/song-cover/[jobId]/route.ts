import { get } from "@vercel/blob";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { canAccessSong } from "@/lib/song-access";
import { resolveLocalSongPath } from "@/lib/song-generation";
import {
  getGeneratedSongVersion,
  songStore,
} from "@/lib/song-store";
import { getCurrentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function coverExtension(
  mimeType: string,
): string {
  if (mimeType.includes("png")) {
    return "png";
  }

  if (mimeType.includes("webp")) {
    return "webp";
  }

  if (mimeType.includes("avif")) {
    return "avif";
  }

  return "jpg";
}

export async function GET(
  request: Request,
  context: {
    params: {
      jobId: string;
    };
  },
) {
  const jobId =
    context.params.jobId
      ?.trim();

  const url =
    new URL(request.url);

  const sessionId =
    url.searchParams
      .get("session_id")
      ?.trim();

  const accessToken =
    url.searchParams
      .get("access_token")
      ?.trim();

  if (!jobId) {
    return Response.json(
      {
        error:
          "Der Songzugang fehlt.",
      },
      {
        status: 400,
      },
    );
  }

  const job =
    await songStore.get(
      jobId,
    );

  const user =
    await getCurrentUser();

  const accountOwner = Boolean(
    job?.userId &&
    user?.id &&
    job.userId === user.id,
  );

  if (
    !job ||
    (
      !canAccessSong(
        job,
        sessionId,
        accessToken,
      ) &&
      !accountOwner
    )
  ) {
    return Response.json(
      {
        error:
          "Songcover nicht gefunden.",
      },
      {
        status: 404,
      },
    );
  }

  const selected =
    getGeneratedSongVersion(
      job,
      url.searchParams.get(
        "version",
      ),
    );

  if (
    job.status !== "done" ||
    !selected?.version.imageUri
  ) {
    return Response.json(
      {
        error:
          "Für diese Songversion ist kein Cover verfügbar.",
      },
      {
        status: 404,
      },
    );
  }

  const mimeType =
    selected.version
      .imageMimeType ||
    "image/jpeg";

  const headers =
    new Headers({
      "Content-Type":
        mimeType,
      "Cache-Control":
        "private, no-store",
      "Content-Disposition":
        `inline; filename="ki-song-${jobId}-version-${selected.index + 1}.${coverExtension(mimeType)}"`,
    });

  if (
    selected.version.imageUri
      .startsWith(
        "local-song:",
      )
  ) {
    const filename =
      resolveLocalSongPath(
        selected.version
          .imageUri,
      );

    const file =
      await stat(filename);

    headers.set(
      "Content-Length",
      String(file.size),
    );

    return new Response(
      Readable.toWeb(
        createReadStream(
          filename,
        ),
      ) as ReadableStream<Uint8Array>,
      {
        headers,
      },
    );
  }

  if (
    !selected.version.imageUri
      .startsWith("blob:")
  ) {
    return Response.json(
      {
        error:
          "Ungültiges Songcover.",
      },
      {
        status: 500,
      },
    );
  }

  const result = await get(
    selected.version.imageUri
      .slice("blob:".length),
    {
      access: "private",
    },
  );

  if (!result?.stream) {
    return Response.json(
      {
        error:
          "Songcover nicht gefunden.",
      },
      {
        status: 404,
      },
    );
  }

  const length =
    result.headers.get(
      "content-length",
    );

  if (length) {
    headers.set(
      "Content-Length",
      length,
    );
  }

  return new Response(
    result.stream,
    {
      headers,
    },
  );
}
