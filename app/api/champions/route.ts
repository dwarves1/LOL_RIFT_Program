export const dynamic = "force-dynamic";

let cached: { expiresAt: number; payload: unknown } | null = null;

export async function GET() {
  if (cached && cached.expiresAt > Date.now()) return Response.json(cached.payload);
  const versions = await fetch("https://ddragon.leagueoflegends.com/api/versions.json").then((response) => response.json()) as string[];
  const version = versions[0];
  const championData = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/ko_KR/champion.json`).then((response) => response.json()) as { data: Record<string, { id: string; key: string; name: string; image: { full: string } }> };
  const champions = [...new Map(Object.values(championData.data).map((champion) => [champion.id, {
    id: champion.id,
    key: champion.key,
    name: champion.name,
    imageUrl: `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${champion.image.full}`,
  }])).values()].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const payload = { version, champions };
  cached = { expiresAt: Date.now() + 6 * 60 * 60 * 1000, payload };
  return Response.json(payload, { headers: { "cache-control": "public, max-age=21600" } });
}
