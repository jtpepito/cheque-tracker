/**
 * Tags each response with whether it is still the latest request started. A slow earlier
 * response that lands after a newer one is marked stale so it cannot overwrite newer data.
 */
export function latestOnly() {
  let seq = 0;
  return async <T>(pending: Promise<T>): Promise<{ fresh: boolean; value: T }> => {
    const mine = ++seq;
    const value = await pending;
    return { fresh: mine === seq, value };
  };
}
