import "server-only";
import { fieldsFor } from "./crud";
import { isAdmin } from "./admin";
import { ClientError } from "./errors";
import { isMasterTable } from "./master-config";
import { readSession, type SessionUser } from "./session";
import { isUmsTable } from "./ums-config";

export const json = (body: unknown, status = 200) => Response.json(body, { status });

export type Guard<T> = { ok: true; value: T } | { ok: false; res: Response };

export async function guardUser(): Promise<Guard<SessionUser>> {
  const user = await readSession();
  return user ? { ok: true, value: user } : { ok: false, res: json({ error: "Unauthorized" }, 401) };
}

export async function guardAdmin(): Promise<Guard<SessionUser>> {
  const g = await guardUser();
  if (!g.ok) return g;
  return isAdmin(g.value) ? g : { ok: false, res: json({ error: "Forbidden" }, 403) };
}

/** Resolves a URL table key to the key crud.ts understands. UMS tables are admin-only. */
export function guardTable(key: string, user: SessionUser): Guard<string> {
  const k = key.toUpperCase();
  if (isMasterTable(k)) return { ok: true, value: k };
  if (isUmsTable(k)) {
    return isAdmin(user) ? { ok: true, value: `UMS.${k}` } : { ok: false, res: json({ error: "Forbidden" }, 403) };
  }
  return { ok: false, res: json({ error: "Unknown table" }, 404) };
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
  if (e instanceof ClientError) return json({ error: e.message }, e.status);
  const msg = e instanceof Error ? e.message : "Unexpected error";
  const tooLong = /ORA-12899: value too large for column "?\w+"?\."?\w+"?\."?(\w+)"? \(actual: (\d+), maximum: (\d+)\)/.exec(msg);
  if (tooLong) return json({ error: `${tooLong[1]} is too long (${tooLong[2]} characters, maximum ${tooLong[3]}).` }, 400);
  const notNull = /ORA-01400: cannot insert NULL into \(.*"(\w+)"\)/.exec(msg);
  if (notNull) return json({ error: `${notNull[1]} is required.` }, 400);
  const status = /must be a|is required/.test(msg) ? 400 : /ORA-00001/.test(msg) ? 409 : 500;
  if (status === 500) console.error(e);
  return json({ error: status === 500 ? "Server error" : msg }, status);
};
