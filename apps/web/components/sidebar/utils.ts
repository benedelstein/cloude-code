export function formatRelativeTime(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);

  const timeStr = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfDateDay = new Date(date);
  startOfDateDay.setHours(0, 0, 0, 0);

  const diffDays = Math.round(
    (startOfToday.getTime() - startOfDateDay.getTime()) / (24 * 60 * 60 * 1000)
  );

  if (diffDays === 0) return timeStr;
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
  });
}
