import { errorResponse, guardAdmin, json } from "@/lib/api";
import { recipeList, searchInvestigations } from "@/lib/file-recovery";

export async function GET(req: Request) {
  const g = await guardAdmin();
  if (!g.ok) return g.res;
  try {
    const q = new URL(req.url).searchParams.get("q") ?? "";
    return json({ recipes: recipeList(), rows: await searchInvestigations(q) });
  } catch (e) {
    return errorResponse(e);
  }
}
