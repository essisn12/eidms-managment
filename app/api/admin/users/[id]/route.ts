import { errorResponse, guardAdmin, json } from "@/lib/api";
import { getUser, removeUser, updateUser } from "@/lib/ums";
import { updateUserBody, USER_ID } from "@/lib/ums-schemas";

type Ctx = RouteContext<"/api/admin/users/[id]">;

export async function GET(_req: Request, ctx: Ctx) {
  const g = await guardAdmin();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!USER_ID.test(id)) return json({ error: "Invalid user id" }, 400);
  try {
    const user = await getUser(id);
    return user ? json(user) : json({ error: "Not found" }, 404);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  const g = await guardAdmin();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!USER_ID.test(id)) return json({ error: "Invalid user id" }, 400);
  const parsed = updateUserBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return json({ error: i ? `${i.path.join(".") || "body"}: ${i.message}` : "Invalid body" }, 400);
  }
  const { roles, ...fields } = parsed.data;
  if (id.toUpperCase() === g.value.userId.toUpperCase() && fields.RECSTATUS !== "A") {
    return json({ error: "You cannot deactivate your own account" }, 400);
  }
  try {
    return (await updateUser(id, fields, roles)) ? json({ ok: true }) : json({ error: "Not found" }, 404);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const g = await guardAdmin();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!USER_ID.test(id)) return json({ error: "Invalid user id" }, 400);
  if (id.toUpperCase() === g.value.userId.toUpperCase()) {
    return json({ error: "You cannot delete your own account" }, 400);
  }
  try {
    return (await removeUser(id)) ? json({ ok: true }) : json({ error: "Not found" }, 404);
  } catch (e) {
    return errorResponse(e);
  }
}
