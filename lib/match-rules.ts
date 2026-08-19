export const PREDICTION_LOCK_MS = 60 * 60 * 1000;

export function shouldSwapLeagueSides(meetingNumber: number) {
  return Number.isInteger(meetingNumber) && meetingNumber > 0 && meetingNumber % 2 === 0;
}

export function predictionClosesAt(scheduledAt: string) {
  return new Date(scheduledAt).getTime() - PREDICTION_LOCK_MS;
}

export function isPredictionOpen(scheduledAt: string, now = Date.now()) {
  const cutoff = predictionClosesAt(scheduledAt);
  return Number.isFinite(cutoff) && now < cutoff;
}

export function isUpcomingSchedule(scheduledAt: string, now = Date.now()) {
  const scheduledTime = new Date(scheduledAt).getTime();
  return Number.isFinite(scheduledTime) && scheduledTime > now;
}
