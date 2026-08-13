import { googleSignInPath } from "./google-auth";
import { TournamentApp } from "./tournament-app";

export const dynamic = "force-dynamic";

const TABS = ["home", "schedule", "standings", "bracket", "teams", "stats", "draft", "players", "points", "admin"] as const;

export default async function Home({ searchParams }: { searchParams: Promise<{ tournament?: string; tab?: string; player?: string; match?: string }> }) {
  const query = await searchParams;
  const tab = TABS.find((candidate) => candidate === query.tab) ?? "home";
  const returnQuery = new URLSearchParams();
  if (query.tournament) returnQuery.set("tournament", query.tournament);
  if (tab !== "home") returnQuery.set("tab", tab);
  if (query.player) returnQuery.set("player", query.player);
  if (query.match) returnQuery.set("match", query.match);
  const returnTo = returnQuery.size ? `/?${returnQuery}` : "/";
  return <TournamentApp signInPath={googleSignInPath(returnTo)} initialTournamentId={query.tournament ?? ""} initialPlayerId={query.player ?? null} initialMatchId={query.match ?? null} initialTab={tab} />;
}
