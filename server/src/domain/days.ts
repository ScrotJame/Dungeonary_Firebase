const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

function dayToMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

/** Ngày UTC dạng yyyy-MM-dd của một thời điểm tính bằng ms từ epoch. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isValidDay(v: unknown): v is string {
  if (typeof v !== "string" || !DAY_RE.test(v)) return false;
  const ms = dayToMs(v);
  return !Number.isNaN(ms) && utcDay(ms) === v;
}

/** Số ngày của `a` trừ `b`. Dương khi `a` sau `b`. */
export function dayDiff(a: string, b: string): number {
  return Math.round((dayToMs(a) - dayToMs(b)) / MS_PER_DAY);
}

export function addDays(day: string, n: number): string {
  return utcDay(dayToMs(day) + n * MS_PER_DAY);
}
