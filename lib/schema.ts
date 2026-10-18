import "server-only";
import raw from "./schema.generated.json";

export type Column = {
  name: string;
  type: string;
  size: string | null;
  nullable: boolean;
  default: string | null;
};
export type TableDef = { owner: string; name: string; columns: Column[] };

const tables = raw as unknown as Record<string, TableDef>;
const IDENT = /^[A-Z][A-Z0-9_$]*$/;

/** Looks up a table by "OWNER.NAME" or bare name (NSIDB assumed). Throws on unknown tables. */
export function getTable(key: string): TableDef {
  const full = key.includes(".") ? key.toUpperCase() : `NSIDB.${key.toUpperCase()}`;
  const t = tables[full];
  if (!t || !IDENT.test(t.owner) || !IDENT.test(t.name)) throw new Error(`Unknown table ${key}`);
  return t;
}

export const pkOf = (t: TableDef) => t.columns[0].name;
export const qualified = (t: TableDef) => `${t.owner}.${t.name}`;
export const isLob = (c: Column) => c.type === "BLOB";
export const isText = (c: Column) => /CHAR/.test(c.type) || c.type.includes("CLOB");
export const hasCol = (t: TableDef, n: string) => t.columns.some((c) => c.name === n);
