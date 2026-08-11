import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../../../db";
import { matchResultImages } from "../../../../../db/schema";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ matchId: string }> },
) {
  await ensureSchema();
  const { matchId } = await context.params;
  const [image] = await getDb()
    .select({ objectKey: matchResultImages.objectKey })
    .from(matchResultImages)
    .where(eq(matchResultImages.matchId, matchId))
    .limit(1);
  if (!image) return new Response("Not found", { status: 404 });

  const object = await env.RESULT_IMAGES.get(image.objectKey);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=3600");
  return new Response(object.body, { headers });
}
