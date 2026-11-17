import { z } from "zod";
import { errorResponse, guardAdmin, json } from "@/lib/api";
import { compareAccess, getTransfers, previewRecovery, runRecovery, whoCanSee } from "@/lib/file-recovery";

type Ctx = RouteContext<"/api/admin/file-recovery/[id]">;
const ID = /^\d{1,15}$/;

/** Current transfer state of the file; with ?recipe=… also what that recovery would change. */
export async function GET(req: Request, ctx: Ctx) {
  const g = await guardAdmin();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!ID.test(id)) return json({ error: "Invalid id" }, 400);
  const params = new URL(req.url).searchParams;
  const recipe = params.get("recipe");
  const users = (params.get("users") ?? "").split(",").map((u) => u.trim()).filter(Boolean);
  if (users.length > 5 || users.some((u) => !/^[A-Za-z0-9_.@-]{1,50}$/.test(u))) return json({ error: "Invalid user list" }, 400);
  try {
    if (users.length) return json(await compareAccess(Number(id), users));
    return json({
      ...(await getTransfers(Number(id))),
      access: await whoCanSee(Number(id)),
      preview: recipe ? await previewRecovery(recipe, Number(id)) : null,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

const body = z.object({ recipe: z.string().min(1).max(60), reason: z.string().trim().min(5, "Enter a reason (at least 5 characters)").max(500) });

export async function POST(req: Request, ctx: Ctx) {
  const g = await guardAdmin();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!ID.test(id)) return json({ error: "Invalid id" }, 400);
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, 400);
  try {
    return json(await runRecovery(parsed.data.recipe, Number(id), g.value.userId, parsed.data.reason));
  } catch (e) {
    return errorResponse(e);
  }
}
