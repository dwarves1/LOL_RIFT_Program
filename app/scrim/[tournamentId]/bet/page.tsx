import { googleSignInPath } from "../../../google-auth";
import { TournamentApp } from "../../../tournament-app";

export const dynamic = "force-dynamic";

export default async function ScrimBetPage({ params, searchParams }: { params: Promise<{ tournamentId: string }>; searchParams: Promise<{ match?: string }> }) {
  const { tournamentId } = await params;
  const { match } = await searchParams;
  const path = `/scrim/${encodeURIComponent(tournamentId)}/bet${match ? `?match=${encodeURIComponent(match)}` : ""}`;
  return <TournamentApp signInPath={googleSignInPath(path)} initialTournamentId={tournamentId} initialMatchId={match ?? null} initialTab="points" />;
}
