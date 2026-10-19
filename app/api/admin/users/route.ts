import { errorResponse, guardAdmin, json } from "@/lib/api";
import { createUser, listUsers } from "@/lib/ums";
import { createUserBody } from "@/lib/ums-schemas";

export async function GET(req: Request) {
  const g = await guardAdmin();
  if (!g.ok) return g.res;
  const sp = new URL(req.url).searchParams;
  try {
    return json(
      await listUsers({
        search: sp.get("q") ?? undefined,
        page: Number(sp.get("page") ?? 1),
        pageSize: Number(sp.get("pageSize") ?? 20),
      }),
    );
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  const g = await guardAdmin();
  if (!g.ok) return g.res;
  const parsed = createUserBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return json({ error: i ? `${i.path.join(".") || "body"}: ${i.message}` : "Invalid body" }, 400);
  }
  const { password, forceChange, roles, permission, ...fields } = parsed.data;
  try {
    return json({ id: await createUser(fields, password, roles, forceChange, permission) }, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
