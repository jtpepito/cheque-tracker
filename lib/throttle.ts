/** Counts failures per key and blocks the key once it reaches `max` inside `windowMs`. */
export function createThrottle(max: number, windowMs: number) {
  const failures = new Map<string, number[]>();
  const recent = (key: string, now: number) => (failures.get(key) ?? []).filter((t) => now - t < windowMs);
  return {
    blocked: (key: string, now = Date.now()) => recent(key, now).length >= max,
    fail(key: string, now = Date.now()) {
      failures.set(key, [...recent(key, now), now]);
    },
    reset(key: string) {
      failures.delete(key);
    },
  };
}
