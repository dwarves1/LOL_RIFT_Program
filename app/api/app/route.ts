import {
  createBet,
  createBracket,
  createTournament,
  createScrimSeason,
  createScrimMatch,
  confirmMatchSchedule,
  unconfirmMatchSchedule,
  seedTestPlayers,
  createQaScrimSandbox,
  resetQaScrimSandboxes,
  resetLolmen2026TestData,
  runPendingLolmen2026DeploymentCleanup,
  markLolmen2026ResultAssetsDeleted,
  createTiebreakerMatch,
  getDashboard,
  getMatchImageAnalysisContext,
  getRequestUser,
  setMatchWinner,
  setMatchSchedule,
  setMatchBestOf,
  saveMatchResult,
  setUserRole,
  setTeamLogo,
  clearTeamLogo,
  setTeamLeaders,
  savePreRegisteredPlayer,
  updateTournamentTeam,
  setScrimBetting,
  rollbackScrimMatch,
  deleteScrimMatch,
  removeTournamentMember,
  joinTournamentByCode,
  rotateTournamentCode,
  updateUserProfile,
  createTournamentBackup,
  reconcileBetSettlement,
  getTournamentBackupPayload,
  restoreTournamentBackupAsCopy,
  type CreateTournamentInput,
  type CreateScrimSeasonInput,
  type CreateScrimMatchInput,
  type SaveMatchResultInput,
  type TeamLogoInput,
  type PreRegisteredPlayerInput,
  type UpdateTournamentTeamInput,
  type UserRole,
} from "../../../lib/tournament-service";
import {
  advanceDraftSet,
  createDraft,
  deleteDraft,
  draftAction,
  joinDraft,
  renameDraft,
  resetDraft,
  resumeDraft,
  startDraft,
  undoDraft,
  type DraftMode,
  type DraftSide,
} from "../../../lib/draft-service";
import { analyzeScoreboardWithOpenAI, OPENAI_SCOREBOARD_MODEL } from "../../../lib/openai-scoreboard";
import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
  return Response.json({ error: message }, { status: 400 });
}

export async function GET(request: Request) {
  try {
    try {
      const cleanup = await runPendingLolmen2026DeploymentCleanup();
      if (cleanup) {
        for (const objectKey of cleanup.imageObjectKeys) await env.RESULT_IMAGES.delete(objectKey);
        await markLolmen2026ResultAssetsDeleted(cleanup.tournamentId);
      }
    } catch (cleanupError) {
      console.error("Pending 2026 lolmen cleanup will be retried", cleanupError instanceof Error ? cleanupError.message : "unknown error");
    }
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
      const result = await updateUserProfile({
        realName: String(payload.realName ?? ""),
        riotGameName: String(payload.riotGameName ?? ""),
        riotTagline: String(payload.riotTagline ?? ""),
        riotAccounts: Array.isArray(payload.riotAccounts) ? payload.riotAccounts.map((account) => {
          const item = account as Record<string, unknown>;
          return { id: item.id ? String(item.id) : undefined, gameName: String(item.gameName ?? ""), tagline: String(item.tagline ?? ""), isPrimary: Boolean(item.isPrimary) };
        }) : undefined,
      }, user);
      return Response.json({ ok: true, ...result });
    }
    if (!user.profileComplete) {
      return Response.json({ error: "본계정과 실명 프로필을 먼저 설정해 주세요." }, { status: 403 });
    }

    if (action === "analyze_match_image") {
      const imageDataUrl = String(payload.imageDataUrl ?? "");
      const matched = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(imageDataUrl);
      if (!matched) throw new Error("PNG, JPG 또는 WebP 이미지를 선택해 주세요.");
      const estimatedBytes = Math.floor(matched[2].length * 0.75);
      if (estimatedBytes > 10 * 1024 * 1024) throw new Error("이미지는 10MB 이하로 올려 주세요.");
      const context = await getMatchImageAnalysisContext(String(payload.matchId ?? ""), user);
      const runtimeEnv = env as unknown as { OPENAI_API_KEY?: string; OPENAI_SCOREBOARD_MODEL?: string };
      const apiKey = runtimeEnv.OPENAI_API_KEY?.trim();
      if (!apiKey) {
        return Response.json({ error: "AI 분석 키가 설정되지 않아 OCR로 분석합니다.", aiAvailable: false }, { status: 503 });
      }
      const model = runtimeEnv.OPENAI_SCOREBOARD_MODEL?.trim() || OPENAI_SCOREBOARD_MODEL;
      const analysis = await analyzeScoreboardWithOpenAI({ apiKey, imageDataUrl, context, model });
      console.info("Scoreboard analysis request completed", {
        model,
        providerLatencyMs: analysis.providerLatencyMs,
        analysisWidth: Number(payload.analysisWidth ?? 0) || null,
        analysisHeight: Number(payload.analysisHeight ?? 0) || null,
      });
      return Response.json({ ok: true, analysis, model, elapsedMs: analysis.providerLatencyMs });
    }

    if (action === "create_tournament") {
      const created = await createTournament(payload.input as CreateTournamentInput, user);
      return Response.json({ ok: true, ...created });
    }
    if (action === "create_scrim_season") {
      const created = await createScrimSeason(payload.input as CreateScrimSeasonInput, user);
      return Response.json({ ok: true, ...created });
    }
    if (action === "create_scrim_match") {
      const created = await createScrimMatch(payload.input as CreateScrimMatchInput, user);
      return Response.json({ ok: true, ...created });
    }
    if (action === "create_qa_scrim_sandbox") {
      const created = await createQaScrimSandbox(user);
      return Response.json({ ok: true, ...created });
    }
    if (action === "reset_qa_scrim_sandboxes") {
      const reset = await resetQaScrimSandboxes(user);
      for (const objectKey of reset.imageObjectKeys) await env.RESULT_IMAGES.delete(objectKey);
      return Response.json({ ok: true, tournamentId: "", ...reset });
    }
    if (action === "reset_lolmen_2026_test_data") {
      const reset = await resetLolmen2026TestData(String(payload.tournamentId ?? ""), user);
      for (const objectKey of reset.imageObjectKeys) await env.RESULT_IMAGES.delete(objectKey);
      return Response.json({ ok: true, ...reset, imageObjectKeys: undefined });
    }
    if (action === "set_scrim_betting") {
      const result = await setScrimBetting(
        String(payload.matchId ?? ""),
        payload.status === "closed" ? "closed" : "open",
        user,
      );
      return Response.json({ ok: true, ...result });
    }
    if (action === "rollback_scrim_match") {
      const result = await rollbackScrimMatch(String(payload.matchId ?? ""), user);
      for (const objectKey of result.imageObjectKeys) await env.RESULT_IMAGES.delete(objectKey);
      return Response.json({ ok: true });
    }
    if (action === "delete_scrim_match") {
      const result = await deleteScrimMatch(String(payload.matchId ?? ""), user);
      for (const objectKey of result.imageObjectKeys) await env.RESULT_IMAGES.delete(objectKey);
      return Response.json({ ok: true });
    }
    if (action === "create_tournament_backup") {
      const result = await createTournamentBackup(String(payload.tournamentId ?? ""), user, "manual", "운영자 수동 백업");
      return Response.json({ ok: true, backupId: result.id });
    }
    if (action === "reconcile_bet_settlement") {
      await reconcileBetSettlement(String(payload.matchId ?? ""), user);
      return Response.json({ ok: true });
    }
    if (action === "restore_tournament_backup") {
      const backupId = String(payload.backupId ?? "");
      const { payload: backupPayload } = await getTournamentBackupPayload(backupId, user);
      const imageRows = [...(backupPayload.tables.match_result_images ?? []), ...(backupPayload.tables.result_revisions ?? [])];
      const objectKeyMap: Record<string, string> = {};
      for (const row of imageRows) {
        const sourceKey = String(row.object_key ?? "");
        if (!sourceKey || objectKeyMap[sourceKey]) continue;
        const object = await env.RESULT_IMAGES.get(sourceKey);
        if (!object) throw new Error("복구에 필요한 결과 이미지를 찾을 수 없습니다.");
        const extension = sourceKey.split(".").at(-1)?.replace(/[^a-z0-9]/gi, "") || "png";
        const targetKey = `restored-results/${backupId}/${crypto.randomUUID()}.${extension}`;
        await env.RESULT_IMAGES.put(targetKey, object.body, {
          httpMetadata: { contentType: object.httpMetadata?.contentType ?? "image/png" },
          customMetadata: { restoredFrom: sourceKey, backupId, restoredBy: user.id },
        });
        objectKeyMap[sourceKey] = targetKey;
      }
      const restored = await restoreTournamentBackupAsCopy(backupId, objectKeyMap, user);
      return Response.json({ ok: true, ...restored });
    }
    if (action === "join_tournament") {
      const tournamentId = await joinTournamentByCode(String(payload.code ?? ""), user);
      return Response.json({ ok: true, tournamentId });
    }
    if (action === "rotate_tournament_code") {
      const accessCode = await rotateTournamentCode(String(payload.tournamentId), user);
      return Response.json({ ok: true, accessCode });
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
    if (action === "unconfirm_match_schedule") {
      const result = await unconfirmMatchSchedule(String(payload.matchId), user);
      return Response.json({ ok: true, ...result });
    }
    if (action === "seed_test_players") {
      const result = await seedTestPlayers(user);
      return Response.json({ ok: true, ...result });
    }
    if (action === "save_pre_registered_player") {
      const input = payload.input as Record<string, unknown>;
      const result = await savePreRegisteredPlayer({
        tournamentId: String(input.tournamentId ?? ""),
        userId: input.userId ? String(input.userId) : undefined,
        realName: String(input.realName ?? ""),
        gameName: String(input.gameName ?? ""),
        tagline: String(input.tagline ?? ""),
      } satisfies PreRegisteredPlayerInput, user);
      return Response.json({ ok: true, ...result });
    }
    if (action === "update_tournament_team") {
      const input = payload.input as Record<string, unknown>;
      const result = await updateTournamentTeam({
        teamId: String(input.teamId ?? ""),
        name: String(input.name ?? ""),
        members: Array.isArray(input.members) ? input.members.map((member) => {
          const item = member as Record<string, unknown>;
          const role = String(item.teamRole ?? "member");
          return {
            riotAccountId: String(item.riotAccountId ?? ""),
            teamRole: role === "captain" || role === "vice_captain" ? role : "member",
          };
        }) : [],
      } satisfies UpdateTournamentTeamInput, user);
      return Response.json({ ok: true, ...result });
    }
    if (action === "set_match_best_of") {
      await setMatchBestOf(String(payload.matchId), Number(payload.bestOf), user);
      return Response.json({ ok: true });
    }
    if (action === "create_tiebreaker") {
      await createTiebreakerMatch(String(payload.tournamentId), String(payload.teamAId), String(payload.teamBId), String(payload.scheduledAt), Number(payload.bestOf), user);
      return Response.json({ ok: true });
    }
    if (action === "create_draft") {
      const draftId = await createDraft({
        context: payload.context === "practice" ? "practice" : "match",
        matchId: payload.matchId ? String(payload.matchId) : undefined,
        name: payload.name ? String(payload.name) : undefined,
        mode: String(payload.mode) as DraftMode,
        bestOf: Number(payload.bestOf),
        timerMode: payload.timerMode === "unlimited" ? "unlimited" : "limited",
        timerSeconds: Number(payload.timerSeconds ?? 30),
        undoEnabled: Boolean(payload.undoEnabled),
      }, user);
      return Response.json({ ok: true, draftId });
    }
    if (action === "join_draft") { await joinDraft(String(payload.draftId), String(payload.side) as DraftSide, user); return Response.json({ ok: true }); }
    if (action === "start_draft") { await startDraft(String(payload.draftId), user); return Response.json({ ok: true }); }
    if (action === "draft_action") { await draftAction(String(payload.draftId), String(payload.championId), Number(payload.version), user); return Response.json({ ok: true }); }
    if (action === "undo_draft") { await undoDraft(String(payload.draftId), user); return Response.json({ ok: true }); }
    if (action === "advance_draft_set") { await advanceDraftSet(String(payload.draftId), user); return Response.json({ ok: true }); }
    if (action === "reset_draft") { await resetDraft(String(payload.draftId), user); return Response.json({ ok: true }); }
    if (action === "resume_draft") { await resumeDraft(String(payload.draftId), user); return Response.json({ ok: true }); }
    if (action === "rename_draft") { await renameDraft(String(payload.draftId), String(payload.name), user); return Response.json({ ok: true }); }
    if (action === "delete_draft") { await deleteDraft(String(payload.draftId), user); return Response.json({ ok: true }); }
    if (action === "upload_team_logo") {
      const teamId = String(payload.teamId ?? "");
      const image = payload.image as Record<string, unknown>;
      const dataUrl = String(image?.dataUrl ?? "");
      const matched = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
      if (!matched) throw new Error("PNG, JPG 또는 WebP 이미지를 선택해 주세요.");
      const bytes = Uint8Array.from(atob(matched[2]), (character) => character.charCodeAt(0));
      if (bytes.byteLength > 2 * 1024 * 1024) throw new Error("팀 로고는 2MB 이하로 올려 주세요.");
      const extension = matched[1] === "image/png" ? "png" : matched[1] === "image/webp" ? "webp" : "jpg";
      const objectKey = `team-logos/${teamId}/${crypto.randomUUID()}.${extension}`;
      await env.RESULT_IMAGES.put(objectKey, bytes, {
        httpMetadata: { contentType: matched[1], cacheControl: "public, max-age=31536000, immutable" },
        customMetadata: { teamId, uploadedBy: user.id },
      });
      try {
        const result = await setTeamLogo(teamId, {
          objectKey,
          fileName: String(image.fileName ?? `logo.${extension}`),
          contentType: matched[1],
          fileSize: bytes.byteLength,
          width: Number(image.width ?? 0) || null,
          height: Number(image.height ?? 0) || null,
        } satisfies TeamLogoInput, user);
        if (result.previousObjectKey && result.previousObjectKey !== objectKey) await env.RESULT_IMAGES.delete(result.previousObjectKey);
      } catch (error) {
        await env.RESULT_IMAGES.delete(objectKey);
        throw error;
      }
      return Response.json({ ok: true });
    }
    if (action === "clear_team_logo") {
      const previousObjectKey = await clearTeamLogo(String(payload.teamId ?? ""), user);
      if (previousObjectKey) await env.RESULT_IMAGES.delete(previousObjectKey);
      return Response.json({ ok: true });
    }
    if (action === "set_team_leaders") {
      await setTeamLeaders(
        String(payload.teamId ?? ""),
        String(payload.captainUserId ?? ""),
        payload.viceCaptainUserId ? String(payload.viceCaptainUserId) : null,
        user,
      );
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
    if (action === "remove_tournament_member") {
      const result = await removeTournamentMember(String(payload.tournamentId ?? ""), String(payload.userId ?? ""), user);
      return Response.json({ ok: true, ...result });
    }
    if (action === "save_match_result") {
      const input = payload.input as Record<string, unknown>;
      const image = input.image as Record<string, unknown>;
      const dataUrl = String(image.dataUrl ?? "");
      const matched = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
      if (!matched) throw new Error("PNG, JPG 또는 WebP 이미지를 선택해 주세요.");
      const bytes = Uint8Array.from(atob(matched[2]), (character) => character.charCodeAt(0));
      if (bytes.byteLength > 10 * 1024 * 1024) throw new Error("이미지는 10MB 이하로 올려 주세요.");
      const imageHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      const matchId = String(input.matchId ?? "");
      const extension = matched[1] === "image/png" ? "png" : matched[1] === "image/webp" ? "webp" : "jpg";
      const setNo = Math.max(1, Number(input.setNo ?? 1));
      const objectKey = `match-results/${matchId}/set-${setNo}/${crypto.randomUUID()}.${extension}`;
      await env.RESULT_IMAGES.put(objectKey, bytes, {
        httpMetadata: { contentType: matched[1], cacheControl: "public, max-age=31536000, immutable" },
        customMetadata: { matchId, uploadedBy: user.id },
      });
      try {
        await saveMatchResult({
          ...(input as unknown as Omit<SaveMatchResultInput, "image">),
          image: {
            objectKey,
            imageHash,
            fileName: String(image.fileName ?? `result.${extension}`),
            contentType: matched[1],
            fileSize: bytes.byteLength,
            width: Number(image.width ?? 0) || null,
            height: Number(image.height ?? 0) || null,
          },
        }, user);
        // 정정 전 이미지는 결과 수정 이력에서 복구할 수 있도록 보존합니다.
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
