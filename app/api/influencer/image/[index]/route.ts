import { get } from "@vercel/blob";

import {
  hasPrivateInfluencerAccess,
  privateInfluencerStore,
} from "@/lib/private-influencer";
import { getCurrentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: { index: string } },
) {
  const user = await getCurrentUser();
  if (!user || !hasPrivateInfluencerAccess(user.email)) {
    return Response.json({ error: "Bild nicht gefunden." }, { status: 404 });
  }

  const index = Number(context.params.index);
  if (!Number.isInteger(index) || index < 0 || index > 2) {
    return Response.json({ error: "Bild nicht gefunden." }, { status: 404 });
  }

  const profile = await privateInfluencerStore.get(user.id);
  const image = profile?.images[index];
  if (!image) return Response.json({ error: "Bild nicht gefunden." }, { status: 404 });

  const result = await get(image.pathname, { access: "private" });
  if (!result?.stream) return Response.json({ error: "Bild nicht gefunden." }, { status: 404 });

  const headers = new Headers({
    "Content-Type": result.headers.get("content-type") || image.mimeType,
    "Cache-Control": "private, no-store",
    "Content-Disposition": 'inline; filename="ki-influencer-referenz.jpg"',
  });
  const length = result.headers.get("content-length");
  if (length) headers.set("Content-Length", length);

  return new Response(result.stream, { headers });
}
