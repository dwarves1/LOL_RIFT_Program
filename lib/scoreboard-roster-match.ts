export type ScoreboardImageIdentity = {
  imageSide: 1 | 2;
  imageRow: number;
  accountName: string;
};

export type ScoreboardRosterCandidate = {
  id: string;
  teamSide: 1 | 2;
  labels: string[];
};

export type ScoreboardIdentityMatch = {
  detectedIndex: number;
  rosterIndex: number | null;
  confidence: number;
  status: "exact" | "fuzzy" | "inferred" | "unmatched";
};

export type ScoreboardRosterMatch = {
  assignments: ScoreboardIdentityMatch[];
  topTeamSide: 1 | 2 | null;
  teamMappingConfidence: number;
};

function normalized(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/＃/g, "#").replace(/\s+/g, " ");
}

function compact(value: string) {
  return normalized(value).replace(/[^\p{L}\p{N}]/gu, "");
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

export function scoreboardAccountSimilarity(input: string, candidate: string) {
  const strictInput = normalized(input);
  const strictCandidate = normalized(candidate);
  if (!strictInput || !strictCandidate) return 0;
  if (strictInput === strictCandidate) return 1;

  const compactInput = compact(strictInput);
  const compactCandidate = compact(strictCandidate);
  if (!compactInput || !compactCandidate) return 0;
  if (compactInput === compactCandidate) return 0.98;

  const distanceScore = 1 - editDistance(compactInput, compactCandidate) / Math.max(compactInput.length, compactCandidate.length);
  const shorter = compactInput.length <= compactCandidate.length ? compactInput : compactCandidate;
  const longer = compactInput.length > compactCandidate.length ? compactInput : compactCandidate;
  const containmentScore = shorter.length >= 4 && longer.includes(shorter)
    ? 0.72 + 0.18 * (shorter.length / longer.length)
    : 0;
  return Math.max(0, Math.min(1, distanceScore, 1), containmentScore);
}

function candidateScore(row: ScoreboardImageIdentity, candidate: ScoreboardRosterCandidate) {
  return candidate.labels.reduce((best, label) => Math.max(best, scoreboardAccountSimilarity(row.accountName, label)), 0);
}

function maximumAssignments(
  rows: ScoreboardImageIdentity[],
  roster: ScoreboardRosterCandidate[],
  allowed?: (row: ScoreboardImageIdentity, candidate: ScoreboardRosterCandidate) => boolean,
) {
  const scores = rows.map((row) => roster.map((candidate) => allowed?.(row, candidate) === false ? -1 : candidateScore(row, candidate)));
  const memo = new Map<string, { total: number; picks: number[] }>();
  const solve = (rowIndex: number, mask: number): { total: number; picks: number[] } => {
    if (rowIndex >= rows.length) return { total: 0, picks: [] };
    const key = `${rowIndex}:${mask}`;
    const cached = memo.get(key);
    if (cached) return cached;
    let best = solve(rowIndex + 1, mask);
    best = { total: best.total, picks: [-1, ...best.picks] };
    for (let rosterIndex = 0; rosterIndex < roster.length; rosterIndex += 1) {
      if ((mask & (1 << rosterIndex)) !== 0 || scores[rowIndex][rosterIndex] < 0) continue;
      const next = solve(rowIndex + 1, mask | (1 << rosterIndex));
      const total = scores[rowIndex][rosterIndex] + next.total;
      if (total > best.total) best = { total, picks: [rosterIndex, ...next.picks] };
    }
    memo.set(key, best);
    return best;
  };
  const picks = solve(0, 0).picks;
  return picks.map((rosterIndex, detectedIndex) => ({
    detectedIndex,
    rosterIndex: rosterIndex >= 0 ? rosterIndex : null,
    score: rosterIndex >= 0 ? scores[detectedIndex][rosterIndex] : 0,
  }));
}

function resolveTeamMapping(
  rows: ScoreboardImageIdentity[],
  roster: ScoreboardRosterCandidate[],
  preliminary: Array<{ detectedIndex: number; rosterIndex: number | null; score: number }>,
) {
  let normal = 0;
  let swapped = 0;
  let reliable = 0;
  for (const assignment of preliminary) {
    if (assignment.rosterIndex === null || assignment.score < 0.62) continue;
    reliable += 1;
    const row = rows[assignment.detectedIndex];
    const candidate = roster[assignment.rosterIndex];
    if (row.imageSide === candidate.teamSide) normal += assignment.score;
    else swapped += assignment.score;
  }
  if (reliable < 2 || Math.abs(normal - swapped) < 0.5) {
    return { topTeamSide: null as 1 | 2 | null, confidence: 0 };
  }
  const topTeamSide = (normal > swapped ? 1 : 2) as 1 | 2;
  const confidence = Math.round(100 * Math.max(normal, swapped) / Math.max(0.01, normal + swapped));
  return { topTeamSide, confidence };
}

export function matchScoreboardRoster(
  rows: ScoreboardImageIdentity[],
  roster: ScoreboardRosterCandidate[],
): ScoreboardRosterMatch {
  const preliminary = maximumAssignments(rows, roster);
  const mapping = resolveTeamMapping(rows, roster, preliminary);
  const restricted = mapping.topTeamSide
    ? maximumAssignments(rows, roster, (row, candidate) => {
      const expectedSide = row.imageSide === 1 ? mapping.topTeamSide : (mapping.topTeamSide === 1 ? 2 : 1);
      return candidate.teamSide === expectedSide;
    })
    : preliminary;

  const assignments: ScoreboardIdentityMatch[] = restricted.map((assignment) => {
    if (assignment.rosterIndex === null || assignment.score < 0.62) {
      return { detectedIndex: assignment.detectedIndex, rosterIndex: null, confidence: 0, status: "unmatched" };
    }
    return {
      detectedIndex: assignment.detectedIndex,
      rosterIndex: assignment.rosterIndex,
      confidence: Math.round(assignment.score * 100),
      status: assignment.score >= 0.97 ? "exact" : "fuzzy",
    };
  });

  if (mapping.topTeamSide) {
    for (const imageSide of [1, 2] as const) {
      const expectedTeamSide = imageSide === 1 ? mapping.topTeamSide : (mapping.topTeamSide === 1 ? 2 : 1);
      const unresolved = assignments.filter((assignment) => rows[assignment.detectedIndex].imageSide === imageSide && assignment.rosterIndex === null);
      const used = new Set(assignments.flatMap((assignment) => assignment.rosterIndex === null ? [] : [assignment.rosterIndex]));
      const remainingRoster = roster
        .map((candidate, rosterIndex) => ({ candidate, rosterIndex }))
        .filter(({ candidate, rosterIndex }) => candidate.teamSide === expectedTeamSide && !used.has(rosterIndex));
      if (unresolved.length === 1 && remainingRoster.length === 1) {
        unresolved[0].rosterIndex = remainingRoster[0].rosterIndex;
        unresolved[0].confidence = 50;
        unresolved[0].status = "inferred";
      }
    }
  }

  return {
    assignments,
    topTeamSide: mapping.topTeamSide,
    teamMappingConfidence: mapping.confidence,
  };
}
