import { getOne, remove, update } from "@/lib/crud";
import { errorResponse, guardTable, guardUser, json, missingRequired } from "@/lib/api";

type Ctx = RouteContext<"/api/master/[table]/[id]">;

async function guard(ctx: Ctx) {
  const user = await guardUser();
  if (!user.ok) return { res: user.res };
  const { table, id } = await ctx.params;
  const t = guardTable(table);
  if (!t.ok) return { res: t.res };
  if (!/^\d+$/.test(id)) return { res: json({ error: "Invalid id" }, 400) };
  return { user: user.value, table: t.value, id };
}

export async function GET(_req: Request, ctx: Ctx) {
  const g = await guard(ctx);
  if (g.res) return g.res;
  try {
    const row = await getOne(g.table!, g.id!);
    return row ? json(row) : json({ error: "Not found" }, 404);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  const g = await guard(ctx);
  if (g.res) return g.res;
  const data = await req.json().catch(() => null);
  if (!data || typeof data !== "object") return json({ error: "Invalid body" }, 400);
  const missing = missingRequired(g.table!, data, true);
  if (missing) return json({ error: missing }, 400);
  try {
    const n = await update(g.table!, g.id!, data, g.user!.userId);
    return n ? json({ ok: true }) : json({ error: "Not found" }, 404);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const g = await guard(ctx);
  if (g.res) return g.res;
  try {
    const n = await remove(g.table!, g.id!, g.user!.userId);
    return n ? json({ ok: true }) : json({ error: "Not found" }, 404);
  } catch (e) {
    return errorResponse(e);
  }
}
