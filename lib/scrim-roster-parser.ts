export type ParsedScrimRosterPlayer = {
  team: 1 | 2;
  slot: number;
  realName: string;
  gameName: string;
  tagline: string | null;
  raw: string;
};

export type ParsedScrimRoster = {
  players: ParsedScrimRosterPlayer[];
  errors: string[];
};

export type ScrimRosterCandidate = {
  id: string;
  userId: string;
  realName: string | null;
  gameName: string;
  tagline: string | null;
};

export type ScrimRosterMatch = ParsedScrimRosterPlayer & {
  status: "matched" | "warning" | "ambiguous" | "unmatched";
  candidateId: string | null;
  candidateUserId: string | null;
  message: string;
};

function clean(value: string) {
  return value.trim().normalize("NFKC");
}

function normalizedRealName(value: string | null) {
  return clean(value ?? "").replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
}

function normalizedGameName(value: string) {
  return clean(value).replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
}

function normalizedTagline(value: string | null) {
  return clean(value ?? "").toLocaleUpperCase("en-US");
}

export function parseScrimRosterText(input: string): ParsedScrimRoster {
  const text = clean(input).replace(/^['"]|['"]$/g, "");
  const players: ParsedScrimRosterPlayer[] = [];
  const errors: string[] = [];
  const sections = [...text.matchAll(/(?:^|\n|\r|\s)([12])\s*팀\s*([\s\S]*?)(?=(?:\s+[12]\s*팀\s*)|$)/g)];

  if (sections.length !== 2 || new Set(sections.map((match) => match[1])).size !== 2) {
    return { players: [], errors: ["1팀과 2팀 구분을 모두 찾지 못했습니다."] };
  }

  for (const section of sections) {
    const team = Number(section[1]) as 1 | 2;
    const entries = section[2].split(/,|\n|\r/).map(clean).filter(Boolean);
    if (entries.length !== 5) errors.push(`${team}팀 선수가 ${entries.length}명입니다. 5명을 확인해 주세요.`);
    entries.forEach((raw, slot) => {
      const match = raw.match(/^([^()]+?)\s*\(\s*([^()]+?)\s*\)$/);
      if (!match) {
        errors.push(`${team}팀 ${slot + 1}번째 선수 형식을 확인해 주세요: ${raw}`);
        return;
      }
      const realName = clean(match[1]);
      const account = clean(match[2]);
      const hashIndex = account.lastIndexOf("#");
      const gameName = clean(hashIndex >= 0 ? account.slice(0, hashIndex) : account);
      const tagline = hashIndex >= 0 ? clean(account.slice(hashIndex + 1)).toLocaleUpperCase("en-US") : null;
      if (!realName || !gameName || (hashIndex >= 0 && !tagline)) {
        errors.push(`${team}팀 ${slot + 1}번째 선수의 이름 또는 계정명을 확인해 주세요.`);
        return;
      }
      players.push({ team, slot, realName, gameName, tagline, raw });
    });
  }

  if (players.length !== 10 && !errors.some((error) => error.includes("선수가"))) {
    errors.push("선수 10명을 모두 인식하지 못했습니다.");
  }
  return { players, errors };
}

export function matchScrimRosterPlayers(
  parsed: ParsedScrimRosterPlayer[],
  candidates: ScrimRosterCandidate[],
): ScrimRosterMatch[] {
  return parsed.map((player) => {
    const byRealName = candidates.filter((candidate) => normalizedRealName(candidate.realName) === normalizedRealName(player.realName));
    if (byRealName.length > 1) {
      return { ...player, status: "ambiguous", candidateId: null, candidateUserId: null, message: "동명이인이 있어 직접 선택해야 합니다." };
    }

    const exactAccount = candidates.filter((candidate) => (
      normalizedGameName(candidate.gameName) === normalizedGameName(player.gameName)
      && (!player.tagline || normalizedTagline(candidate.tagline) === normalizedTagline(player.tagline))
    ));
    const candidate = byRealName[0] ?? (exactAccount.length === 1 ? exactAccount[0] : null);
    if (!candidate) {
      return { ...player, status: "unmatched", candidateId: null, candidateUserId: null, message: "등록된 선수를 찾지 못했습니다." };
    }

    const nameMatches = normalizedRealName(candidate.realName) === normalizedRealName(player.realName);
    const gameMatches = normalizedGameName(candidate.gameName) === normalizedGameName(player.gameName);
    const tagMatches = !player.tagline || normalizedTagline(candidate.tagline) === normalizedTagline(player.tagline);
    if (nameMatches && gameMatches && tagMatches) {
      return { ...player, status: "matched", candidateId: candidate.id, candidateUserId: candidate.userId, message: player.tagline ? "본명과 본계정이 일치합니다." : "본명과 계정명이 일치합니다." };
    }
    return {
      ...player,
      status: "warning",
      candidateId: candidate.id,
      candidateUserId: candidate.userId,
      message: !nameMatches ? "본계정은 일치하지만 본명이 다릅니다." : !gameMatches ? "본명은 일치하지만 계정명이 다릅니다." : "본명과 계정명은 일치하지만 태그가 다릅니다.",
    };
  });
}
