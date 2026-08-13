import { exportTournamentCsv, getRequestUser } from "../../../../lib/tournament-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await getRequestUser(request);
    if (!actor) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
    const tournamentId = new URL(request.url).searchParams.get("tournament") ?? "";
    const csv = await exportTournamentCsv(tournamentId, actor);
    const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="lolrift-backup-${date}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "CSV 백업을 만들지 못했습니다." }, { status: 400 });
  }
}
