import { safeEqual } from "./session";

/** The sheet's script proves itself with "Authorization: Bearer <SYNC_KEY>". */
export function checkSyncKey(
  authorization: string | null,
  key: string | undefined = process.env.SYNC_KEY,
): "ok" | "unset" | "wrong" {
  if (!key || key.length < 32) return "unset";
  const sent = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  return sent && safeEqual(sent, key) ? "ok" : "wrong";
}
