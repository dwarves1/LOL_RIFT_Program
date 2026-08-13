type ChampionCatalogEntry = {
  id: string;
  name: string;
  imageUrl?: string;
};

function normalizedChampionLabel(value: string) {
  return value.trim().normalize("NFKC").replace(/[\s.'’_-]+/g, "").toLocaleLowerCase("ko-KR");
}

export function isJadeChampion(champion: ChampionCatalogEntry) {
  return /jade/i.test(`${champion.id} ${champion.imageUrl ?? ""}`);
}

export function currentUniqueChampions<T extends ChampionCatalogEntry>(champions: T[]) {
  const uniqueByName = new Map<string, T>();
  for (const champion of champions) {
    if (isJadeChampion(champion)) continue;
    const nameKey = champion.name.trim().normalize("NFKC").toLocaleLowerCase("ko-KR");
    if (!uniqueByName.has(nameKey)) uniqueByName.set(nameKey, champion);
  }
  return [...uniqueByName.values()];
}

export function officialKoreanChampionName(value: string, champions: ChampionCatalogEntry[]) {
  const normalized = normalizedChampionLabel(value);
  if (!normalized) return null;
  const exact = champions.find((champion) =>
    normalizedChampionLabel(champion.name) === normalized || normalizedChampionLabel(champion.id) === normalized
  );
  return exact?.name.trim() ?? null;
}

export function isKoreanChampionName(value: string) {
  return /[가-힣]/.test(value.trim());
}
