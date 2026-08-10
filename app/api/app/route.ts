import {
  createBet,
  createBracket,
  createTournament,
  confirmMatchSchedule,
  getDashboard,
  getRequestUser,
  setMatchWinner,
  setMatchSchedule,
  setUserRole,
  type CreateTournamentInput,
  type UserRole,
} from "../../../lib/tournament-service";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
  return Response.json({ error: message }, { status: 400 });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const user = await getRequestUser(request);
    const data = await getDashboard(url.searchParams.get("tournament"), user);
    return Response.json(data);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "로그인 후 이용할 수 있습니다." }, { status: 401 });
    }
    const payload = (await request.json()) as Record<string, unknown>;
    const action = String(payload.action ?? "");

    if (action === "create_tournament") {
      const tournamentId = await createTournament(payload.input as CreateTournamentInput, user);
      return Response.json({ ok: true, tournamentId });
    }
    if (action === "create_bracket") {
      await createBracket(
        String(payload.tournamentId),
        Array.isArray(payload.seedOrder) ? payload.seedOrder.map(String) : [],
        user,
      );
      return Response.json({ ok: true });
    }
    if (action === "set_winner") {
      await setMatchWinner(String(payload.matchId), String(payload.winnerId), user);
      return Response.json({ ok: true });
    }
    if (action === "set_match_schedule") {
      await setMatchSchedule(String(payload.matchId), String(payload.scheduledAt), user);
      return Response.json({ ok: true });
    }
    if (action === "confirm_match_schedule") {
      await confirmMatchSchedule(String(payload.matchId), user);
      return Response.json({ ok: true });
    }
    if (action === "create_bet") {
      await createBet(
        String(payload.tournamentId),
        String(payload.matchId),
        String(payload.teamId),
        Number(payload.stake),
        user,
      );
      return Response.json({ ok: true });
    }
    if (action === "set_role") {
      await setUserRole(String(payload.userId), String(payload.role) as UserRole, user);
      return Response.json({ ok: true });
    }
    return Response.json({ error: "알 수 없는 요청입니다." }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
