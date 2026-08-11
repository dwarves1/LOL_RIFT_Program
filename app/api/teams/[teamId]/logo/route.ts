import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../../../db";
import { teams } from "../../../../../db/schema";
import { getRequestUser, hasTournamentAccess } from "../../../../../lib/tournament-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ teamId: string }> },
) {
  await ensureSchema();
  const { teamId } = await context.params;
  const [team] = await getDb().select({
    tournamentId: teams.tournamentId,
    objectKey: teams.logoObjectKey,
  }).from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team || !team.objectKey || !(await hasTournamentAccess(await getRequestUser(request), team.tournamentId))) {
    return new Response("Not found", { status: 404 });
  }
  const object = await env.RESULT_IMAGES.get(team.objectKey);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, max-age=3600");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}
