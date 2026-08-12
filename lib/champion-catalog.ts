type ChampionCatalogEntry = {
  id: string;
  name: string;
  imageUrl?: string;
};

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
