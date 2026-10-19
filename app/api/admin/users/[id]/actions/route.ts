import { errorResponse, guardAdmin, json } from "@/lib/api";
import { extendExpiry, resetPassword, unlockUser } from "@/lib/ums";
import { actionBody, USER_ID } from "@/lib/ums-schemas";

export async function POST(req: Request, ctx: RouteContext<"/api/admin/users/[id]/actions">) {
  const g = await guardAdmin();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!USER_ID.test(id)) return json({ error: "Invalid user id" }, 400);
  const parsed = actionBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, 400);
  const a = parsed.data;
  try {
    if (a.action === "reset-password") await resetPassword(id, a.password, a.forceChange);
    else if (a.action === "extend-expiry") {
      if (!(await extendExpiry(id, a.days))) return json({ error: "User has no active password" }, 404);
    } else await unlockUser(id);
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
