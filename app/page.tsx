import { googleSignInPath } from "./google-auth";
import { TournamentApp } from "./tournament-app";

export const dynamic = "force-dynamic";

export default function Home() {
  return <TournamentApp signInPath={googleSignInPath("/")} />;
}
