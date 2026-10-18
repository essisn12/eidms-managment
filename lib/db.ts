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

export async function execute(sql: string, binds: Binds = {}) {
  return withConnection((c) => c.execute(sql, binds, { autoCommit: true }));
}

/** Runs fn inside one transaction; commits on success, rolls back on throw. */
export async function transaction<T>(fn: (c: oracledb.Connection) => Promise<T>): Promise<T> {
  return withConnection(async (c) => {
    try {
      const out = await fn(c);
      await c.commit();
      return out;
    } catch (e) {
      await c.rollback();
      throw e;
    }
  });
}

/** Allocates the next primary key: configured sequence first, MAX(pk)+1 as fallback. */
export async function nextId(
  c: oracledb.Connection,
  owner: string,
  table: string,
  pk: string,
): Promise<number> {
  const pattern = process.env.ORACLE_SEQ_PATTERN ?? "{OWNER}.{TABLE}_SEQ";
  const seq = pattern.replace("{OWNER}", owner).replace("{TABLE}", table).replace("{PK}", pk);
  if (!/^[A-Za-z0-9_$.]+$/.test(seq)) throw new Error("Invalid ORACLE_SEQ_PATTERN");
  try {
    const r = await c.execute<{ ID: number }>(`SELECT ${seq}.NEXTVAL AS ID FROM DUAL`);
    return Number(r.rows![0].ID);
  } catch (e) {
    if (!String((e as Error).message).includes("ORA-02289")) throw e;
    const r = await c.execute<{ ID: number }>(
      `SELECT NVL(MAX(${pk}), 0) + 1 AS ID FROM ${owner}.${table}`,
    );
    return Number(r.rows![0].ID);
  }
}
