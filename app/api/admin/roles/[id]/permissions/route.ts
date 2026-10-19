import { errorResponse, guardAdmin, json } from "@/lib/api";
import { getRolePermissions, saveRolePermissions } from "@/lib/ums";
import { permissionsBody } from "@/lib/ums-schemas";

type Ctx = RouteContext<"/api/admin/roles/[id]/permissions">;

export async function GET(_req: Request, ctx: Ctx) {
  const g = await guardAdmin();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return json({ error: "Invalid id" }, 400);
  try {
    const data = await getRolePermissions(Number(id));
    return data ? json(data) : json({ error: "Not found" }, 404);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  const g = await guardAdmin();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return json({ error: "Invalid id" }, 400);
  const parsed = permissionsBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid body" }, 400);
  try {
    return json({ granted: await saveRolePermissions(Number(id), parsed.data.grants) });
  } catch (e) {
    return errorResponse(e);
  }
}
