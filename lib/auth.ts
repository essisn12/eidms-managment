import "server-only";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { execute, query } from "./db";
import { readSession, type SessionUser } from "./session";

/** UMS_USERINFO.RECSTATUS value that means "active, may log in". */
const ACTIVE = "A";

type LoginRow = {
  USERID: string;
  NAME: string;
  STATUS: string;
  USERPASS: string | null;
  EXPIREDATE: Date | null;
};

export type LoginResult =
  | { ok: true; user: SessionUser; passwordExpired: boolean }
  | { ok: false; error: string };

/**
 * UMS_LOGINFAILURETEMP.USERID has a foreign key to UMS_USERINFO.USERID, so only known users can be
 * recorded. Use the stored USERID because the FK comparison is case-sensitive. A user deleted
 * between the lookup and this insert must not turn a failed login into a 500.
 */
async function recordFailure(userId: string, ip: string) {
  try {
    await execute(
      `INSERT INTO UMS.UMS_LOGINFAILURETEMP (ID, USERID, IPADDRESS, LOGINDATETIME)
       VALUES ((SELECT NVL(MAX(ID),0)+1 FROM UMS.UMS_LOGINFAILURETEMP), :u, :ip, SYSDATE)`,
      { u: userId, ip: ip.slice(0, 39) },
    );
  } catch (e) {
    if (!String((e as Error).message).includes("ORA-02291")) throw e;
    console.warn(`[auth] failed-login row skipped for ${userId}: user no longer exists`);
  }
}

export async function verifyLogin(userId: string, password: string, ip: string): Promise<LoginResult> {
  const maxFail = Number(process.env.LOGIN_MAX_FAILURES ?? 5);
  const lockMin = Number(process.env.LOGIN_LOCK_MINUTES ?? 15);

  const [{ N }] = await query<{ N: number }>(
    `SELECT COUNT(*) AS N FROM UMS.UMS_LOGINFAILURETEMP
      WHERE UPPER(USERID) = UPPER(:u) AND LOGINDATETIME > SYSDATE - :m / 1440`,
    { u: userId, m: lockMin },
  );
  if (N >= maxFail) return { ok: false, error: `Too many failed attempts. Try again in ${lockMin} minutes.` };

  // LEFT JOIN so a real user with no active password is still found (and can have the failure
  // recorded); an unknown user produces no row at all.
  const rows = await query<LoginRow>(
    `SELECT u.USERID, u.NAME, u.RECSTATUS AS STATUS, p.USERPASS, p.EXPIREDATE
       FROM UMS.UMS_USERINFO u
       LEFT JOIN UMS.UMS_PASS p ON p.USERID = u.USERID AND p.RECSTATUS = 'A'
      WHERE UPPER(u.USERID) = UPPER(:u)
      ORDER BY p.CREATEDATE DESC NULLS LAST FETCH FIRST 1 ROW ONLY`,
    { u: userId },
  );
  const row = rows[0];
  const valid = row?.USERPASS ? await bcrypt.compare(password, row.USERPASS) : false;

  if (!row || !valid) {
    if (row) await recordFailure(row.USERID, ip);
    return { ok: false, error: "Invalid user ID or password." };
  }
  if (row.STATUS !== ACTIVE) return { ok: false, error: "This account is not active." };

  await execute(`DELETE FROM UMS.UMS_LOGINFAILURETEMP WHERE UPPER(USERID) = UPPER(:u)`, { u: userId });
  const roles = await query<{ ROLEID: number }>(
    `SELECT ROLEID FROM UMS.UMS_ROLEASSIGN WHERE USERID = :u AND RECSTATUS = 'A'`,
    { u: row.USERID },
  );
  return {
    ok: true,
    passwordExpired: row.EXPIREDATE ? row.EXPIREDATE < new Date() : true,
    user: { userId: row.USERID, name: row.NAME, roles: roles.map((r) => Number(r.ROLEID)) },
  };
}

/** For pages/layouts: redirect to /login when there is no valid session. */
export async function requireUser(): Promise<SessionUser> {
  const user = await readSession();
  if (!user) redirect("/login");
  return user;
}
