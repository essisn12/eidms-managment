import { errorResponse, guardAdmin, json } from "@/lib/api";
import { adminLookups } from "@/lib/ums";

export async function GET() {
  const g = await guardAdmin();
  if (!g.ok) return g.res;
  try {
    return json(await adminLookups());
  } catch (e) {
    return errorResponse(e);
  }
}
