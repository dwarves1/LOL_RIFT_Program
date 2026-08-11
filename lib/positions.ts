export const PLAYER_POSITIONS = ["TOP", "JGL", "MID", "ADC", "SUP"] as const;

export type PlayerPosition = typeof PLAYER_POSITIONS[number];

export function positionLabel(position: string, compact = false) {
  if (position === "ADC") return compact ? "ADC" : "AD CARRY";
  return position;
}
