"use client";

import { KeyRound, Pencil, Plus, Trash2, Unlock } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEFAULT_PASSWORD } from "@/lib/ums-schemas";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Option = { value: number; label: string; parent?: number };
type Lookups = {
  categories: Option[];
  roles: Option[];
  levels: Option[];
  branches: Option[];
  wings: Option[];
  sections: Option[];
  designations: Option[];
};
type Perm = {
  levelId: number;
  branchId: number;
  wingId: number;
  sectionId: number;
  designationId: number;
  nameBangla: string;
  nameEnglish: string;
};
const EMPTY_PERM: Perm = { levelId: 0, branchId: 0, wingId: 0, sectionId: 0, designationId: 0, nameBangla: "", nameEnglish: "" };
type UserRow = {
  USERID: string;
  NAME: string;
  CATEGORYID: number;
  CELLNO: string;
  EMAIL: string;
  RECSTATUS: string;
  FAILS: number;
  EXPIRES: string | null;
};
type UserDetail = Omit<UserRow, "FAILS" | "EXPIRES"> & {
  DOB: string;
  CATIDVAL: string;
  MFA: string;
  MACADDRESS: string | null;
  IPADDRESS: string | null;
  roles: number[];
  permission: Perm | null;
};

const PAGE_SIZE = 20;

/** Fills the sibling password input of the clicked button's form with the default password. */
function DefaultPasswordButton() {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={(e) => {
        const input = e.currentTarget.form?.elements.namedItem("password") as HTMLInputElement | null;
        if (!input) return;
        input.type = "text";
        input.value = DEFAULT_PASSWORD;
      }}
    >
      Use default ({DEFAULT_PASSWORD})
    </Button>
  );
}
const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Request failed");
  return data as T;
}
const send = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export function UsersManager() {
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<{ key: string; rows: UserRow[]; total: number; maxFailures: number } | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [resetting, setResetting] = useState<UserRow | null>(null);

  const key = `${page}|${query}|${reload}`;
  const loading = result?.key !== key;
  const rows = result?.rows ?? [];
  const total = result?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const refresh = () => setReload((n) => n + 1);

  useEffect(() => {
    let cancelled = false;
    const sp = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), q: query });
    api<{ rows: UserRow[]; total: number; maxFailures: number }>(`/api/admin/users?${sp}`)
      .then((d) => !cancelled && setResult({ key, rows: d.rows, total: d.total, maxFailures: d.maxFailures }))
      .catch((e: Error) => {
        if (cancelled) return;
        toast.error(e.message);
        setResult({ key, rows: [], total: 0, maxFailures: 5 });
      });
    return () => {
      cancelled = true;
    };
  }, [page, query, key]);

  useEffect(() => {
    api<Lookups>("/api/admin/lookups").then(setLookups).catch((e: Error) => toast.error(e.message));
  }, []);

  async function act(row: UserRow, body: unknown, ok: string) {
    try {
      await api(`/api/admin/users/${encodeURIComponent(row.USERID)}/actions`, send("POST", body));
      toast.success(ok);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function remove(row: UserRow) {
    if (!confirm(`Delete user ${row.USERID}? They will no longer be able to log in.`)) return;
    try {
      await api(`/api/admin/users/${encodeURIComponent(row.USERID)}`, { method: "DELETE" });
      toast.success("User deleted");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const categoryName = (id: number) => lookups?.categories.find((c) => c.value === Number(id))?.label ?? id;
  const maxFailures = result?.maxFailures ?? 5;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Users</h2>
        <Button onClick={() => setEditing("new")} disabled={!lookups}>
          <Plus /> Add user
        </Button>
      </div>

      <form
        className="flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQuery(search);
        }}
      >
        <Input placeholder="Search by ID, name, email, phone…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button type="submit" variant="outline">Search</Button>
      </form>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Password expires</TableHead>
              <TableHead className="w-40" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const locked = Number(r.FAILS) >= maxFailures;
              const expired = r.EXPIRES ? new Date(r.EXPIRES) < new Date() : false;
              return (
                <TableRow key={r.USERID}>
                  <TableCell className="font-medium">{r.USERID}</TableCell>
                  <TableCell>{r.NAME}</TableCell>
                  <TableCell>{categoryName(r.CATEGORYID)}</TableCell>
                  <TableCell>{r.EMAIL}</TableCell>
                  <TableCell className="space-x-1">
                    <Badge variant={r.RECSTATUS === "A" ? "secondary" : "destructive"}>
                      {r.RECSTATUS === "A" ? "Active" : "Inactive"}
                    </Badge>
                    {locked && <Badge variant="destructive">Locked</Badge>}
                  </TableCell>
                  <TableCell>
                    {r.EXPIRES ? String(r.EXPIRES).slice(0, 10) : "—"}
                    {expired && <Badge variant="destructive" className="ml-1">Expired</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    {locked && (
                      <Button size="icon-sm" variant="ghost" aria-label="Unlock" title="Unlock"
                        onClick={() => act(r, { action: "unlock" }, "User unlocked")}><Unlock /></Button>
                    )}
                    <Button size="icon-sm" variant="ghost" aria-label="Reset password" title="Reset password"
                      onClick={() => setResetting(r)}><KeyRound /></Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Edit" onClick={() => setEditing(r.USERID)}><Pencil /></Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Delete" onClick={() => remove(r)}><Trash2 /></Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {!rows.length && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  {loading ? "Loading…" : "No users"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{total} users</span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span>Page {page} of {pages}</span>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      </div>

      {lookups && editing && (
        <UserDialog
          userId={editing === "new" ? null : editing}
          lookups={lookups}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
      {resetting && (
        <PasswordDialog
          user={resetting}
          onClose={() => setResetting(null)}
          onDone={() => {
            setResetting(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function UserDialog({
  userId, lookups, onClose, onSaved,
}: { userId: string | null; lookups: Lookups; onClose: () => void; onSaved: () => void }) {
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [roles, setRoles] = useState<number[]>([]);
  const [perm, setPerm] = useState<Perm>(EMPTY_PERM);
  const [saving, setSaving] = useState(false);
  const setP = (patch: Partial<Perm>) => setPerm((p) => ({ ...p, ...patch }));
  const ready = userId === null || detail !== null;

  useEffect(() => {
    if (userId === null) return;
    api<UserDetail>(`/api/admin/users/${encodeURIComponent(userId)}`)
      .then((d) => {
        setDetail(d);
        setRoles(d.roles);
      })
      .catch((e: Error) => toast.error(e.message));
  }, [userId]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (n: string) => String(f.get(n) ?? "");
    const fields = {
      NAME: v("NAME"),
      CATEGORYID: Number(v("CATEGORYID")),
      CELLNO: v("CELLNO"),
      EMAIL: v("EMAIL"),
      DOB: v("DOB"),
      CATIDVAL: v("CATIDVAL"),
      MFA: v("MFA"),
      MACADDRESS: v("MACADDRESS"),
      IPADDRESS: v("IPADDRESS"),
      RECSTATUS: v("RECSTATUS"),
      roles,
    };
    setSaving(true);
    try {
      if (userId) await api(`/api/admin/users/${encodeURIComponent(userId)}`, send("PUT", fields));
      else
        await api("/api/admin/users", send("POST", {
          ...fields,
          USERID: v("USERID"),
          password: v("password"),
          permission: perm.levelId ? perm : null,
          forceChange: f.get("forceChange") === "on",
        }));
      toast.success(userId ? "User updated" : "User created");
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const d = detail;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{userId ? `Edit ${userId}` : "New user"}</DialogTitle>
        </DialogHeader>
        {!ready ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
            {!userId && (
              <>
                <Field label="User ID *"><Input name="USERID" required maxLength={50} autoComplete="off" /></Field>
                <Field label="Initial password *">
                  <div className="flex gap-2">
                    <Input name="password" type="password" required autoComplete="new-password" />
                    <DefaultPasswordButton />
                  </div>
                </Field>
              </>
            )}
            <Field label="Name *"><Input name="NAME" required maxLength={255} defaultValue={d?.NAME ?? ""} /></Field>
            <Field label="Category *">
              <select name="CATEGORYID" required defaultValue={d ? String(d.CATEGORYID) : ""} className={selectClass}>
                <option value="">— Select —</option>
                {lookups.categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Cell no *"><Input name="CELLNO" required maxLength={255} defaultValue={d?.CELLNO ?? ""} /></Field>
            <Field label="Email *"><Input name="EMAIL" type="email" required maxLength={255} defaultValue={d?.EMAIL ?? ""} /></Field>
            <Field label="Date of birth *"><Input name="DOB" required maxLength={255} placeholder="YYYY-MM-DD" defaultValue={d?.DOB ?? ""} /></Field>
            <Field label="Category ID value *"><Input name="CATIDVAL" required maxLength={50} defaultValue={d?.CATIDVAL ?? ""} /></Field>
            <Field label="MFA">
              <select name="MFA" defaultValue={d?.MFA ?? "N"} className={selectClass}>
                <option value="N">No</option>
                <option value="Y">Yes</option>
              </select>
            </Field>
            <Field label="Status">
              <select name="RECSTATUS" defaultValue={d?.RECSTATUS ?? "A"} className={selectClass}>
                <option value="A">Active</option>
                <option value="I">Inactive</option>
              </select>
            </Field>
            <Field label="MAC address"><Input name="MACADDRESS" maxLength={50} defaultValue={d?.MACADDRESS ?? ""} /></Field>
            <Field label="IP address"><Input name="IPADDRESS" maxLength={50} defaultValue={d?.IPADDRESS ?? ""} /></Field>

            {!userId && (
              <CopyRoles
                onCopy={(r, p) => {
                  setRoles(r);
                  if (p) setPerm(p);
                }}
              />
            )}

            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Roles</Label>
              <div className="grid max-h-40 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
                {lookups.roles.map((r) => (
                  <label key={r.value} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={roles.includes(r.value)}
                      onChange={(e) =>
                        setRoles(e.target.checked ? [...roles, r.value] : roles.filter((x) => x !== r.value))
                      }
                    />
                    {r.label}
                  </label>
                ))}
                {!lookups.roles.length && <span className="text-sm text-muted-foreground">No roles defined</span>}
              </div>
            </div>

            {!userId && (
              <fieldset className="grid gap-3 rounded-lg border p-3 sm:col-span-2 sm:grid-cols-2">
                <legend className="px-1 text-sm font-medium">Organisation placement (NSIDB)</legend>
                <PermSelect label="User level" value={perm.levelId} options={lookups.levels}
                  onChange={(v) => setP({ levelId: v })} />
                <PermSelect label="Designation" value={perm.designationId} options={lookups.designations}
                  onChange={(v) => setP({ designationId: v })} />
                <PermSelect label="Branch" value={perm.branchId} options={lookups.branches}
                  onChange={(v) => setP({ branchId: v, wingId: 0, sectionId: 0 })} />
                <PermSelect label="Wing" value={perm.wingId}
                  options={lookups.wings.filter((w) => w.parent === perm.branchId)}
                  onChange={(v) => setP({ wingId: v, sectionId: 0 })} />
                <PermSelect label="Section" value={perm.sectionId}
                  options={lookups.sections.filter((s) => s.parent === perm.wingId)}
                  onChange={(v) => setP({ sectionId: v })} />
                <div />
                <Field label="Name (English)">
                  <Input value={perm.nameEnglish} maxLength={255} onChange={(e) => setP({ nameEnglish: e.target.value })} />
                </Field>
                <Field label="Name (Bangla)">
                  <Input value={perm.nameBangla} maxLength={255} onChange={(e) => setP({ nameBangla: e.target.value })} />
                </Field>
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  Leave “User level” empty to skip creating the NSIDB placement record.
                </p>
              </fieldset>
            )}

            {!userId && (
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="forceChange" defaultChecked /> Require password change at first login
              </label>
            )}
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PermSelect({
  label, value, options, onChange,
}: { label: string; value: number; options: Option[]; onChange: (v: number) => void }) {
  return (
    <Field label={label}>
      <select value={value || ""} onChange={(e) => onChange(Number(e.target.value))} className={selectClass}>
        <option value="">— Select —</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

/** Finds an existing user and copies their active roles and NSIDB placement into the form. */
function CopyRoles({ onCopy }: { onCopy: (roles: number[], perm: Perm | null) => void }) {
  const [term, setTerm] = useState("");
  const [found, setFound] = useState<UserRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function search() {
    if (!term.trim()) return;
    setBusy(true);
    try {
      const sp = new URLSearchParams({ page: "1", pageSize: "8", q: term.trim() });
      setFound((await api<{ rows: UserRow[] }>(`/api/admin/users?${sp}`)).rows);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copyFrom(u: UserRow) {
    try {
      const d = await api<UserDetail>(`/api/admin/users/${encodeURIComponent(u.USERID)}`);
      onCopy(d.roles, d.permission);
      setFound(null);
      toast.success(`Copied ${d.roles.length} role(s) from ${u.USERID}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="grid gap-1.5 sm:col-span-2">
      <Label>Copy roles and placement from a similar user</Label>
      <div className="flex gap-2">
        <Input
          placeholder="Search by ID, name, email, phone…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              search();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={search} disabled={busy}>Find</Button>
      </div>
      {found && (
        <div className="max-h-36 overflow-y-auto rounded-lg border">
          {found.map((u) => (
            <button
              key={u.USERID}
              type="button"
              onClick={() => copyFrom(u)}
              className="flex w-full justify-between gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-muted"
            >
              <span className="font-medium">{u.USERID}</span>
              <span className="truncate text-muted-foreground">{u.NAME}</span>
            </button>
          ))}
          {!found.length && <p className="p-2 text-sm text-muted-foreground">No matching users</p>}
        </div>
      )}
    </div>
  );
}

function PasswordDialog({ user, onClose, onDone }: { user: UserRow; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);

  async function run(body: unknown, ok: string) {
    setBusy(true);
    try {
      await api(`/api/admin/users/${encodeURIComponent(user.USERID)}/actions`, send("POST", body));
      toast.success(ok);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Password — {user.USERID}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run({ action: "reset-password", password: String(f.get("password")), forceChange: f.get("forceChange") === "on" }, "Password reset");
          }}
        >
          <Field label="New password">
            <div className="flex gap-2">
              <Input name="password" type="password" required autoComplete="new-password" />
              <DefaultPasswordButton />
            </div>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="forceChange" defaultChecked /> Require change at next login
          </label>
          <Button type="submit" disabled={busy}>Reset password</Button>
        </form>
        <form
          className="flex items-end gap-2 border-t pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            run({ action: "extend-expiry", days: Number(new FormData(e.currentTarget).get("days")) }, "Expiry extended");
          }}
        >
          <Field label="Extend expiry (days from today)">
            <Input name="days" type="number" min={1} max={3650} defaultValue={90} required />
          </Field>
          <Button type="submit" variant="outline" disabled={busy}>Extend</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
