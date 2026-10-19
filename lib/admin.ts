import "server-only";
import { redirect } from "next/navigation";
import { requireUser } from "./auth";
import type { SessionUser } from "./session";

/** UMS administrators are the users holding one of the role ids listed in UMS_ADMIN_ROLE_IDS. */
export function isAdmin(user: SessionUser): boolean {
  const ids = (process.env.UMS_ADMIN_ROLE_IDS ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return user.roles.some((r) => ids.includes(r));
}

/** For pages/layouts under /admin. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!isAdmin(user)) redirect("/dashboard");
  return user;
}
