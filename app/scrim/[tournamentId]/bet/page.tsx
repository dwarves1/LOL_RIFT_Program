import { googleSignInPath } from "../../../google-auth";
import { TournamentApp } from "../../../tournament-app";

export const dynamic = "force-dynamic";

export default async function ScrimBetPage({ params }: { params: Promise<{ tournamentId: string }> }) {
  const { tournamentId } = await params;
  const path = `/scrim/${encodeURIComponent(tournamentId)}/bet`;
  return <TournamentApp signInPath={googleSignInPath(path)} initialTournamentId={tournamentId} initialTab="points" />;
}
