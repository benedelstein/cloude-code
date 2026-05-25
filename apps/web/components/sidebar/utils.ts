const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

export function formatCompactRelativeTime(
  dateString: string,
  nowMs = Date.now(),
): string {
  const dateMs = new Date(dateString).getTime();
  if (!Number.isFinite(dateMs)) { return ""; }

  const diffMs = Math.max(0, nowMs - dateMs);
  if (diffMs < MINUTE_MS) {
    return `${Math.floor(diffMs / SECOND_MS)}s`;
  }
  if (diffMs < HOUR_MS) {
    return `${Math.floor(diffMs / MINUTE_MS)}m`;
  }
  if (diffMs < DAY_MS) {
    return `${Math.floor(diffMs / HOUR_MS)}h`;
  }
  if (diffMs < WEEK_MS) {
    return `${Math.floor(diffMs / DAY_MS)}d`;
  }
  if (diffMs < MONTH_MS) {
    return `${Math.floor(diffMs / WEEK_MS)}w`;
  }
  return `${Math.floor(diffMs / MONTH_MS)}mo`;
}
