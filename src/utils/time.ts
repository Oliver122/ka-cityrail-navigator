/** When countdown exceeds this value (minutes) show real_time instead of "N min". */
export const MAX_COUNTDOWN_DISPLAY_MIN = 20;

export function formatCountdown(
  countdown: number,
  realTime: string,
): { text: string; className: string } {
  if (countdown <= 0) return { text: "now", className: "eta-now" };
  if (countdown <= MAX_COUNTDOWN_DISPLAY_MIN) {
    return { text: `${countdown} min`, className: "eta-soon" };
  }
  return { text: realTime, className: "eta-later" };
}

export function kvDateTimeToDisplay(value: string): string {
  const parts = value.split(" ");
  if (parts.length < 2) return "";
  return parts[1].slice(0, 5);
}
