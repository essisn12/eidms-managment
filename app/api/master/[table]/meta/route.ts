import { fieldsFor, lookupOptions } from "@/lib/crud";
import { errorResponse, guardTable, guardUser, json } from "@/lib/api";

/** Form field definitions for a table, plus option lists for its lookup (select) fields. */
export async function GET(_req: Request, ctx: RouteContext<"/api/master/[table]/meta">) {
  const user = await guardUser();
  if (!user.ok) return user.res;
  const table = guardTable((await ctx.params).table, user.value);
  if (!table.ok) return table.res;
  try {
    const meta = fieldsFor(table.value);
    const lookups: Record<string, { value: number; label: string }[]> = {};
    for (const f of meta.fields) {
      if (f.lookup && !lookups[f.lookup]) lookups[f.lookup] = await lookupOptions(f.lookup);
    }
    return json({ ...meta, lookups });
  } catch (e) {
    return errorResponse(e);
  }
}
