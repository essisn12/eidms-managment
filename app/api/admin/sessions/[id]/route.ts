import { errorResponse, guardAdmin, json } from "@/lib/api";
import { getSessionActivity } from "@/lib/ums";

/** Activity log of one session. */
export async function GET(_req: Request, ctx: RouteContext<"/api/admin/sessions/[id]">) {
  const g = await guardAdmin();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!/^\d{1,15}$/.test(id)) return json({ error: "Invalid id" }, 400);
  try {
    return json(await getSessionActivity(Number(id)));
  } catch (e) {
    return errorResponse(e);
  }
}
