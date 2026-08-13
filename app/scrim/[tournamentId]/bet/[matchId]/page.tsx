import { googleSignInPath } from "../../../../google-auth";
import { TournamentApp } from "../../../../tournament-app";

export const dynamic = "force-dynamic";

export default async function ScrimMatchBetPage({ params }: { params: Promise<{ tournamentId: string; matchId: string }> }) {
  const { tournamentId, matchId } = await params;
  const path = `/scrim/${encodeURIComponent(tournamentId)}/bet/${encodeURIComponent(matchId)}`;
  return <TournamentApp signInPath={googleSignInPath(path)} initialTournamentId={tournamentId} initialMatchId={matchId} initialTab="points" />;
}
