import { googleSignInPath } from "../../google-auth";
import { TournamentApp } from "../../tournament-app";

export const dynamic = "force-dynamic";

export default async function PlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ tournament?: string }>;
}) {
  const { userId } = await params;
  const { tournament = "" } = await searchParams;
  const path = `/players/${encodeURIComponent(userId)}${tournament ? `?tournament=${encodeURIComponent(tournament)}` : ""}`;
  return <TournamentApp signInPath={googleSignInPath(path)} initialTournamentId={tournament} initialPlayerId={userId} initialTab="players" />;
}
