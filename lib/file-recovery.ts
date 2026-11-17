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
    description: "File completed or dispatched from Section approval; bring it back to Section approval.",
    source: "printed",
    steps: [
      clearDispatch,
      { label: "Clear IS_ACCEPTED (source levels 1,2)", table: FT, set: nulls("IS_ACCEPTED"), extra: src(1, 2) },
      { label: "Clear IS_ACCEPTED_SECTION (source levels 1,2,3)", table: FT, set: nulls("IS_ACCEPTED_SECTION"), extra: src(1, 2, 3) },
      // A dispatched file keeps IS_DISPATCH on its transfers; without clearing it the section can't work on the file again.
      { label: "Clear IS_DISPATCH (source levels 1,2,3)", table: FT, set: nulls("IS_DISPATCH"), extra: src(1, 2, 3) },
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

/** Plain-language guidance shown when an option is selected. */
const GUIDE: Record<string, { useWhen: string; result: string; note: string }> = {
  "back-to-section-approval": {
    useWhen: "The file was approved and dispatched from Section approval, but the section still needs to review, correct or re-approve it.",
    result: "The file shows as waiting for approval again in the same section. Earlier stages and history stay as they are.",
    note: "Works for files that were already dispatched: the dispatch number, date and dispatch flag are cleared (kept only in the recovery log). A new number is issued when it is dispatched again.",
  },
  "back-to-desk-officer": {
    useWhen: "The file was completed in Section approval, but the Desk officer must rework it before it goes forward again.",
    result: "The file goes back to the Desk officer: acceptance and dispatch are cleared on the section transfers and on the result.",
    note: "Goes one step further back than Section approval, so the officer and the section both have to act again. Dispatch details are erased (kept in the log).",
  },
  "again-after-dg-return": {
    useWhen: "The DG Secretariat returned the file for re-investigation, but the Wing or Section cannot see it.",
    result: "The file is marked as returned for re-investigation and its acceptance is cleared, so the Wing/Section can see and receive it.",
    note: "Nothing is hidden and no dispatch data is touched. Only acceptance flags are cleared and the re-investigate flag is set to N.",
  },
  "back-to-wing-pending": {
    useWhen: "The file was sent on from the Wing by mistake and must return to the Wing's pending (distribution) page.",
    result: "The Wing sees the file as received but not yet distributed, so it can be distributed again, to the right section this time.",
    note: "The Wing → Section and Section → Section transfers and the result are hidden. They stay in the history but are no longer used.",
  },
  "back-from-wing-receive": {
    useWhen: "The file is on the Wing's Receive page and must go back to the previous stage.",
    result: "The Wing's receipt and distribution are reset, so the file is no longer on the Receive page.",
    note: "Reconstructed from handwritten notes: check the preview carefully. The Wing → Section and Section → Section transfers and the result are hidden.",
  },
  "back-to-section-list": {
    useWhen: "The file must return to the Section's list, before it was accepted there.",
    result: "The section sees the file as newly arrived and has to accept it again.",
    note: "Reconstructed from handwritten notes: check the preview carefully. The Section → Section transfer and the result are hidden; acceptance is reset on the earlier transfers.",
  },
  "hide-file": {
    useWhen: "The file must disappear from the software completely, for example a duplicate or wrongly created file.",
    result: "The file, its result and all its transfers are hidden, and nobody can see or search for it any more.",
    note: "The data is not deleted and can be restored from the recovery log, but the software will no longer show it. Use with care.",
  },
};

export const recipeList = () =>
  RECIPES.map(({ key, title, description, source, steps }) => ({
    key, title, description, source,
    ...(GUIDE[key] ?? { useWhen: "", result: "", note: "" }),
    steps: steps.map(({ label, table, set }) => ({ label, table, set })),
  }));

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

/** Only rows where at least one column would actually change, so previews and counts never include no-ops. */
const differs = (s: Step) =>
  `(${Object.entries(s.set).map(([c, v]) => (v === null ? `${c} IS NOT NULL` : `(${c} IS NULL OR ${c} <> '${v}')`)).join(" OR ")})`;

const where = (s: Step) => `INVESTIGATION_ID = :id AND ${ACTIVE}${s.extra ? ` AND ${s.extra}` : ""} AND ${differs(s)}`;

/** Wing/section names (instead of bare ids) for file-transfer rows. */
const WING_SECTION_NAMES = `(SELECT w.NAME_ENGLISH FROM NSIDB.NSIDB_WING w WHERE w.WING_ID = ${FT}.WING_ID AND ROWNUM = 1) AS WING,
            (SELECT x.NAME_ENGLISH FROM NSIDB.NSIDB_SECTION x WHERE x.SECTION_ID = ${FT}.SECTION_ID AND ROWNUM = 1) AS SECTION`;

/** User level as "Name (id)": the runbook refers to levels by number, so keep the id next to the name. */
const levelName = (col: string, alias: string) =>
  `(SELECT l.USER_LEVEL_NAME || ' (' || ${FT}.${col} || ')' FROM NSIDB.NSIDB_USER_LEVEL l WHERE l.USER_LEVEL_ID = ${FT}.${col} AND ROWNUM = 1) AS ${alias}`;
/** File type of the transfer (each section files it under its own type). */
const TYPE_NAME = `(SELECT NVL(t.NAME_ENGLISH, t.NAME_BANGLA) FROM NSIDB.NSIDB_INVESTIGATION_TYPE t WHERE t.INVESTIGATION_TYPE_ID = ${FT}.INVESTIGATION_TYPE_ID AND ROWNUM = 1) AS FILE_TYPE`;
const TRANSFER_NAMES = `${levelName("SOURCE_USER_LEVEL_ID", "SRC")}, ${levelName("DESTINATION_USER_LEVEL_ID", "DEST")},
            ${WING_SECTION_NAMES}, ${TYPE_NAME}`;

const selectSql = (s: Step) => {
  const raw = ["SOURCE_USER_LEVEL_ID", "DESTINATION_USER_LEVEL_ID"];
  const cols: string[] = [...new Set([...SHOW[s.table], ...Object.keys(s.set)])].filter((c) => s.table !== FT || !raw.includes(c));
  if (s.table === FT) cols.splice(1, 0, TRANSFER_NAMES);
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
    `SELECT INVESTIGATION_ID, MEMORANDUM, SUBJECT, MEMORANDUM_DATE, DISPATCH_NO, DISPATCH_DATE, RECSTATUS,
            (SELECT LISTAGG(DISTINCT NVL(t.NAME_ENGLISH, t.NAME_BANGLA), ', ') WITHIN GROUP (ORDER BY NVL(t.NAME_ENGLISH, t.NAME_BANGLA))
               FROM ${FT} f JOIN NSIDB.NSIDB_INVESTIGATION_TYPE t ON t.INVESTIGATION_TYPE_ID = f.INVESTIGATION_TYPE_ID
              WHERE f.INVESTIGATION_ID = ${INV}.INVESTIGATION_ID AND (f.RECSTATUS IS NULL OR f.RECSTATUS NOT IN ('C','D'))) AS FILE_TYPE
       FROM ${INV}
      WHERE RECSTATUS IN ('A', 'C') AND (TO_CHAR(INVESTIGATION_ID) = :t OR UPPER(MEMORANDUM) LIKE :l)
      ORDER BY INVESTIGATION_ID DESC FETCH FIRST 20 ROWS ONLY`,
    { t, l: `%${t.toUpperCase()}%` },
  );
}

const isYes = (v: unknown) => v !== null && v !== undefined && v !== "" && v !== "N";
const at = (r: Row) => (r.SECTION && r.SECTION !== "—" ? `${r.DEST}, ${r.WING ?? ""} / ${r.SECTION}` : r.WING ? `${r.DEST}, ${r.WING}` : String(r.DEST ?? "—"));

/** What the flags of the newest live transfer say about the file's stage. */
function stageOf(t: Row, dispatched: boolean) {
  if (dispatched) return "Dispatched";
  if (isYes(t.IS_ACCEPTED_OFFICER)) return "Accepted by desk officer";
  if (isYes(t.IS_ACCEPTED_SECTION)) return "Accepted by section";
  if (isYes(t.IS_ACCEPTED)) return "Accepted";
  if (isYes(t.IS_DISTRIBUTE)) return "Distributed, awaiting acceptance";
  if (isYes(t.IS_RECEIVED)) return "Received, awaiting distribution";
  return "Sent, not yet received";
}

/** Full travel history (every transfer, including hidden ones) plus a derived summary of where the file is now. */
export async function getTransfers(investigationId: number) {
  const [inv] = await query(
    `SELECT INVESTIGATION_ID, MEMORANDUM, SUBJECT, MEMORANDUM_DATE, DISPATCH_NO, DISPATCH_DATE, RECSTATUS FROM ${INV} WHERE INVESTIGATION_ID = :id`,
    { id: investigationId },
  );
  if (!inv) throw new ClientError("Investigation not found", 404);
  const transfers = await query(
    `SELECT FILE_TRANSFER_ID, ${TRANSFER_NAMES}, RECSTATUS, IS_RECEIVED,
            IS_ACCEPTED, IS_ACCEPTED_SECTION, IS_ACCEPTED_OFFICER, IS_DISTRIBUTE, IS_DISPATCH, IS_AGAIN_INVESTIGATE, IS_RETURN,
            TRANSFER_DATE, RECEIVED_DATE, DISTRIBUTE_DATE, ACCEPTED_DATE, CREATED_BY, RESPONDING_USER, REMARKS
       FROM ${FT} WHERE INVESTIGATION_ID = :id ORDER BY NVL(TRANSFER_DATE, CREATED_DATE), FILE_TRANSFER_ID`,
    { id: investigationId },
  );
  const [res] = await query(
    `SELECT COUNT(*) AS N FROM ${RES} WHERE INVESTIGATION_ID = :id AND ${ACTIVE}`,
    { id: investigationId },
  );
  const live = transfers.filter((t) => t.RECSTATUS !== "C" && t.RECSTATUS !== "D");
  const cur = live[live.length - 1];
  const hidden = inv.RECSTATUS === "C";
  const dispatched = isYes(inv.DISPATCH_NO);
  const summary = {
    hidden,
    dispatched,
    totalTransfers: transfers.length,
    liveTransfers: live.length,
    hiddenTransfers: transfers.length - live.length,
    returns: live.filter((t) => isYes(t.IS_RETURN) || isYes(t.IS_AGAIN_INVESTIGATE)).length,
    fileTypes: [...new Set(live.map((t) => t.FILE_TYPE).filter(Boolean))].join(", "),
    hasResult: Number((res as Row | undefined)?.N ?? 0) > 0,
    firstSent: transfers[0]?.TRANSFER_DATE ?? null,
    lastMoved: cur?.TRANSFER_DATE ?? null,
    location: hidden ? "Hidden from the software" : cur ? at(cur) : "No active transfer",
    stage: hidden ? "Hidden" : cur ? stageOf(cur, dispatched) : "Not transferred",
    route: live.map((t) => String(t.DEST ?? "—").replace(/ \(\d+\)$/, "")),
  };
  return { investigation: inv, transfers, summary };
}

/**
 * Which list the file sits in right now, from the flags of its newest live transfer. This follows the stage names in the
 * support runbook (Wing receive/pending, Section list, Desk officer, Section approval); the app's own list queries are not
 * visible from here, so treat it as a best reading of the flags.
 */
const STAGES = [
  { key: "wing-receive", action: "Receive the file", where: "Wing", when: "Sent to the Wing, not yet received", list: "Wing: receive list (waiting)" },
  { key: "wing-pending", action: "Distribute the file to a section", where: "Wing", when: "Received, waiting to be distributed", list: "Wing: pending list" },
  { key: "wing-done", action: "Nothing: waiting on the section", where: "Wing", when: "Distributed to a section", list: "Wing: distributed" },
  { key: "sec-waiting", action: "Receive the file", where: "Section", when: "Sent to the Section, not yet received", list: "Section: waiting list" },
  { key: "sec-list", action: "Accept the file", where: "Section", when: "Received, waiting to be accepted", list: "Section: list (pending acceptance)" },
  { key: "desk", action: "Desk officer to work on and accept it", where: "Section", when: "Accepted by the section, waiting for the desk officer", list: "Desk officer: pending list" },
  { key: "sec-approval", action: "Approve the file, then dispatch", where: "Section", when: "Desk officer accepted, waiting for section approval", list: "Section: approval list (pending)" },
  { key: "sec-approved", action: "Dispatch the file", where: "Section", when: "Approved by the section", list: "Section: approved list" },
  { key: "dispatched", action: "Nothing: finished", where: "Any", when: "Dispatched", list: "Dispatched" },
] as const;

function listOf(t: Row, dispatched: boolean, hidden: boolean): { key: string; list: string; state: string; action: string } {
  const pick = (key: (typeof STAGES)[number]["key"]) => {
    const s = STAGES.find((x) => x.key === key)!;
    return { key, list: s.list, state: s.when, action: s.action };
  };
  if (hidden) return { key: "hidden", list: "None (file is hidden)", state: "Hidden from the software", action: "Nothing: file is hidden" };
  if (dispatched || isYes(t.IS_DISPATCH)) return pick("dispatched");
  const lvl = Number(t.LVL);
  if (lvl === 2) return pick(isYes(t.IS_DISTRIBUTE) ? "wing-done" : isYes(t.IS_RECEIVED) ? "wing-pending" : "wing-receive");
  if (lvl === 3) {
    if (isYes(t.IS_ACCEPTED_SECTION)) return pick("sec-approved");
    if (isYes(t.IS_ACCEPTED_OFFICER)) return pick("sec-approval");
    if (isYes(t.IS_ACCEPTED)) return pick("desk");
    return pick(isYes(t.IS_RECEIVED) ? "sec-list" : "sec-waiting");
  }
  return { key: "other", list: `Level ${lvl || "?"} list`, state: "Stage not mapped", action: "Unknown for this stage" };
}

/** Which user ids can see the file now (active users whose level, branch, wing and section equal the live transfer's) and in which list. */
export async function whoCanSee(investigationId: number) {
  const [inv] = await query(`SELECT DISPATCH_NO, RECSTATUS FROM ${INV} WHERE INVESTIGATION_ID = :id`, { id: investigationId });
  if (!inv) throw new ClientError("Investigation not found", 404);
  const [t] = await query(
    `SELECT * FROM (SELECT FILE_TRANSFER_ID, DESTINATION_USER_LEVEL_ID AS LVL, BRANCH_ID, WING_ID, SECTION_ID, RESPONDING_USER, CREATED_BY,
            IS_RECEIVED, IS_ACCEPTED, IS_ACCEPTED_SECTION, IS_ACCEPTED_OFFICER, IS_DISTRIBUTE, IS_DISPATCH
       FROM ${FT} WHERE INVESTIGATION_ID = :id AND ${ACTIVE} ORDER BY NVL(TRANSFER_DATE, CREATED_DATE) DESC, FILE_TRANSFER_ID DESC) WHERE ROWNUM = 1`,
    { id: investigationId },
  );
  const hidden = inv.RECSTATUS === "C";
  if (!t) return { key: "none", list: "None", state: "No active transfer", action: "Nothing", users: [] as Row[], handledBy: null, sentBy: null, stages: STAGES };
  const users = hidden
    ? []
    : await query(
        `SELECT p.USER_NAME AS USERID, p.USER_NAME_ENGLISH AS NAME,
                (SELECT d.NAME_ENGLISH FROM NSIDB.NSIDB_DESIGNATION d WHERE d.DESIGNATION_ID = p.DESIGNATION_ID AND ROWNUM = 1) AS DESIGNATION
           FROM NSIDB.NSIDB_USER_PERMISION p
           JOIN UMS.UMS_USERINFO u ON UPPER(u.USERID) = UPPER(p.USER_NAME) AND u.RECSTATUS = 'A'
          WHERE p.RECSTATUS = 'A' AND p.USER_LEVEL_ID = :lvl AND p.BRANCH_ID = :br AND p.WING_ID = :wg AND p.SECTION_ID = :sec
          ORDER BY p.USER_NAME FETCH FIRST 50 ROWS ONLY`,
        { lvl: Number(t.LVL), br: Number(t.BRANCH_ID), wg: Number(t.WING_ID), sec: Number(t.SECTION_ID) },
      );
  const person = async (id: unknown) => {
    if (!id) return null;
    const [p] = await query(`SELECT USER_NAME_ENGLISH AS NAME FROM NSIDB.NSIDB_USER_PERMISION WHERE UPPER(USER_NAME) = UPPER(:u) AND RECSTATUS = 'A' AND ROWNUM = 1`, { u: String(id) });
    return { userId: String(id), name: p?.NAME ? String(p.NAME) : null };
  };
  return {
    ...listOf(t, isYes(inv.DISPATCH_NO), hidden),
    users,
    handledBy: await person(t.RESPONDING_USER),
    sentBy: await person(t.CREATED_BY),
    stages: STAGES,
  };
}

/**
 * Compares users' permission (level, branch, wing, section) with the file's live transfers, to explain why one user
 * sees a file and another does not. A user is "addressed" when a live transfer's destination level, wing and section
 * all equal theirs. (The eIDMS app's own list queries are not visible from here, so this is a diagnostic aid.)
 */
export async function compareAccess(investigationId: number, userIds: string[]) {
  const live = await query(
    `SELECT FILE_TRANSFER_ID, DESTINATION_USER_LEVEL_ID AS LVL, BRANCH_ID, WING_ID, SECTION_ID, RESPONDING_USER, ${TRANSFER_NAMES}
       FROM ${FT} WHERE INVESTIGATION_ID = :id AND ${ACTIVE} ORDER BY FILE_TRANSFER_ID`,
    { id: investigationId },
  );
  const users = [];
  for (const userId of userIds) {
    const [p] = await query(
      `SELECT p.USER_NAME, p.USER_LEVEL_ID AS LVL, p.BRANCH_ID, p.WING_ID, p.SECTION_ID, p.RECSTATUS,
              (SELECT l.USER_LEVEL_NAME FROM NSIDB.NSIDB_USER_LEVEL l WHERE l.USER_LEVEL_ID = p.USER_LEVEL_ID AND ROWNUM = 1) AS LEVEL_NAME,
              (SELECT w.NAME_ENGLISH FROM NSIDB.NSIDB_WING w WHERE w.WING_ID = p.WING_ID AND ROWNUM = 1) AS WING,
              (SELECT x.NAME_ENGLISH FROM NSIDB.NSIDB_SECTION x WHERE x.SECTION_ID = p.SECTION_ID AND ROWNUM = 1) AS SECTION
         FROM NSIDB.NSIDB_USER_PERMISION p
        WHERE UPPER(p.USER_NAME) = UPPER(:u) AND p.RECSTATUS = 'A' FETCH FIRST 1 ROWS ONLY`,
      { u: userId },
    );
    if (!p) {
      users.push({ userId, found: false as const });
      continue;
    }
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    const checks = live.map((t) => ({
      transfer: Number(t.FILE_TRANSFER_ID),
      route: `${t.SRC} → ${t.DEST}`,
      level: num(t.LVL) === num(p.LVL),
      branch: num(t.BRANCH_ID) === num(p.BRANCH_ID),
      wing: num(t.WING_ID) === num(p.WING_ID),
      section: num(t.SECTION_ID) === num(p.SECTION_ID),
      handledBy: t.RESPONDING_USER ?? null,
    }));
    const [acct] = await query(`SELECT RECSTATUS FROM UMS.UMS_USERINFO WHERE UPPER(USERID) = UPPER(:u)`, { u: userId });
    const [des] = await query(
      `SELECT d.NAME_ENGLISH FROM NSIDB.NSIDB_DESIGNATION d JOIN NSIDB.NSIDB_USER_PERMISION p ON p.DESIGNATION_ID = d.DESIGNATION_ID
        WHERE UPPER(p.USER_NAME) = UPPER(:u) AND p.RECSTATUS = 'A' AND ROWNUM = 1`,
      { u: userId },
    );
    const [cnt] = await query(`SELECT COUNT(*) AS N FROM NSIDB.NSIDB_USER_PERMISION WHERE UPPER(USER_NAME) = UPPER(:u) AND RECSTATUS = 'A'`, { u: userId });
    const roles = await query(
      `SELECT r.ROLENAME FROM UMS.UMS_ROLEASSIGN a JOIN UMS.UMS_ROLE r ON r.ROLEID = a.ROLEID
        WHERE UPPER(a.USERID) = UPPER(:u) AND a.RECSTATUS = 'A' ORDER BY r.ROLENAME`,
      { u: userId },
    );
    users.push({
      userId,
      found: true as const,
      account: String(acct?.RECSTATUS ?? "?"),
      designation: String(des?.NAME_ENGLISH ?? "—"),
      permissionRecords: Number(cnt?.N ?? 0),
      roles: roles.map((r) => String(r.ROLENAME)),
      level: `${p.LEVEL_NAME ?? "?"} (${p.LVL})`,
      wing: p.WING ?? String(p.WING_ID),
      section: p.SECTION ?? String(p.SECTION_ID),
      addressed: checks.some((c) => c.level && c.wing && c.section),
      checks,
    });
  }
  return { users };
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
