import { chatGPTSignInPath } from "../../../../chatgpt-auth";
import { TournamentApp } from "../../../../tournament-app";

export const dynamic = "force-dynamic";

export default async function ScrimSummaryPage({ params }: { params: Promise<{ tournamentId: string; matchId: string }> }) {
  const { tournamentId, matchId } = await params;
  const path = `/scrim/${encodeURIComponent(tournamentId)}/match/${encodeURIComponent(matchId)}`;
  return <TournamentApp signInPath={chatGPTSignInPath(path)} initialTournamentId={tournamentId} initialMatchId={matchId} initialTab="schedule" />;
}
