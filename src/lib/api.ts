import type { Category, Classification } from "../core/types";

// Base URL of the API server. Empty on the website (same origin); a native build sets
// VITE_API_URL to the deployed server.
const API = import.meta.env.VITE_API_URL ?? "";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
  get retryable() {
    return this.status === 429 || this.status >= 500 || this.status === 0;
  }
}

export async function aiAvailable(): Promise<boolean> {
  try {
    const r = await fetch(`${API}/api/health`);
    return r.ok && (await r.json()).ai === true;
  } catch {
    return false;
  }
}

export async function classify(input: {
  image: string;
  mediaType: "image/jpeg";
  fileName: string;
  width: number;
  height: number;
  categories: Category[];
}): Promise<Classification> {
  let r: Response;
  try {
    r = await fetch(`${API}/api/classify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...input,
        categories: input.categories.map((c) => ({ section: c.section, name: c.name })),
      }),
    });
  } catch {
    throw new ApiError("Could not reach the OrganizeIt server.", 0);
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(body.error ?? `Request failed (${r.status})`, r.status);
  return body as Classification;
}
