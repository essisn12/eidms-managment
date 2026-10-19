import "server-only";
import bcrypt from "bcryptjs";
import type oracledb from "oracledb";
import { nextId, query, transaction } from "./db";
import { ClientError } from "./errors";
import { DEFAULT_PASSWORD } from "./ums-schemas";

const lockMinutes = () => Number(process.env.LOGIN_LOCK_MINUTES ?? 15);

/* ----------------------------------------------------------------- password policy */

export type Policy = {
  min: number;
  max: number;
  expireDays: number;
  reuse: number;
  upper: boolean;
  lower: boolean;
  special: boolean;
};

const on = (v: unknown) => /^(Y|1|T)$/i.test(String(v ?? ""));

/** Active policy: the app-independent row (APPID null) when present, otherwise the first active one. */
export async function getPolicy(): Promise<Policy> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM UMS.UMS_PASSPOLICY WHERE RECSTATUS = 'A' ORDER BY CASE WHEN APPID IS NULL THEN 0 ELSE 1 END, PASSPOLICYID`,
  );
  const r = rows[0];
  if (!r) return { min: 8, max: 50, expireDays: 90, reuse: 0, upper: false, lower: false, special: false };
  return {
    min: Number(r.MINLENGTH),
    max: Number(r.MAXLENGTH),
    expireDays: Number(r.EXPIREAFTER),
    reuse: Number(r.REUSE),
    upper: on(r.ISUPPERCASE),
    lower: on(r.ISLOWERCASE),
    special: on(r.ISSPECIALCHAR),
  };
}

export function checkPassword(p: Policy, pw: string): string | null {
  if (pw.length < p.min) return `Password must be at least ${p.min} characters`;
  if (pw.length > p.max) return `Password must be at most ${p.max} characters`;
  if (p.upper && !/[A-Z]/.test(pw)) return "Password must contain an uppercase letter";
  if (p.lower && !/[a-z]/.test(pw)) return "Password must contain a lowercase letter";
  if (p.special && !/[^A-Za-z0-9]/.test(pw)) return "Password must contain a special character";
  return null;
}

/** $2a$ prefix keeps hashes verifiable by the legacy .NET BCrypt library, which predates $2b$. */
async function hashPassword(pw: string) {
  const salt = (await bcrypt.genSalt(10)).replace(/^\$2b\$/, "$2a$");
  return bcrypt.hash(pw, salt);
}

async function insertPassword(c: oracledb.Connection, userId: string, pw: string, days: number) {
  const hash = await hashPassword(pw);
  await c.execute(`UPDATE UMS.UMS_PASS SET RECSTATUS = 'I' WHERE USERID = :u AND RECSTATUS = 'A'`, { u: userId });
  const id = await nextId(c, "UMS", "UMS_PASS", "PASSID");
  await c.execute(
    `INSERT INTO UMS.UMS_PASS (PASSID, USERID, USERPASS, CREATEDATE, EXPIREDATE, RECSTATUS)
     VALUES (:id, :u, :h, SYSDATE, SYSDATE + :d, 'A')`,
    { id, u: userId, h: hash, d: days },
  );
}

/* ----------------------------------------------------------------- users */

export type UserInput = {
  USERID: string;
  NAME: string;
  CATEGORYID: number;
  CELLNO: string;
  EMAIL: string;
  DOB: string;
  CATIDVAL: string;
  MFA: string;
  MACADDRESS?: string | null;
  IPADDRESS?: string | null;
  RECSTATUS: string;
};

/** NSIDB.NSIDB_USER_PERMISION: the user's level, organisation placement and display names (same DB, other schema). */
export type Permission = {
  levelId: number;
  branchId: number;
  wingId: number;
  sectionId: number;
  designationId: number;
  nameBangla: string;
  nameEnglish: string;
};

export async function getPermission(userId: string): Promise<Permission | null> {
  const [r] = await query<Record<string, unknown>>(
    `SELECT USER_LEVEL_ID, BRANCH_ID, WING_ID, SECTION_ID, DESIGNATION_ID, USER_NAME_BANGLA, USER_NAME_ENGLISH
       FROM NSIDB.NSIDB_USER_PERMISION
      WHERE UPPER(USER_NAME) = UPPER(:u) AND RECSTATUS = 'A' FETCH FIRST 1 ROWS ONLY`,
    { u: userId },
  );
  if (!r) return null;
  return {
    levelId: Number(r.USER_LEVEL_ID),
    branchId: Number(r.BRANCH_ID),
    wingId: Number(r.WING_ID),
    sectionId: Number(r.SECTION_ID),
    designationId: Number(r.DESIGNATION_ID),
    nameBangla: String(r.USER_NAME_BANGLA ?? ""),
    nameEnglish: String(r.USER_NAME_ENGLISH ?? ""),
  };
}

export async function listUsers(p: { search?: string; page?: number; pageSize?: number }) {
  const page = Math.max(1, p.page ?? 1);
  const size = Math.min(100, Math.max(1, p.pageSize ?? 20));
  const binds: Record<string, unknown> = {};
  const where = [`u.RECSTATUS <> 'D'`];
  if (p.search?.trim()) {
    where.push(`(UPPER(u.USERID) LIKE :s OR UPPER(u.NAME) LIKE :s OR UPPER(u.EMAIL) LIKE :s OR UPPER(u.CELLNO) LIKE :s)`);
    binds.s = `%${p.search.trim().toUpperCase()}%`;
  }
  const w = `WHERE ${where.join(" AND ")}`;
  const [{ N }] = await query<{ N: number }>(`SELECT COUNT(*) AS N FROM UMS.UMS_USERINFO u ${w}`, binds as never);
  const rows = await query(
    `SELECT u.USERID, u.NAME, u.CATEGORYID, u.CELLNO, u.EMAIL, u.RECSTATUS,
            (SELECT COUNT(*) FROM UMS.UMS_LOGINFAILURETEMP f
              WHERE UPPER(f.USERID) = UPPER(u.USERID) AND f.LOGINDATETIME > SYSDATE - :m / 1440) AS FAILS,
            (SELECT MAX(p.EXPIREDATE) FROM UMS.UMS_PASS p WHERE p.USERID = u.USERID AND p.RECSTATUS = 'A') AS EXPIRES
       FROM UMS.UMS_USERINFO u ${w}
      ORDER BY u.USERID OFFSET :off ROWS FETCH NEXT :lim ROWS ONLY`,
    { ...binds, m: lockMinutes(), off: (page - 1) * size, lim: size } as never,
  );
  return { rows, total: Number(N), page, pageSize: size, maxFailures: Number(process.env.LOGIN_MAX_FAILURES ?? 5) };
}

export async function getUser(userId: string) {
  const rows = await query(
    `SELECT USERID, NAME, CATEGORYID, CELLNO, EMAIL, DOB, CATIDVAL, MFA, MACADDRESS, IPADDRESS, RECSTATUS
       FROM UMS.UMS_USERINFO WHERE USERID = :u AND RECSTATUS <> 'D'`,
    { u: userId },
  );
  if (!rows[0]) return null;
  const roles = await query<{ ROLEID: number }>(
    `SELECT ROLEID FROM UMS.UMS_ROLEASSIGN WHERE USERID = :u AND RECSTATUS = 'A'`,
    { u: userId },
  );
  return { ...rows[0], roles: roles.map((r) => Number(r.ROLEID)), permission: await getPermission(userId) };
}

async function syncRoles(c: oracledb.Connection, userId: string, roles: number[]) {
  const want = new Set(roles);
  const existing = (
    await c.execute<{ ROLEASSIGNID: number; ROLEID: number; RECSTATUS: string }>(
      `SELECT ROLEASSIGNID, ROLEID, RECSTATUS FROM UMS.UMS_ROLEASSIGN WHERE USERID = :u`,
      { u: userId },
    )
  ).rows!;
  const seen = new Set<number>();
  for (const e of existing) {
    const roleId = Number(e.ROLEID);
    seen.add(roleId);
    const should = want.has(roleId) ? "A" : "D";
    if (e.RECSTATUS !== should) {
      await c.execute(`UPDATE UMS.UMS_ROLEASSIGN SET RECSTATUS = :s WHERE ROLEASSIGNID = :id`, {
        s: should,
        id: e.ROLEASSIGNID,
      });
    }
  }
  for (const roleId of want) {
    if (seen.has(roleId)) continue;
    const id = await nextId(c, "UMS", "UMS_ROLEASSIGN", "ROLEASSIGNID");
    await c.execute(
      `INSERT INTO UMS.UMS_ROLEASSIGN (ROLEASSIGNID, USERID, ROLEID, RECSTATUS) VALUES (:id, :u, :r, 'A')`,
      { id, u: userId, r: roleId },
    );
  }
}

const FIELD_LABELS: Record<string, string> = {
  USERID: "User ID",
  NAME: "Name",
  CATEGORYID: "Category",
  CELLNO: "Cell no",
  EMAIL: "Email",
  DOB: "Date of birth",
  CATIDVAL: "Category ID value",
  MACADDRESS: "MAC address",
  IPADDRESS: "IP address",
};

/**
 * Turns an ORA-00001 into a message an operator can act on: which field(s) clash, with the value entered and
 * the user already holding it. Any other error is returned unchanged.
 */
async function explainUniqueViolation(
  c: oracledb.Connection,
  e: unknown,
  owner: string,
  table: string,
  values: Record<string, unknown>,
): Promise<unknown> {
  const m = String((e as Error).message);
  const name = /ORA-00001: unique constraint \((?:\w+\.)?(\w+)\)/.exec(m)?.[1];
  if (!name) return e;
  try {
    const cols = (
      await c.execute<{ COLUMN_NAME: string }>(
        `SELECT COLUMN_NAME FROM ALL_CONS_COLUMNS WHERE OWNER = :o AND CONSTRAINT_NAME = :n ORDER BY POSITION`,
        { o: owner, n: name },
      )
    ).rows!.map((r) => r.COLUMN_NAME);
    if (!cols.length) return e;
    const shown = cols.map((col) => `${FIELD_LABELS[col] ?? col} "${values[col] ?? ""}"`).join(" + ");
    let who = "";
    if (cols.every((col) => col in values)) {
      const hit = (
        await c.execute<{ USERID: string; NAME: string; RECSTATUS: string }>(
          `SELECT USERID, NAME, RECSTATUS FROM ${owner}.${table}
            WHERE ${cols.map((col) => `${col} = :${col}`).join(" AND ")} FETCH FIRST 1 ROWS ONLY`,
          Object.fromEntries(cols.map((col) => [col, values[col]])) as never,
        )
      ).rows![0];
      if (hit) {
        who = ` It already belongs to user ${hit.USERID}${hit.NAME ? ` (${hit.NAME})` : ""}${hit.RECSTATUS === "D" ? ", who was deleted" : ""}.`;
      }
    }
    const fields = cols.map((col) => FIELD_LABELS[col] ?? col).join(" / ");
    return new ClientError(`${shown} is already in use.${who} Change ${fields} and submit again.`, 409);
  } catch {
    return e;
  }
}

const userBinds = (d: UserInput) => ({
  USERID: d.USERID,
  NAME: d.NAME,
  CATEGORYID: d.CATEGORYID,
  CELLNO: d.CELLNO,
  EMAIL: d.EMAIL,
  DOB: d.DOB,
  CATIDVAL: d.CATIDVAL,
  MFA: d.MFA,
  MACADDRESS: d.MACADDRESS || null,
  IPADDRESS: d.IPADDRESS || null,
  RECSTATUS: d.RECSTATUS,
});

export async function createUser(
  d: UserInput,
  password: string,
  roles: number[],
  forceChange: boolean,
  permission?: Permission | null,
) {
  const policy = await getPolicy();
  const isDefault = password === DEFAULT_PASSWORD;
  const bad = isDefault ? null : checkPassword(policy, password);
  if (bad) throw new ClientError(bad);
  if (isDefault) forceChange = true;
  return transaction(async (c) => {
    const dup = await c.execute(`SELECT 1 FROM UMS.UMS_USERINFO WHERE UPPER(USERID) = UPPER(:u)`, { u: d.USERID });
    if (dup.rows?.length) throw new ClientError("User ID already exists", 409);
    try {
      await c.execute(
        `INSERT INTO UMS.UMS_USERINFO
           (USERID, NAME, CATEGORYID, CELLNO, EMAIL, DOB, CATIDVAL, MFA, MACADDRESS, IPADDRESS, RECSTATUS, PICTURE, SIGNATURE)
         VALUES (:USERID, :NAME, :CATEGORYID, :CELLNO, :EMAIL, :DOB, :CATIDVAL, :MFA, :MACADDRESS, :IPADDRESS, :RECSTATUS,
                 EMPTY_BLOB(), EMPTY_BLOB())`,
        userBinds(d),
      );
    } catch (e) {
      throw await explainUniqueViolation(c, e, "UMS", "UMS_USERINFO", userBinds(d));
    }
    await insertPassword(c, d.USERID, password, forceChange ? -1 : policy.expireDays);
    await syncRoles(c, d.USERID, roles);
    if (permission) {
      const id = await nextId(c, "NSIDB", "NSIDB_USER_PERMISION", "USER_PERMISION_ID");
      await c.execute(
        `INSERT INTO NSIDB.NSIDB_USER_PERMISION
           (USER_PERMISION_ID, USER_NAME, USER_LEVEL_ID, BRANCH_ID, WING_ID, SECTION_ID, RECSTATUS,
            USER_NAME_BANGLA, USER_NAME_ENGLISH, DESIGNATION_ID)
         VALUES (:id, :u, :lvl, :br, :wg, :sec, 'A', :bn, :en, :des)`,
        {
          id,
          u: d.USERID,
          lvl: permission.levelId,
          br: permission.branchId,
          wg: permission.wingId,
          sec: permission.sectionId,
          bn: permission.nameBangla,
          en: permission.nameEnglish,
          des: permission.designationId,
        },
      );
    }
    return d.USERID;
  });
}

export async function updateUser(userId: string, d: Omit<UserInput, "USERID">, roles?: number[]) {
  return transaction(async (c) => {
    const binds = userBinds({ ...d, USERID: userId });
    const r = await c
      .execute(
        `UPDATE UMS.UMS_USERINFO
            SET NAME = :NAME, CATEGORYID = :CATEGORYID, CELLNO = :CELLNO, EMAIL = :EMAIL, DOB = :DOB,
                CATIDVAL = :CATIDVAL, MFA = :MFA, MACADDRESS = :MACADDRESS, IPADDRESS = :IPADDRESS, RECSTATUS = :RECSTATUS
          WHERE USERID = :USERID AND RECSTATUS <> 'D'`,
        binds,
      )
      .catch(async (e) => {
        throw await explainUniqueViolation(c, e, "UMS", "UMS_USERINFO", binds);
      });
    if (!r.rowsAffected) return 0;
    if (roles) await syncRoles(c, userId, roles);
    return 1;
  });
}

/** Soft delete; the account can no longer log in and disappears from the list. */
export async function removeUser(userId: string) {
  return transaction(async (c) => {
    const r = await c.execute(`UPDATE UMS.UMS_USERINFO SET RECSTATUS = 'D' WHERE USERID = :u AND RECSTATUS <> 'D'`, {
      u: userId,
    });
    return r.rowsAffected ?? 0;
  });
}

export async function resetPassword(userId: string, password: string, forceChange: boolean) {
  const policy = await getPolicy();
  const isDefault = password === DEFAULT_PASSWORD;
  const bad = isDefault ? null : checkPassword(policy, password);
  if (bad) throw new ClientError(bad);
  if (isDefault) forceChange = true;
  if (policy.reuse > 0 && !isDefault) {
    const prev = await query<{ USERPASS: string }>(
      `SELECT USERPASS FROM UMS.UMS_PASS WHERE USERID = :u ORDER BY CREATEDATE DESC FETCH FIRST :n ROWS ONLY`,
      { u: userId, n: policy.reuse },
    );
    for (const p of prev) {
      if (await bcrypt.compare(password, p.USERPASS)) {
        throw new ClientError(`Password was used recently; pick one not among the last ${policy.reuse}`);
      }
    }
  }
  await transaction(async (c) => {
    const u = await c.execute(`SELECT 1 FROM UMS.UMS_USERINFO WHERE USERID = :u AND RECSTATUS <> 'D'`, { u: userId });
    if (!u.rows?.length) throw new ClientError("User not found", 404);
    await insertPassword(c, userId, password, forceChange ? -1 : policy.expireDays);
    await c.execute(`DELETE FROM UMS.UMS_LOGINFAILURETEMP WHERE UPPER(USERID) = UPPER(:u)`, { u: userId });
  });
}

export async function extendExpiry(userId: string, days: number) {
  // Keeps history like a password change: the current row goes inactive and a new active row (same hash,
  // original CREATEDATE) carries the new expiry.
  return transaction(async (c) => {
    const cur = await c.execute<{ PASSID: number; USERPASS: string; CREATEDATE: Date }>(
      `SELECT PASSID, USERPASS, CREATEDATE FROM UMS.UMS_PASS WHERE USERID = :u AND RECSTATUS = 'A'
        ORDER BY CREATEDATE DESC, PASSID DESC FETCH FIRST 1 ROWS ONLY`,
      { u: userId },
    );
    const row = cur.rows?.[0];
    if (!row) return 0;
    await c.execute(`UPDATE UMS.UMS_PASS SET RECSTATUS = 'I' WHERE USERID = :u AND RECSTATUS = 'A'`, { u: userId });
    const id = await nextId(c, "UMS", "UMS_PASS", "PASSID");
    await c.execute(
      `INSERT INTO UMS.UMS_PASS (PASSID, USERID, USERPASS, CREATEDATE, EXPIREDATE, RECSTATUS)
       VALUES (:id, :u, :h, :cd, SYSDATE + :d, 'A')`,
      { id, u: userId, h: row.USERPASS, cd: row.CREATEDATE, d: days },
    );
    return 1;
  });
}

export async function unlockUser(userId: string) {
  return transaction(async (c) => {
    const r = await c.execute(`DELETE FROM UMS.UMS_LOGINFAILURETEMP WHERE UPPER(USERID) = UPPER(:u)`, { u: userId });
    return r.rowsAffected ?? 0;
  });
}

/** Activity of one login session: a single bounded query (no COUNT, no generic paging) so big log tables stay fast. */
export async function getSessionActivity(sessionId: number) {
  const rows = await query(
    `SELECT ACTIVITYID, SESSIONID, FEATUREID, ACTIONID, ACTIONNAME, ACTIONTYPE, MODULEID, ACTIONDATETIME
       FROM UMS.UMS_USERSESSIONLOG
      WHERE SESSIONID = :s AND (RECSTATUS IS NULL OR RECSTATUS <> 'D')
      ORDER BY ACTIONDATETIME, ACTIVITYID FETCH FIRST 200 ROWS ONLY`,
    { s: sessionId },
  );
  return { rows, total: rows.length };
}

/* ----------------------------------------------------------------- lookups */

export async function adminLookups() {
  const [categories, roles, levels, branches, wings, sections, designations] = await Promise.all([
    query<{ CATEGORYID: number; CATEGORYNAME: string }>(
      `SELECT CATEGORYID, CATEGORYNAME FROM UMS.UMS_CATEGORY WHERE RECSTATUS <> 'D' ORDER BY CATEGORYNAME`,
    ),
    query<{ ROLEID: number; ROLENAME: string }>(
      `SELECT ROLEID, ROLENAME FROM UMS.UMS_ROLE WHERE RECSTATUS <> 'D' ORDER BY ROLENAME`,
    ),
    query<{ ID: number; LABEL: string }>(
      `SELECT USER_LEVEL_ID AS ID, USER_LEVEL_NAME AS LABEL FROM NSIDB.NSIDB_USER_LEVEL WHERE RECSTATUS = 'A' ORDER BY USER_LEVEL_ID`,
    ),
    query<{ ID: number; LABEL: string }>(
      `SELECT BRANCH_ID AS ID, NAME_ENGLISH AS LABEL FROM NSIDB.NSIDB_BRANCH WHERE RECSTATUS = 'A' ORDER BY NAME_ENGLISH`,
    ),
    query<{ ID: number; LABEL: string; PARENT: number }>(
      `SELECT WING_ID AS ID, NAME_ENGLISH AS LABEL, BRANCH_ID AS PARENT FROM NSIDB.NSIDB_WING WHERE RECSTATUS = 'A' ORDER BY NAME_ENGLISH`,
    ),
    query<{ ID: number; LABEL: string; PARENT: number }>(
      `SELECT SECTION_ID AS ID, NAME_ENGLISH AS LABEL, WING_ID AS PARENT FROM NSIDB.NSIDB_SECTION WHERE RECSTATUS = 'A' ORDER BY NAME_ENGLISH`,
    ),
    query<{ ID: number; LABEL: string }>(
      `SELECT DESIGNATION_ID AS ID, NAME_ENGLISH AS LABEL FROM NSIDB.NSIDB_DESIGNATION WHERE RECSTATUS = 'A' ORDER BY NAME_ENGLISH`,
    ),
  ]);
  const opt = (r: { ID: number; LABEL: string; PARENT?: number }) => ({
    value: Number(r.ID),
    label: r.LABEL,
    ...(r.PARENT !== undefined && { parent: Number(r.PARENT) }),
  });
  return {
    levels: levels.map(opt),
    branches: branches.map(opt),
    wings: wings.map(opt),
    sections: sections.map(opt),
    designations: designations.map(opt),
    categories: categories.map((c) => ({ value: Number(c.CATEGORYID), label: c.CATEGORYNAME })),
    roles: roles.map((r) => ({ value: Number(r.ROLEID), label: r.ROLENAME })),
  };
}

/* ----------------------------------------------------------------- role permissions */

const FLAGS = ["CREATEYN", "EDITYN", "DELETEYN", "VIEWDETAILYN", "AUTHYN", "CANCELYN"] as const;
export type Flag = (typeof FLAGS)[number];
export type Grant = { featureId: string } & Record<Flag, boolean>;

type FeatureRow = {
  APPID: string;
  APPNAME: string | null;
  MODULEID: string;
  MODULENAME: string | null;
  FEATUREID: string;
  FEATURENAME: string;
};

const featureRows = () =>
  query<FeatureRow>(
    `SELECT f.APPID, a.NAME AS APPNAME, f.MODULEID, m.NAME AS MODULENAME, f.FEATUREID, f.NAME AS FEATURENAME
       FROM UMS.UMS_FEATURECONFIG f
       LEFT JOIN UMS.UMS_MODULECONFIG m ON m.MODULEID = f.MODULEID AND m.APPID = f.APPID
       LEFT JOIN UMS.UMS_APPCONFIG a ON a.APPID = f.APPID
      WHERE f.RECSTATUS IS NULL OR f.RECSTATUS <> 'D'
      ORDER BY f.APPID, f.MODULEID, f.FEATUREID`,
  );

export async function getRolePermissions(roleId: number) {
  const [role] = await query<{ ROLEID: number; ROLENAME: string }>(
    `SELECT ROLEID, ROLENAME FROM UMS.UMS_ROLE WHERE ROLEID = :r AND RECSTATUS <> 'D'`,
    { r: roleId },
  );
  if (!role) return null;
  const [features, grants] = await Promise.all([
    featureRows(),
    query<Record<string, string>>(
      `SELECT FEATUREID, ${FLAGS.join(", ")} FROM UMS.UMS_ROLEDTL WHERE ROLEID = :r AND RECSTATUS = 'A'`,
      { r: roleId },
    ),
  ]);
  const granted = new Map(grants.map((g) => [g.FEATUREID, g]));
  return {
    role: { id: Number(role.ROLEID), name: role.ROLENAME },
    features: features.map((f) => {
      const g = granted.get(f.FEATUREID);
      return {
        featureId: f.FEATUREID,
        name: f.FEATURENAME,
        app: f.APPNAME ?? f.APPID,
        module: f.MODULENAME ?? f.MODULEID,
        grant: Object.fromEntries(FLAGS.map((k) => [k, g?.[k] === "Y"])) as Record<Flag, boolean>,
      };
    }),
  };
}

/** Replaces the role's grants. Features with no flag set are deactivated, not deleted. */
export async function saveRolePermissions(roleId: number, grants: Grant[]) {
  const features = new Map((await featureRows()).map((f) => [f.FEATUREID, f]));
  return transaction(async (c) => {
    const role = await c.execute(`SELECT 1 FROM UMS.UMS_ROLE WHERE ROLEID = :r AND RECSTATUS <> 'D'`, { r: roleId });
    if (!role.rows?.length) throw new ClientError("Role not found", 404);
    const existing = (
      await c.execute<{ ROLEDTLID: number; FEATUREID: string }>(
        `SELECT ROLEDTLID, FEATUREID FROM UMS.UMS_ROLEDTL WHERE ROLEID = :r`,
        { r: roleId },
      )
    ).rows!;
    const byFeature = new Map(existing.map((e) => [e.FEATUREID, Number(e.ROLEDTLID)]));
    const want = new Map(grants.filter((g) => FLAGS.some((k) => g[k])).map((g) => [g.featureId, g]));

    for (const [featureId, id] of byFeature) {
      if (want.has(featureId)) continue;
      await c.execute(`UPDATE UMS.UMS_ROLEDTL SET RECSTATUS = 'D' WHERE ROLEDTLID = :id`, { id });
    }
    for (const [featureId, g] of want) {
      const f = features.get(featureId);
      if (!f) throw new ClientError(`Unknown feature ${featureId}`);
      const flags = Object.fromEntries(FLAGS.map((k) => [k, g[k] ? "Y" : "N"]));
      const id = byFeature.get(featureId);
      if (id) {
        await c.execute(
          `UPDATE UMS.UMS_ROLEDTL SET ${FLAGS.map((k) => `${k} = :${k}`).join(", ")}, RECSTATUS = 'A' WHERE ROLEDTLID = :id`,
          { ...flags, id },
        );
      } else {
        const newId = await nextId(c, "UMS", "UMS_ROLEDTL", "ROLEDTLID");
        await c.execute(
          `INSERT INTO UMS.UMS_ROLEDTL (ROLEDTLID, ROLEID, APPID, MODULEID, FEATUREID, ${FLAGS.join(", ")}, RECSTATUS)
           VALUES (:id, :r, :app, :mod, :feat, ${FLAGS.map((k) => `:${k}`).join(", ")}, 'A')`,
          { ...flags, id: newId, r: roleId, app: f.APPID, mod: f.MODULEID, feat: featureId },
        );
      }
    }
    return want.size;
  });
}
