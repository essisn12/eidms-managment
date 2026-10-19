import { errorResponse, guardAdmin, json } from "@/lib/api";
import { list } from "@/lib/crud";

export async function GET(req: Request) {
  const g = await guardAdmin();
  if (!g.ok) return g.res;
  const sp = new URL(req.url).searchParams;
  try {
    return json(
      await list("UMS.UMS_USERSESSION", {
        search: sp.get("q") ?? undefined,
        page: Number(sp.get("page") ?? 1),
        pageSize: Number(sp.get("pageSize") ?? 20),
        sort: "SESSIONID",
        dir: "desc",
      }),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
