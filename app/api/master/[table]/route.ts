import { create, list } from "@/lib/crud";
import { errorResponse, guardTable, guardUser, json, missingRequired } from "@/lib/api";

export async function GET(req: Request, ctx: RouteContext<"/api/master/[table]">) {
  const user = await guardUser();
  if (!user.ok) return user.res;
  const table = guardTable((await ctx.params).table, user.value);
  if (!table.ok) return table.res;

  const sp = new URL(req.url).searchParams;
  const filters: Record<string, string> = {};
  for (const [k, v] of sp) if (k.startsWith("f_")) filters[k.slice(2)] = v;
  try {
    return json(
      await list(table.value, {
        search: sp.get("q") ?? undefined,
        page: Number(sp.get("page") ?? 1),
        pageSize: Number(sp.get("pageSize") ?? 20),
        sort: sp.get("sort") ?? undefined,
        dir: sp.get("dir") === "desc" ? "desc" : "asc",
        filters,
      }),
    );
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request, ctx: RouteContext<"/api/master/[table]">) {
  const user = await guardUser();
  if (!user.ok) return user.res;
  const table = guardTable((await ctx.params).table, user.value);
  if (!table.ok) return table.res;

  const data = await req.json().catch(() => null);
  if (!data || typeof data !== "object") return json({ error: "Invalid body" }, 400);
  const missing = missingRequired(table.value, data);
  if (missing) return json({ error: missing }, 400);
  try {
    return json({ id: await create(table.value, data, user.value.userId) }, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
