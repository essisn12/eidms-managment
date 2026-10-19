import "server-only";
import { nextId, query, transaction, type Row } from "./db";
import { getTable, hasCol, isLob, isText, pkOf, qualified, type Column, type TableDef } from "./schema";

export type ListParams = {
  search?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  dir?: "asc" | "desc";
  filters?: Record<string, string>;
  includeDeleted?: boolean;
};

// Identifiers below only ever come from schema.generated.json (whitelisted); values are always bound.
const selectCols = (t: TableDef) =>
  t.columns.filter((c) => !isLob(c)).map((c) => c.name).join(", ");

function coerce(c: Column, v: unknown): unknown {
  if (v === "" || v === undefined || v === null) return null;
  if (c.type === "NUMBER" || c.type === "INTEGER" || c.type === "FLOAT") {
    const n = Number(v);
    if (Number.isNaN(n)) throw new Error(`${c.name} must be a number`);
    return n;
  }
  if (c.type === "DATE") {
    const d = new Date(String(v));
    if (Number.isNaN(d.getTime())) throw new Error(`${c.name} must be a valid date`);
    return d;
  }
  return String(v);
}

export async function list(tableKey: string, p: ListParams = {}) {
  const t = getTable(tableKey);
  const pk = pkOf(t);
  const page = Math.max(1, p.page ?? 1);
  const size = Math.min(200, Math.max(1, p.pageSize ?? 20));
  const where: string[] = [];
  const binds: Record<string, unknown> = {};

  if (hasCol(t, "RECSTATUS") && !p.includeDeleted) where.push(`(RECSTATUS IS NULL OR RECSTATUS <> 'D')`);

  if (p.search?.trim()) {
    const cols = t.columns.filter((c) => isText(c) && !c.type.includes("CLOB"));
    if (cols.length) {
      where.push("(" + cols.map((c) => `UPPER(${c.name}) LIKE :search`).join(" OR ") + ")");
      binds.search = `%${p.search.trim().toUpperCase()}%`;
    }
  }
  let i = 0;
  for (const [col, val] of Object.entries(p.filters ?? {})) {
    const c = t.columns.find((x) => x.name === col.toUpperCase());
    if (!c || val === "") continue;
    const b = `f${i++}`;
    where.push(`${c.name} = :${b}`);
    binds[b] = coerce(c, val);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sortCol = t.columns.find((c) => c.name === p.sort?.toUpperCase() && !isLob(c))?.name ?? pk;
  const dir = p.dir === "desc" ? "DESC" : "ASC";

  const [{ N }] = await query<{ N: number }>(`SELECT COUNT(*) AS N FROM ${qualified(t)} ${w}`, binds as never);
  const rows = await query(
    `SELECT ${selectCols(t)} FROM ${qualified(t)} ${w} ORDER BY ${sortCol} ${dir}
     OFFSET :off ROWS FETCH NEXT :lim ROWS ONLY`,
    { ...binds, off: (page - 1) * size, lim: size } as never,
  );
  return { rows, total: Number(N), page, pageSize: size };
}

export async function getOne(tableKey: string, id: string | number) {
  const t = getTable(tableKey);
  const rows = await query(`SELECT ${selectCols(t)} FROM ${qualified(t)} WHERE ${pkOf(t)} = :id`, {
    id: Number(id),
  });
  return rows[0] ?? null;
}

const AUDIT = {
  createdBy: ["CREATED_BY", "CREATE_BY"],
  createdDate: ["CREATED_DATE", "CREATE_DATE"],
  updatedBy: ["UPDATED_BY", "LAST_UPDATE_BY"],
  updatedDate: ["UPDATED_DATE", "LAST_UPDATE_DATE"],
};
const auditCol = (t: TableDef, names: string[]) => names.find((n) => hasCol(t, n));

/** User-editable columns: not the PK, not BLOBs, not audit columns. */
function editable(t: TableDef) {
  const audit = new Set(Object.values(AUDIT).flat());
  return t.columns.filter((c, i) => i > 0 && !isLob(c) && !audit.has(c.name));
}

export async function create(tableKey: string, data: Row, userId: string) {
  const t = getTable(tableKey);
  const pk = pkOf(t);
  return transaction(async (c) => {
    const id = await nextId(c, t.owner, t.name, pk);
    const cols: string[] = [pk];
    const vals: string[] = [":pk"];
    const binds: Record<string, unknown> = { pk: id };
    for (const col of editable(t)) {
      if (!(col.name in data)) continue;
      cols.push(col.name);
      vals.push(`:${col.name.toLowerCase()}`);
      binds[col.name.toLowerCase()] = coerce(col, data[col.name]);
    }
    if (hasCol(t, "RECSTATUS") && !cols.includes("RECSTATUS")) {
      cols.push("RECSTATUS");
      vals.push("'A'");
    }
    const cb = auditCol(t, AUDIT.createdBy);
    const cd = auditCol(t, AUDIT.createdDate);
    if (cb) {
      cols.push(cb);
      vals.push(":cb");
      binds.cb = userId;
    }
    if (cd) {
      cols.push(cd);
      vals.push("SYSDATE");
    }
    await c.execute(`INSERT INTO ${qualified(t)} (${cols.join(", ")}) VALUES (${vals.join(", ")})`, binds as never);
    return id;
  });
}

export async function update(tableKey: string, id: string | number, data: Row, userId: string) {
  const t = getTable(tableKey);
  const sets: string[] = [];
  const binds: Record<string, unknown> = { id: Number(id) };
  for (const col of editable(t)) {
    if (!(col.name in data)) continue;
    sets.push(`${col.name} = :${col.name.toLowerCase()}`);
    binds[col.name.toLowerCase()] = coerce(col, data[col.name]);
  }
  const ub = auditCol(t, AUDIT.updatedBy);
  const ud = auditCol(t, AUDIT.updatedDate);
  if (ub) {
    sets.push(`${ub} = :ub`);
    binds.ub = userId;
  }
  if (ud) sets.push(`${ud} = SYSDATE`);
  if (!sets.length) return 0;
  return transaction(async (c) => {
    const r = await c.execute(
      `UPDATE ${qualified(t)} SET ${sets.join(", ")} WHERE ${pkOf(t)} = :id`,
      binds as never,
    );
    return r.rowsAffected ?? 0;
  });
}

/** Soft delete (RECSTATUS = 'D') when the table has RECSTATUS, otherwise a hard delete. */
export async function remove(tableKey: string, id: string | number, userId: string) {
  const t = getTable(tableKey);
  if (hasCol(t, "RECSTATUS")) return update(tableKey, id, { RECSTATUS: "D" }, userId);
  return transaction(async (c) => {
    const r = await c.execute(`DELETE FROM ${qualified(t)} WHERE ${pkOf(t)} = :id`, { id: Number(id) });
    return r.rowsAffected ?? 0;
  });
}

export type Field = {
  name: string;
  label: string;
  kind: "text" | "textarea" | "number" | "date" | "select";
  required: boolean;
  maxLength?: number;
  lookup?: string;
  options?: { value: string; label: string }[];
};

const label = (n: string) =>
  n
    .split("_")
    .map((w) => w[0] + w.slice(1).toLowerCase())
    .join(" ");

/** Form metadata from the table definition; *_ID columns with a matching lookup table become selects. */
export function fieldsFor(tableKey: string): { pk: string; fields: Field[] } {
  const t = getTable(tableKey);
  const fields: Field[] = editable(t).map((c) => {
    let kind: Field["kind"] = "text";
    let lookup: string | undefined;
    let options: Field["options"];
    if (c.type === "NUMBER" || c.type === "INTEGER") {
      kind = "number";
      if (c.name.endsWith("_ID")) {
        try {
          lookup = getTable(`NSIDB_${c.name.slice(0, -3)}`).name;
          kind = "select";
        } catch {
          /* not a lookup column */
        }
      }
    } else if (c.type === "DATE") kind = "date";
    else if (c.type.includes("CLOB") || Number(c.size) > 500) kind = "textarea";
    if (c.name === "RECSTATUS") {
      kind = "select";
      options = [{ value: "A", label: "Active" }, { value: "I", label: "Inactive" }];
    } else if (/YN$/.test(c.name) && c.type.includes("CHAR")) {
      kind = "select";
      options = [{ value: "Y", label: "Yes" }, { value: "N", label: "No" }];
    }
    return {
      name: c.name,
      label: label(c.name),
      kind,
      lookup,
      options,
      required: !c.nullable && c.default === null,
      maxLength: c.size && /^\d+$/.test(c.size) && c.type.includes("CHAR") ? Number(c.size) : undefined,
    };
  });
  return { pk: pkOf(t), fields };
}

export async function lookupOptions(lookupTable: string) {
  const t = getTable(lookupTable);
  const pk = pkOf(t);
  const labelCol =
    ["NAME_ENGLISH", "NAME", "HOLIDAY_NAME", "CALENDAR_NAME"].find((n) => hasCol(t, n)) ??
    t.columns.find((c, i) => i > 0 && isText(c))?.name ??
    pk;
  const where = hasCol(t, "RECSTATUS") ? `WHERE (RECSTATUS IS NULL OR RECSTATUS <> 'D')` : "";
  const rows = await query<{ V: number; L: string }>(
    `SELECT ${pk} AS V, ${labelCol} AS L FROM ${qualified(t)} ${where} ORDER BY ${labelCol} FETCH FIRST 2000 ROWS ONLY`,
  );
  return rows.map((r) => ({ value: Number(r.V), label: String(r.L ?? r.V) }));
}
