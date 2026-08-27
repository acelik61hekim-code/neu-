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

  const storedImage = await privateInfluencerStore.getImage(
    user.id,
    image.pathname,
  );
  if (!storedImage) {
    return Response.json({ error: "Bild nicht gefunden." }, { status: 404 });
  }

  const imageBytes = Buffer.from(storedImage.dataBase64, "base64");

  const headers = new Headers({
    "Content-Type": storedImage.mimeType || image.mimeType,
    "Cache-Control": "private, no-store",
    "Content-Disposition": 'inline; filename="ki-influencer-referenz.jpg"',
    "Content-Length": String(imageBytes.byteLength),
  });

  return new Response(imageBytes, { headers });
}
