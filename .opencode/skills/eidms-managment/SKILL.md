---
name: eidms-managment
description: Use this skill whenever working in the eidms-managment repository (the EIDMS Management admin console). It contains a pre-built map of the Next.js 16 + Oracle codebase: architecture, file map, data model, auth/session flow, generic CRUD engine, file-recovery recipes, commands, and known pitfalls. Load it before exploring or changing this project so you do not have to re-scan every file. Trigger for any task mentioning eidms, EIDMS Management, UMS, NSIDB, master data, file recovery, Oracle login, users/roles/sessions, or this repo's Next.js admin console.
---

# EIDMS Management — Project Map

This is a Next.js admin console for a legacy Oracle-based eIDMS system (investigation / document management). It manages `NSIDB_*` master data, `UMS_*` users/roles/sessions/configuration, and a set of investigation file-recovery recipes.

Read this first. Only open the specific files a task needs.

## Stack

- Next.js **16.4.2** App Router, React **19.3**, TypeScript strict
- Turbopack, `cacheComponents`, `partialPrefetching`
- Tailwind **4**, shadcn `base-nova`, Base UI, lucide, sonner
- Zod 4, `jose` JWT, `bcryptjs`
- Oracle via `oracledb` 26, thin mode, raw SQL
- No ORM, no test runner, no CI

## Commands

```bash
npm run dev
npm run build
npm run start
npm run lint          # eslint with no args (passes)
npx tsc --noEmit      # typecheck
```

`npm run build`, `npx tsc --noEmit`, and `npx eslint .` are the verification baseline. There are no tests.

## Repo map

```text
app/
  layout.tsx                     root layout, fonts, Toaster
  globals.css                    Tailwind 4 + shadcn theme tokens
  login/                         login page + client form
  (app)/
    layout.tsx                   requireUser() + sidebar shell (Suspense-wrapped)
    dashboard/page.tsx           module cards
    master/page.tsx              28 master tables, grouped
    master/[table]/page.tsx      generic MasterManager
    admin/layout.tsx             requireAdmin() + admin nav
    admin/page.tsx               redirect -> /admin/users
    admin/users/page.tsx         UsersManager
    admin/roles/page.tsx         generic MasterManager on UMS_ROLE
    admin/roles/[id]/permissions/page.tsx  RolePermissions
    admin/sessions/page.tsx      SessionsViewer
    admin/file-recovery/page.tsx FileRecovery
    admin/config/page.tsx        8 UMS config tables
    admin/config/[table]/page.tsx generic MasterManager
  api/
    auth/login|logout
    master/[table]                GET list, POST create
    master/[table]/[id]           GET, PUT, DELETE
    master/[table]/meta           form fields + lookup options
    admin/users                   GET list, POST create
    admin/users/[id]              GET, PUT, DELETE
    admin/users/[id]/actions      reset-password | extend-expiry | unlock
    admin/roles/[id]/permissions  GET, PUT
    admin/sessions                GET list
    admin/sessions/[id]           GET activity
    admin/lookups                 GET categories/roles/levels/branches/wings/sections/designations
    admin/file-recovery           GET recipes + search
    admin/file-recovery/[id]      GET state/preview, POST apply
components/
  app-sidebar.tsx                nav + logout
  admin/                         users, roles, sessions, file recovery, nav
  master/master-manager.tsx      generic list/create/edit/delete UI
  ui/                            shadcn/Base UI primitives
lib/
  db.ts                          Oracle pool, query/execute/transaction, nextId, dryRun
  schema.ts                      reads schema.generated.json, validates identifiers
  schema.generated.json          174 tables (148 NSIDB + 26 UMS) parsed from DDL
  crud.ts                        generic list/get/create/update/remove, fieldsFor, lookups
  api.ts                         json/guards/errorResponse
  auth.ts                        verifyLogin, requireUser
  session.ts                     JWT cookie (eidms_session, 8h)
  admin.ts                       isAdmin (UMS_ADMIN_ROLE_IDS), requireAdmin
  ums.ts                         users, passwords, roles, permissions, sessions
  ums-schemas.ts                 Zod bodies + DEFAULT_PASSWORD
  master-config.ts               28 master table whitelist
  ums-config.ts                  8 UMS config whitelist
  file-recovery.ts               7 fixed recovery recipes + audit log
  errors.ts                      ClientError
proxy.ts                         Next 16 proxy (middleware): cookie-presence gate
instrumentation.ts               startup DB health log
scripts/parse-schema.mjs         DDL -> lib/schema.generated.json
```

## Request flow

```text
Browser
  -> proxy.ts                 cookie presence only (not JWT verification)
  -> (app)/layout.tsx         requireUser() -> redirect /login
  -> /admin/layout.tsx        requireAdmin() -> redirect /dashboard
  -> API route                guardUser / guardAdmin / guardTable
  -> lib/crud.ts | lib/ums.ts | lib/file-recovery.ts
  -> lib/db.ts                Oracle
```

- Pages use server components for auth/layout; tables/dialogs are client components.
- Every API route guards itself. `proxy.ts` excludes `/api`.
- `guardTable` allows any authenticated user to use `MASTER_TABLES`; `UMS_TABLES` are admin-only.
- Admin = a role ID in `UMS_ADMIN_ROLE_IDS`; roles come from the JWT, not a fresh DB read.

## Data model essentials

- `UMS.UMS_USERINFO` — PK `USERID` (VARCHAR2). Unique `USERID`, `EMAIL`, `CELLNO`. Soft delete `RECSTATUS='D'`.
- `UMS.UMS_PASS` — password history. One `RECSTATUS='A'` row per user; `USERPASS` bcrypt, `EXPIREDATE` DATE.
- `UMS.UMS_LOGINFAILURETEMP` — failed attempts. **`USERID` has FK to `UMS_USERINFO(USERID)`**, so only known users can be logged; FK comparison is case-sensitive. Uses `ID`, `IPADDRESS` VARCHAR2(39).
- `UMS.UMS_ROLE`, `UMS_ROLEASSIGN`, `UMS_FEATURECONFIG`, `UMS_ROLEDTL` — roles and feature grants.
- `UMS.UMS_USERSESSION`, `UMS_USERSESSIONLOG` — legacy session/activity tables. This console **reads** them but never writes them.
- `UMS.UMS_PASSPOLICY` — policy row; `RECSTATUS='A'`, prefer `APPID IS NULL`.
- `NSIDB.NSIDB_USER_PERMISION` — org placement (`USER_NAME`, level/branch/wing/section/designation).
- `NSIDB.NSIDB_INVESTIGATION`, `NSIDB_INVESTIGATION_RESULT`, `NSIDB_FILE_TRANSFER` — file recovery targets.
- Master tables are `NSIDB.*`; `lib/schema.generated.json` is the source of truth for columns.

### Generic CRUD invariants

- `pkOf(t)` is **the first column** in the generated schema. Keep that assumption in mind when touching DDL parsing.
- `editable(t)` = columns after the first, excluding BLOBs and audit columns (`CREATED_BY/CREATE_BY`, `CREATED_DATE/CREATE_DATE`, `UPDATED_BY/LAST_UPDATE_BY`, `UPDATED_DATE/LAST_UPDATE_DATE`).
- `create` allocates IDs with `nextId`; `update` only writes keys present in the body; `remove` soft-deletes when `RECSTATUS` exists, otherwise hard-deletes.
- `list` supports `q`, `page`, `pageSize` (max 200), `sort`, `dir`, `f_<COL>` filters; hides `RECSTATUS='D'`; searches text columns with `UPPER(...) LIKE`.
- `fieldsFor` derives form metadata; `*_ID` columns become selects when `NSIDB_<prefix>` exists; `RECSTATUS` becomes A/I; `*YN` CHAR becomes Y/N.
- All SQL identifiers come from the generated schema or constants; all values are bound. Do not interpolate request data.
- `nextId` tries `ORACLE_SEQ_PATTERN` (default `{OWNER}.{TABLE}_SEQ`), then falls back to `MAX(pk)+1`. Legacy UMS sequences use names like `UMS_Role_RoleID_SEQ`, so the default often falls back.

## Auth and session behavior

- Login: lockout check -> user + active password lookup -> `bcrypt.compare` -> record failure or clear failures -> read roles -> sign JWT.
- Login lookup uses `LEFT JOIN UMS_PASS` so a known user with no active password is still found. **Only record a failure when the user row exists**, and bind the stored `USERID` (canonical case) — otherwise Oracle raises `ORA-02291` on the FK.
- Failure recording catches `ORA-02291` for the race where the user is deleted between lookup and insert.
- Unknown-user attempts are not recorded (the FK makes it impossible); they are therefore not covered by the per-user lockout. Add IP-based throttling if that matters.
- Session: HS256 JWT in `eidms_session`, `httpOnly`, `SameSite=Lax`, `Secure` in production, 8 hours.
- `requireUser()` only checks the JWT. It does **not** block expired passwords.
- Password expiry: `passwordExpired` is returned by login, but `app/login/login-form.tsx` redirects to `/account/password`, which **does not exist**. There is no self-service password-change API/page.
- `DEFAULT_PASSWORD = "123456"` forces expiry (`EXPIREDATE = SYSDATE - 1`).

## File recovery

- `lib/file-recovery.ts` contains 7 fixed recipes: back-to-section-approval, back-to-desk-officer, again-after-dg-return, back-to-wing-pending, back-from-wing-receive, back-to-section-list, hide-file.
- Each recipe is a list of `UPDATE` steps on `NSIDB_INVESTIGATION`, `NSIDB_INVESTIGATION_RESULT`, `NSIDB_FILE_TRANSFER`.
- `previewRecovery` shows old values; `runRecovery` applies all steps in one transaction, then appends the old rows + reason to `logs/file-recovery.jsonl`.
- `DB_DRY_RUN=true` executes and rolls back every write; the file-recovery UI shows a dry-run banner.
- Recipes marked `source: "handwritten"` came from the runbook notes and should be verified against the preview.

## Environment

See `.env.example`:

```text
ORACLE_USER, ORACLE_PASSWORD, ORACLE_CONNECT_STRING
ORACLE_SEQ_PATTERN
SESSION_SECRET                  # >= 32 chars; not validated at startup
UMS_ADMIN_ROLE_IDS              # comma-separated ROLEID values
LOGIN_MAX_FAILURES, LOGIN_LOCK_MINUTES
DB_DRY_RUN
```

`.env.local` is gitignored; `.env.example` is committed.

## Known pitfalls (check before changing related code)

1. **ORA-02291 on login failure** — `UMS_LOGINFAILURETEMP.USERID` FK to `UMS_USERINFO.USERID`. Never insert a failure row for an unknown user or with a different case; use the stored `USERID`.
2. **Password expiry is unfinished** — `/account/password` is missing; expired users are not blocked from the app.
3. **Stale cookie redirect loop** — `proxy.ts` redirects `/login` -> `/dashboard` on cookie presence, while `requireUser()` redirects invalid JWTs back to `/login`. Secret rotation triggers this.
4. **Oracle pool caches a rejected promise** — `globalForDb.oraclePool ??= createPool(...)`; a failed startup stays failed until restart.
5. **`nextId` usually falls back to `MAX+1`** — legacy sequence names do not match the default pattern; concurrent inserts can collide.
6. **Legacy `RECSTATUS='P'`** — `UMS_ROLE`, `UMS_CATEGORY`, `UMS_NOTIFICATION_TYPE` default to `P`, but forms only offer `A`/`I`; editing a `P` row can submit `NULL`/fail validation.
7. **Paging params** — `Number("abc")` becomes `NaN`; clamp `page`/`pageSize` before binding.
8. **Sessions viewer is legacy data** — the console does not write `UMS_USERSESSION`/`UMS_USERSESSIONLOG`.
9. **Role permissions are not enforced by this console** — `UMS_ROLEDTL` is edited for the legacy app; only `UMS_ADMIN_ROLE_IDS` governs the console.
10. **No audit for user/role changes** — generic master CRUD writes audit columns when present, but UMS user/role changes do not.
11. **No server-side length validation for generic CRUD** — relies on Oracle errors; `errorResponse` maps ORA-12899/01400/00001.
12. **No tests** — verify with tsc, eslint, build, and a real DB/dry-run where possible.

## How to make changes safely

1. Read the relevant `lib/*` module and the API route before editing; the UI is thin over the API.
2. For a new master/UMS table, add it to `lib/master-config.ts` or `lib/ums-config.ts` and regenerate `lib/schema.generated.json` from the DDL dumps (`scripts/parse-schema.mjs`, currently reads `../dbscemaeidms.sql` and `../ums.sql`).
3. Keep SQL identifiers constant/whitelisted and bind values. Do not add request-controlled identifiers.
4. Preserve the `ClientError` + `errorResponse` pattern for user-safe messages.
5. Use `transaction()` for multi-statement writes; respect `dryRun()`.
6. Run `npx tsc --noEmit`, `npx eslint .`, and `npm run build`.
7. If touching auth, re-test: unknown user, wrong password, known user with no active password, mixed-case user ID, inactive user, expired password, lockout.

## Do not

- Do not bypass `guardUser`/`guardAdmin`/`guardTable` in API routes.
- Do not trust the JWT's `roles` for permanent authorization decisions; it is up to 8 hours stale.
- Do not insert into `UMS_LOGINFAILURETEMP` for an unknown user.
- Do not commit `.env*` (except `.env.example`) or `logs/`.
- Do not assume the console writes legacy session/activity tables.
