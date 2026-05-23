/**
 * Render a duration in milliseconds as a compact human-readable string.
 *  - "12s" for under a minute
 *  - "5m 15s" for under an hour
 *  - "1h 3m" for an hour or more
 */
export function humanizeDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) { return "0s"; }
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    const seconds = totalSeconds % 60;
    return `${totalMinutes}m ${seconds}s`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}
