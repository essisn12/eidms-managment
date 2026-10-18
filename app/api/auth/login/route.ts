import { z } from "zod";
import { errorResponse, json } from "@/lib/api";
import { verifyLogin } from "@/lib/auth";
import { createSession } from "@/lib/session";

const body = z.object({ userId: z.string().min(1).max(50), password: z.string().min(1).max(200) });

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "User ID and password are required" }, 400);
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
    const result = await verifyLogin(parsed.data.userId, parsed.data.password, ip);
    if (!result.ok) return json({ error: result.error }, 401);
    await createSession(result.user);
    return json({ ok: true, passwordExpired: result.passwordExpired });
  } catch (e) {
    return errorResponse(e);
  }
}
