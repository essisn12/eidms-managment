import "server-only";
import oracledb from "oracledb";

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsString = [oracledb.CLOB, oracledb.NCLOB];

const globalForDb = globalThis as unknown as { oraclePool?: Promise<oracledb.Pool> };

function getPool() {
  globalForDb.oraclePool ??= oracledb.createPool({
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    connectString: process.env.ORACLE_CONNECT_STRING,
    poolMin: 1,
    poolMax: 10,
    poolIncrement: 1,
  });
  return globalForDb.oraclePool;
}

/** Startup health check: logs whether the Oracle DB is reachable. Never throws. */
export async function logDbConnection() {
  const target = `${process.env.ORACLE_USER}@${process.env.ORACLE_CONNECT_STRING}`;
  const started = Date.now();
  try {
    const conn = await oracledb.getConnection({
      user: process.env.ORACLE_USER,
      password: process.env.ORACLE_PASSWORD,
      connectString: process.env.ORACLE_CONNECT_STRING,
    });
    await conn.execute("SELECT 1 FROM DUAL");
    await conn.close();
    console.log(`[db] ✓ Oracle connected (${target}) in ${Date.now() - started}ms`);
    if (dryRun()) console.warn("[db] ⚠ DB_DRY_RUN is ON: all writes are rolled back");
  } catch (e) {
    console.error(`[db] ✗ Oracle NOT connected (${target}): ${(e as Error).message}`);
  }
}

export type Binds = oracledb.BindParameters;
export type Row = Record<string, unknown>;

export async function withConnection<T>(fn: (c: oracledb.Connection) => Promise<T>): Promise<T> {
  const conn = await (await getPool()).getConnection();
  try {
    return await fn(conn);
  } finally {
    await conn.close();
  }
}

export async function query<T = Row>(sql: string, binds: Binds = {}): Promise<T[]> {
  return withConnection(async (c) => {
    const res = await c.execute<T>(sql, binds);
    return res.rows ?? [];
  });
}

/** DB_DRY_RUN=true: every write runs for real (so errors and row counts are genuine) and is then rolled back. */
const dryRun = () => /^(1|true|yes)$/i.test(process.env.DB_DRY_RUN ?? "");

export async function execute(sql: string, binds: Binds = {}) {
  return withConnection(async (c) => {
    if (!dryRun()) return c.execute(sql, binds, { autoCommit: true });
    const res = await c.execute(sql, binds, { autoCommit: false });
    await c.rollback();
    console.log("[db] DRY RUN: write rolled back, nothing saved");
    return res;
  });
}

/** Runs fn inside one transaction; commits on success, rolls back on throw. */
export async function transaction<T>(fn: (c: oracledb.Connection) => Promise<T>): Promise<T> {
  return withConnection(async (c) => {
    try {
      const out = await fn(c);
      if (dryRun()) {
        await c.rollback();
        console.log("[db] DRY RUN: transaction rolled back, nothing saved");
      } else await c.commit();
      return out;
    } catch (e) {
      await c.rollback();
      throw e;
    }
  });
}

/**
 * Allocates the next primary key: the configured sequence, but never lower than MAX(pk)+1 (legacy scripts insert
 * with MAX+1, leaving the sequence behind). Falls back to MAX(pk)+1 when the sequence doesn't exist.
 */
export async function nextId(
  c: oracledb.Connection,
  owner: string,
  table: string,
  pk: string,
): Promise<number> {
  const pattern = process.env.ORACLE_SEQ_PATTERN ?? "{OWNER}.{TABLE}_SEQ";
  const seq = pattern.replace("{OWNER}", owner).replace("{TABLE}", table).replace("{PK}", pk);
  if (!/^[A-Za-z0-9_$.]+$/.test(seq)) throw new Error("Invalid ORACLE_SEQ_PATTERN");
  const maxPlusOne = async () =>
    Number(
      (await c.execute<{ ID: number }>(`SELECT NVL(MAX(TO_NUMBER(${pk})), 0) + 1 AS ID FROM ${owner}.${table}`)).rows![0]
        .ID,
    );
  try {
    const r = await c.execute<{ ID: number }>(`SELECT ${seq}.NEXTVAL AS ID FROM DUAL`);
    return Math.max(Number(r.rows![0].ID), await maxPlusOne());
  } catch (e) {
    if (!String((e as Error).message).includes("ORA-02289")) throw e;
    return maxPlusOne();
  }
}
