/** Browser-side fetch helper for the JSON routes. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public errors?: Record<string, string>,
  ) {
    super(message);
  }
}

export async function api<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      cache: "no-store",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Can't reach the server. Check the connection and try again.", 0);
  }
  if (res.status === 401) {
    window.location.href = "/login";
    throw new ApiError("Session expired. Sign in again.", 401);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; errors?: Record<string, string> };
  if (!res.ok) throw new ApiError(data.error ?? "Something went wrong. Try again.", res.status, data.errors);
  return data as T;
}
