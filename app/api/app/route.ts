import {
  createBet,
  createBracket,
  createTournament,
  confirmMatchSchedule,
  getDashboard,
  getRequestUser,
  setMatchWinner,
  setMatchSchedule,
  saveMatchResult,
  setUserRole,
  updateUserProfile,
  type CreateTournamentInput,
  type SaveMatchResultInput,
  type UserRole,
} from "../../../lib/tournament-service";
import { env } from "cloudflare:workers";

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

    if (action === "update_profile") {
      await updateUserProfile({
        realName: String(payload.realName ?? ""),
        riotGameName: String(payload.riotGameName ?? ""),
        riotTagline: String(payload.riotTagline ?? ""),
      }, user);
      return Response.json({ ok: true });
    }
    if (!user.profileComplete) {
      return Response.json({ error: "본계정과 실명 프로필을 먼저 설정해 주세요." }, { status: 403 });
    }

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
    if (action === "save_match_result") {
      if (user.role === "viewer") {
        return Response.json({ error: "운영 권한이 필요합니다." }, { status: 403 });
      }
      const input = payload.input as Record<string, unknown>;
      const image = input.image as Record<string, unknown>;
      const dataUrl = String(image.dataUrl ?? "");
      const matched = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
      if (!matched) throw new Error("PNG, JPG 또는 WebP 이미지를 선택해 주세요.");
      const bytes = Uint8Array.from(atob(matched[2]), (character) => character.charCodeAt(0));
      if (bytes.byteLength > 10 * 1024 * 1024) throw new Error("이미지는 10MB 이하로 올려 주세요.");
      const matchId = String(input.matchId ?? "");
      const extension = matched[1] === "image/png" ? "png" : matched[1] === "image/webp" ? "webp" : "jpg";
      const objectKey = `match-results/${matchId}/${crypto.randomUUID()}.${extension}`;
      await env.RESULT_IMAGES.put(objectKey, bytes, {
        httpMetadata: { contentType: matched[1], cacheControl: "public, max-age=31536000, immutable" },
        customMetadata: { matchId, uploadedBy: user.id },
      });
      try {
        const result = await saveMatchResult({
          ...(input as unknown as Omit<SaveMatchResultInput, "image">),
          image: {
            objectKey,
            fileName: String(image.fileName ?? `result.${extension}`),
            contentType: matched[1],
            fileSize: bytes.byteLength,
            width: Number(image.width ?? 0) || null,
            height: Number(image.height ?? 0) || null,
          },
        }, user);
        if (result.previousObjectKey && result.previousObjectKey !== objectKey) {
          await env.RESULT_IMAGES.delete(result.previousObjectKey);
        }
      } catch (error) {
        await env.RESULT_IMAGES.delete(objectKey);
        throw error;
      }
      return Response.json({ ok: true });
    }
    return Response.json({ error: "알 수 없는 요청입니다." }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
