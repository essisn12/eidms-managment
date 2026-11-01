import "server-only";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { dryRun, query, transaction, type Row } from "./db";
import { ClientError } from "./errors";
import { getTable, hasCol } from "./schema";

/*
 * File recovery: the manual fixes from the eIDMS support runbook, as fixed recipes.
 * Every recipe is a list of UPDATE steps on one investigation. Identifiers are constants below (validated against
 * schema.generated.json); only the investigation id is ever bound.
 */

const INV = "NSIDB.NSIDB_INVESTIGATION";
const RES = "NSIDB.NSIDB_INVESTIGATION_RESULT";
const FT = "NSIDB.NSIDB_FILE_TRANSFER";

/** Columns shown in previews so the operator can recognise the rows. */
const SHOW: Record<string, string[]> = {
  [INV]: ["INVESTIGATION_ID", "MEMORANDUM", "RECSTATUS"],
  [RES]: ["INVESTIGATION_RESULT_ID", "RECSTATUS"],
  [FT]: ["FILE_TRANSFER_ID", "SOURCE_USER_LEVEL_ID", "DESTINATION_USER_LEVEL_ID", "RECSTATUS"],
};

type Step = { label: string; table: string; set: Record<string, null | string>; extra?: string };
export type Recipe = {
  key: string;
  title: string;
  description: string;
  /** "handwritten": reconstructed from the handwritten notes in the runbook; verify the preview before running. */
  source: "printed" | "handwritten";
  steps: Step[];
};

// Rows already hidden/deleted ('C'/'D') are left alone.
const ACTIVE = `(RECSTATUS IS NULL OR RECSTATUS NOT IN ('C','D'))`;
const src = (...l: number[]) => `SOURCE_USER_LEVEL_ID IN (${l.join(", ")})`;
const pair = (s: number, d: number) => `(SOURCE_USER_LEVEL_ID = ${s} AND DESTINATION_USER_LEVEL_ID = ${d})`;
const nulls = (...cols: string[]) => Object.fromEntries(cols.map((c) => [c, null]));

const clearDispatch: Step = {
  label: "Clear dispatch no./date on the investigation",
  table: INV,
  set: nulls("DISPATCH_NO", "DISPATCH_DATE"),
};
const hideResult: Step = { label: "Hide the investigation result", table: RES, set: { RECSTATUS: "C" } };
const hideTransfers = (...pairs: [number, number][]): Step => ({
  label: `Hide transfers ${pairs.map(([s, d]) => `${s}→${d}`).join(" and ")}`,
  table: FT,
  set: { RECSTATUS: "C" },
  extra: `(${pairs.map(([s, d]) => pair(s, d)).join(" OR ")})`,
});

export const RECIPES: Recipe[] = [
  {
    key: "back-to-section-approval",
    title: "Back to Section approval",
    description: "File completed in Section approval; bring it back to Section approval.",
    source: "printed",
    steps: [
      clearDispatch,
      { label: "Clear IS_ACCEPTED (source levels 1,2)", table: FT, set: nulls("IS_ACCEPTED"), extra: src(1, 2) },
      { label: "Clear IS_ACCEPTED_SECTION (source levels 1,2,3)", table: FT, set: nulls("IS_ACCEPTED_SECTION"), extra: src(1, 2, 3) },
    ],
  },
  {
    key: "back-to-desk-officer",
    title: "Back to Desk officer",
    description: "File completed in Section approval; return it to the Desk officer.",
    source: "printed",
    steps: [
      clearDispatch,
      {
        label: "Clear acceptance and dispatch flags (source levels 1,2,3)",
        table: FT,
        set: nulls("IS_ACCEPTED", "IS_ACCEPTED_SECTION", "IS_ACCEPTED_OFFICER", "IS_DISPATCH"),
        extra: src(1, 2, 3),
      },
      { label: "Clear dispatch on the investigation result", table: RES, set: nulls("DISPATCH_NO", "IS_DISPATCH") },
    ],
  },
  {
    key: "again-after-dg-return",
    title: "Returned from DG Secretariat, Wing/Section can't see it",
    description: "File was returned from the DG Secretariat but the Wing/Section doesn't receive it.",
    source: "printed",
    steps: [
      { label: "Clear IS_ACCEPTED (source levels 1,2)", table: FT, set: nulls("IS_ACCEPTED"), extra: src(1, 2) },
      { label: "Clear IS_ACCEPTED_SECTION (source levels 1,2,3)", table: FT, set: nulls("IS_ACCEPTED_SECTION"), extra: src(1, 2, 3) },
      { label: "Set IS_AGAIN_INVESTIGATE = N (source levels 1,2,3)", table: FT, set: { IS_AGAIN_INVESTIGATE: "N" }, extra: src(1, 2, 3) },
    ],
  },
  {
    key: "back-to-wing-pending",
    title: "Back to Wing's pending page",
    description: "Return a file to the Wing's pending (distribution) page.",
    source: "printed",
    steps: [
      hideResult,
      hideTransfers([2, 3], [3, 3]),
      {
        label: "Reset receipt and distribution on transfer 1→2",
        table: FT,
        set: nulls("RECEIVED_DATE", "SECTION_ID", "IS_RECEIVED", "IS_DISTRIBUTE", "DISTRIBUTE_DATE"),
        extra: pair(1, 2),
      },
    ],
  },
  {
    key: "back-from-wing-receive",
    title: "Back from Wing's \"Receive\" page",
    description: "Return a file from the Wing's Receive page to the previous stage.",
    source: "handwritten",
    steps: [
      hideResult,
      hideTransfers([2, 3], [3, 3]),
      {
        label: "Reset receipt and distribution on transfer 2→2",
        table: FT,
        set: nulls("IS_RECEIVED", "IS_DISTRIBUTE", "DISTRIBUTE_DATE", "RESPONDING_USER"),
        extra: pair(2, 2),
      },
    ],
  },
  {
    key: "back-to-section-list",
    title: "Back to Section's list",
    description: "Return a file to the Section's list (before its acceptance).",
    source: "handwritten",
    steps: [
      hideResult,
      hideTransfers([3, 3]),
      {
        label: "Reset acceptance and distribution on transfer 2→3",
        table: FT,
        set: nulls("IS_ACCEPTED", "ACCEPTED_DATE", "RESPONDING_USER", "IS_DISTRIBUTE", "DISTRIBUTE_DATE"),
        extra: pair(2, 3),
      },
      {
        label: "Reset acceptance and dispatch on transfer 2→2",
        table: FT,
        set: nulls("IS_ACCEPTED", "ACCEPTED_DATE", "RESPONDING_USER", "IS_DISPATCH"),
        extra: pair(2, 2),
      },
    ],
  },
  {
    key: "hide-file",
    title: "Hide file from DG Secretariat",
    description: "Hide a file (investigation, its result and its transfers) so the software no longer shows it.",
    source: "printed",
    steps: [
      { label: "Hide the investigation", table: INV, set: { RECSTATUS: "C" } },
      hideResult,
      { label: "Hide all transfers", table: FT, set: { RECSTATUS: "C" } },
    ],
  },
];

export const recipeList = () =>
  RECIPES.map(({ key, title, description, source }) => ({ key, title, description, source }));

const recipeByKey = (key: string) => {
  const r = RECIPES.find((x) => x.key === key);
  if (!r) throw new ClientError("Unknown recovery");
  return r;
};

/* ------------------------------------------------------------------ queries */

function assertColumns(step: Step) {
  const t = getTable(step.table);
  const cols = [...Object.keys(step.set), "INVESTIGATION_ID", "RECSTATUS", ...SHOW[step.table]];
  for (const c of cols) if (!hasCol(t, c)) throw new Error(`${step.table} has no column ${c}`);
}

const where = (s: Step) => `INVESTIGATION_ID = :id AND ${ACTIVE}${s.extra ? ` AND ${s.extra}` : ""}`;

const selectSql = (s: Step) => {
  const cols = [...new Set([...SHOW[s.table], ...Object.keys(s.set)])];
  return `SELECT ${cols.join(", ")} FROM ${s.table} WHERE ${where(s)} ORDER BY ${SHOW[s.table][0]}`;
};

const updateSql = (s: Step) =>
  `UPDATE ${s.table} SET ${Object.entries(s.set)
    .map(([c, v]) => `${c} = ${v === null ? "NULL" : `'${v}'`}`)
    .join(", ")} WHERE ${where(s)}`;

export async function searchInvestigations(term: string) {
  const t = term.trim();
  if (!t) return [];
  return query(
    `SELECT INVESTIGATION_ID, MEMORANDUM, MEMORANDUM_DATE, DISPATCH_NO, DISPATCH_DATE, RECSTATUS
       FROM ${INV}
      WHERE RECSTATUS IN ('A', 'C') AND (TO_CHAR(INVESTIGATION_ID) = :t OR UPPER(MEMORANDUM) LIKE :l)
      ORDER BY INVESTIGATION_ID DESC FETCH FIRST 20 ROWS ONLY`,
    { t, l: `%${t.toUpperCase()}%` },
  );
}

export async function getTransfers(investigationId: number) {
  const [inv] = await query(
    `SELECT INVESTIGATION_ID, MEMORANDUM, DISPATCH_NO, DISPATCH_DATE, RECSTATUS FROM ${INV} WHERE INVESTIGATION_ID = :id`,
    { id: investigationId },
  );
  if (!inv) throw new ClientError("Investigation not found", 404);
  const transfers = await query(
    `SELECT FILE_TRANSFER_ID, SOURCE_USER_LEVEL_ID AS SRC, DESTINATION_USER_LEVEL_ID AS DEST, RECSTATUS, IS_RECEIVED,
            IS_ACCEPTED, IS_ACCEPTED_SECTION, IS_ACCEPTED_OFFICER, IS_DISTRIBUTE, IS_DISPATCH, IS_AGAIN_INVESTIGATE, TRANSFER_DATE
       FROM ${FT} WHERE INVESTIGATION_ID = :id ORDER BY FILE_TRANSFER_ID`,
    { id: investigationId },
  );
  return { investigation: inv, transfers };
}

export type StepResult = { label: string; table: string; set: Step["set"]; rows: Row[] };

export async function previewRecovery(recipeKey: string, investigationId: number) {
  const recipe = recipeByKey(recipeKey);
  await getTransfers(investigationId);
  const steps: StepResult[] = [];
  for (const s of recipe.steps) {
    assertColumns(s);
    steps.push({ label: s.label, table: s.table, set: s.set, rows: await query(selectSql(s), { id: investigationId }) });
  }
  return { recipe: { key: recipe.key, title: recipe.title }, steps, dryRun: dryRun() };
}

/** Runs every step in one transaction (rolled back by DB_DRY_RUN) and appends the replaced values to the log file. */
export async function runRecovery(recipeKey: string, investigationId: number, by: string, reason: string) {
  const recipe = recipeByKey(recipeKey);
  const steps = await transaction(async (c) => {
    const exists = await c.execute(`SELECT 1 FROM ${INV} WHERE INVESTIGATION_ID = :id`, { id: investigationId });
    if (!exists.rows?.length) throw new ClientError("Investigation not found", 404);
    const done: StepResult[] = [];
    for (const s of recipe.steps) {
      assertColumns(s);
      const rows = (await c.execute<Row>(selectSql(s), { id: investigationId })).rows ?? [];
      if (rows.length) await c.execute(updateSql(s), { id: investigationId });
      done.push({ label: s.label, table: s.table, set: s.set, rows });
    }
    if (!done.some((d) => d.rows.length)) {
      throw new ClientError("Nothing to change: no matching rows for this recovery on this file", 409);
    }
    return done;
  });

  const entry = { at: new Date().toISOString(), by, reason, recipe: recipe.key, investigationId, dryRun: dryRun(), steps };
  try {
    const dir = path.join(process.cwd(), "logs");
    await mkdir(dir, { recursive: true });
    await appendFile(path.join(dir, "file-recovery.jsonl"), JSON.stringify(entry) + "\n");
  } catch (e) {
    console.error("[file-recovery] could not write the log file", e);
  }
  console.log(`[file-recovery] ${recipe.key} on investigation ${investigationId} by ${by}${dryRun() ? " (DRY RUN, rolled back)" : ""}`);
  return { steps, dryRun: dryRun() };
}
