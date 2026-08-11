import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../../../db";
import { matchResultImages, matches } from "../../../../../db/schema";
import { getRequestUser, hasTournamentAccess } from "../../../../../lib/tournament-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ matchId: string }> },
) {
  await ensureSchema();
  const { matchId } = await context.params;
  const setNo = Math.max(1, Number(new URL(request.url).searchParams.get("set") ?? 1));
  const [match] = await getDb().select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (!match || !(await hasTournamentAccess(await getRequestUser(request), match.tournamentId))) {
    return new Response("Forbidden", { status: 403 });
  }
  const [image] = await getDb()
    .select({ objectKey: matchResultImages.objectKey })
    .from(matchResultImages)
    .where(and(eq(matchResultImages.matchId, matchId), eq(matchResultImages.setNo, setNo)))
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
