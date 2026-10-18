import "server-only";
import { fieldsFor } from "./crud";
import { isMasterTable } from "./master-config";
import { readSession, type SessionUser } from "./session";

export const json = (body: unknown, status = 200) => Response.json(body, { status });

type Guard<T> = { ok: true; value: T } | { ok: false; res: Response };

export async function guardUser(): Promise<Guard<SessionUser>> {
  const user = await readSession();
  return user ? { ok: true, value: user } : { ok: false, res: json({ error: "Unauthorized" }, 401) };
}

export function guardTable(key: string): Guard<string> {
  const k = key.toUpperCase();
  return isMasterTable(k) ? { ok: true, value: k } : { ok: false, res: json({ error: "Unknown table" }, 404) };
}

/** Returns an error message when a required field is missing/blank, else null. */
export function missingRequired(table: string, data: Record<string, unknown>, partial = false) {
  for (const f of fieldsFor(table).fields) {
    if (!f.required) continue;
    if (partial && !(f.name in data)) continue;
    const v = data[f.name];
    if (v === undefined || v === null || String(v).trim() === "") return `${f.label} is required`;
  }
  return null;
}

export const errorResponse = (e: unknown) => {
  const msg = e instanceof Error ? e.message : "Unexpected error";
  const status = /must be a|is required/.test(msg) ? 400 : /ORA-00001/.test(msg) ? 409 : 500;
  if (status === 500) console.error(e);
  return json({ error: status === 500 ? "Server error" : msg }, status);
};
