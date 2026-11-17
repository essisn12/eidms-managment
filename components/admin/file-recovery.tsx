"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Row = Record<string, unknown>;
type Recipe = {
  key: string; title: string; description: string; source: "printed" | "handwritten";
  useWhen: string; result: string; note: string;
  steps: { label: string; table: string; set: Record<string, string | null> }[];
};
type Step = { label: string; table: string; set: Record<string, string | null>; rows: Row[] };
type Preview = { recipe: { key: string; title: string }; steps: Step[]; dryRun: boolean };
type Summary = {
  hidden: boolean; dispatched: boolean; totalTransfers: number; liveTransfers: number; hiddenTransfers: number; returns: number;
  hasResult: boolean; fileTypes: string; firstSent: string | null; lastMoved: string | null; location: string; stage: string; route: string[];
};
type Compare = {
  users: (
    | { userId: string; found: false }
    | {
        userId: string; found: true; account: string; designation: string; permissionRecords: number; roles: string[]; level: string; wing: string; section: string; addressed: boolean;
        checks: { transfer: number; route: string; level: boolean; branch: boolean; wing: boolean; section: boolean; handledBy: string | null }[];
      }
  )[];
};
type Access = {
  key: string; stages: { key: string; action: string; where: string; when: string; list: string }[]; list: string; state: string; action: string; handledBy: { userId: string; name: string | null } | null; sentBy: { userId: string; name: string | null } | null; users: { USERID: string; NAME: string | null; DESIGNATION: string | null }[] };
type State = { investigation: Row; transfers: Row[]; summary: Summary; access: Access; preview: Preview | null };

const show = (v: unknown) => {
  if (v === null || v === undefined || v === "") return "—";
  const s = String(v);
  return /^\d{4}-\d\d-\d\dT/.test(s) ? s.replace("T", " ").slice(0, 19) : s;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Request failed");
  return data as T;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

/** Preview table: identifying columns as-is; columns being changed as "current value → new value". */
function ChangeGrid({ rows, set }: { rows: Row[]; set: Record<string, string | null> }) {
  if (!rows.length) return <p className="p-3 text-sm text-muted-foreground">Nothing to change here: no matching rows.</p>;
  const keys = Object.keys(rows[0]);
  const ident = keys.filter((k) => !(k in set));
  const changed = Object.keys(set);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {ident.map((k) => <TableHead key={k}>{k}</TableHead>)}
          {changed.map((k) => <TableHead key={k} className="bg-amber-500/10">{k} (now → after)</TableHead>)}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={i}>
            {ident.map((k) => <TableCell key={k}>{show(r[k])}</TableCell>)}
            {changed.map((k) => {
              const same = (r[k] ?? null) === set[k];
              return (
                <TableCell key={k} className="bg-amber-500/10 whitespace-nowrap">
                  <span className={same ? "" : "text-red-600 line-through"}>{show(r[k])}</span>
                  {same ? <span className="ml-1 text-muted-foreground">(already this value)</span> : <span className="ml-1 font-medium text-green-700">→ {set[k] === null ? "empty" : `'${set[k]}'`}</span>}
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Grid({ rows, cols }: { rows: Row[]; cols?: string[] }) {
  const keys = cols ?? Object.keys(rows[0] ?? {});
  return (
    <Table>
      <TableHeader>
        <TableRow>{keys.map((k) => <TableHead key={k}>{k}</TableHead>)}</TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={i}>{keys.map((k) => <TableCell key={k}>{show(r[k])}</TableCell>)}</TableRow>
        ))}
        {!rows.length && (
          <TableRow>
            <TableCell colSpan={Math.max(1, keys.length)} className="py-4 text-center text-muted-foreground">
              No rows
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

export function FileRecovery() {
  const [term, setTerm] = useState("");
  const [found, setFound] = useState<Row[] | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [recipe, setRecipe] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [cmpUsers, setCmpUsers] = useState("");
  const [cmp, setCmp] = useState<Compare | null>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!term.trim()) return;
    setBusy(true);
    try {
      const d = await api<{ recipes: Recipe[]; rows: Row[] }>(`/api/admin/file-recovery?q=${encodeURIComponent(term.trim())}`);
      setRecipes(d.recipes);
      setFound(d.rows);
      setSelected(null);
      setState(null);
      setRecipe(null);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function load(id: number, recipeKey: string | null) {
    setBusy(true);
    try {
      const q = recipeKey ? `?recipe=${encodeURIComponent(recipeKey)}` : "";
      setState(await api<State>(`/api/admin/file-recovery/${id}${q}`));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function compare(e: React.FormEvent) {
    e.preventDefault();
    if (selected === null || !cmpUsers.trim()) return;
    setBusy(true);
    try {
      setCmp(await api<Compare>(`/api/admin/file-recovery/${selected}?users=${encodeURIComponent(cmpUsers.replace(/\s+/g, ""))}`));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const pick = (id: number) => {
    setCmp(null);
    setSelected(id);
    setRecipe(null);
    setReason("");
    load(id, null);
  };

  const choose = (key: string) => {
    setRecipe(key);
    if (selected !== null) load(selected, key);
  };

  async function run() {
    if (selected === null || !recipe || !state?.preview) return;
    const total = state.preview.steps.reduce((n, s) => n + s.rows.length, 0);
    if (!confirm(`Apply "${state.preview.recipe.title}" to file ${selected}? ${total} row(s) will change.`)) return;
    setBusy(true);
    try {
      const r = await api<{ dryRun: boolean }>(`/api/admin/file-recovery/${selected}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipe, reason }),
      });
      toast.success(r.dryRun ? "Dry run: tested successfully, nothing was saved" : "Recovery applied");
      setReason("");
      await load(selected, recipe);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const preview = state?.preview;
  const affected = preview?.steps.reduce((n, s) => n + s.rows.length, 0) ?? 0;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">File recovery</h2>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Fixes files that moved to the wrong stage, following the eIDMS support runbook. Find the file, choose the
        situation, check exactly which rows will change, then apply. The old values of every changed row are written
        to <code>logs/file-recovery.jsonl</code>.
      </p>

      <form onSubmit={search} className="flex max-w-xl gap-2">
        <Input placeholder="Memorandum no. or investigation ID…" value={term} onChange={(e) => setTerm(e.target.value)} />
        <Button type="submit" variant="outline" disabled={busy}>Find file</Button>
      </form>

      {found && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Investigation ID</TableHead>
                <TableHead>File name</TableHead>
                <TableHead>File type</TableHead>
                <TableHead>Memorandum</TableHead>
                <TableHead>Dispatch no.</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {found.map((r) => (
                <TableRow key={String(r.INVESTIGATION_ID)} data-state={selected === Number(r.INVESTIGATION_ID) ? "selected" : undefined}>
                  <TableCell className="font-medium">{show(r.INVESTIGATION_ID)}</TableCell>
                  <TableCell className="max-w-xs whitespace-normal">{show(r.SUBJECT)}</TableCell>
                  <TableCell className="whitespace-normal">{show(r.FILE_TYPE)}</TableCell>
                  <TableCell>{show(r.MEMORANDUM)}</TableCell>
                  <TableCell>{show(r.DISPATCH_NO)}</TableCell>
                  <TableCell>
                    <Badge variant={r.RECSTATUS === "A" ? "secondary" : "destructive"}>
                      {r.RECSTATUS === "A" ? "Active" : "Hidden"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => pick(Number(r.INVESTIGATION_ID))}>Select</Button>
                  </TableCell>
                </TableRow>
              ))}
              {!found.length && (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">No matching files</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {state && selected !== null && (
        <>
          <section className="space-y-3">
            <h3 className="font-medium">Overview of file {selected}</h3>
            <div className="rounded-lg border p-4 space-y-3">
              <p className="text-sm">{show(state.investigation.SUBJECT)}</p>
              <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Currently at" value={state.summary.location} />
                <Stat label="Stage" value={state.summary.stage} />
                <Stat label="File type" value={state.summary.fileTypes || "—"} />
                <Stat label="Memorandum" value={`${show(state.investigation.MEMORANDUM)} (${show(state.investigation.MEMORANDUM_DATE).slice(0, 10)})`} />
                <Stat
                  label="Dispatch"
                  value={state.summary.dispatched ? `${show(state.investigation.DISPATCH_NO)} (${show(state.investigation.DISPATCH_DATE).slice(0, 10)})` : "Not dispatched"}
                />
                <Stat label="First sent" value={show(state.summary.firstSent)} />
                <Stat label="Last moved" value={show(state.summary.lastMoved)} />
                <Stat
                  label="Transfers"
                  value={`${state.summary.totalTransfers} total · ${state.summary.liveTransfers} active · ${state.summary.hiddenTransfers} hidden`}
                />
                <Stat label="Returns / re-investigation" value={`${state.summary.returns}${state.summary.hasResult ? " · result exists" : " · no result yet"}`} />
              </div>
              {state.summary.route.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  Route: {state.summary.route.map((r, i) => (
                    <span key={i}>{i > 0 && " → "}<span className={i === state.summary.route.length - 1 ? "font-medium text-foreground" : ""}>{r}</span></span>
                  ))}
                </p>
              )}
            </div>

            <div className="rounded-lg border p-4 space-y-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">File is now in</div>
                <div className="text-lg font-semibold">{state.access.list}</div>
                <div className="text-sm text-muted-foreground">{state.access.state}</div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border-2 border-amber-500 bg-amber-500/10 p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Waiting for action</div>
                  <div className="font-semibold">{state.access.action}</div>
                  <div className="text-sm">
                    by: {state.access.users.length ? state.access.users.map((u) => u.USERID).join(", ") : "nobody (no matching user)"}
                  </div>
                </div>
                <div className="rounded-lg border-2 border-green-600 bg-green-600/10 p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Working on it (handling user)</div>
                  <div className="font-semibold">{state.access.handledBy ? `${state.access.handledBy.userId}${state.access.handledBy.name ? ` (${state.access.handledBy.name})` : ""}` : "not recorded"}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Sent here by</div>
                  <div className="font-semibold">{state.access.sentBy ? `${state.access.sentBy.userId}${state.access.sentBy.name ? ` (${state.access.sentBy.name})` : ""}` : "not recorded"}</div>
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-sm font-medium">Users who can see it ({state.access.users.length})</div>
                {state.access.users.length ? (
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow><TableHead>User ID</TableHead><TableHead>Name</TableHead><TableHead>Designation</TableHead><TableHead>Sees it in</TableHead><TableHead>Needs to</TableHead></TableRow>
                      </TableHeader>
                      <TableBody>
                        {state.access.users.map((u) => (
                          <TableRow key={u.USERID} className={state.access.handledBy?.userId.toUpperCase() === u.USERID.toUpperCase() ? "bg-green-600/15" : "bg-amber-500/10"}>
                            <TableCell className="font-medium">
                              {u.USERID}
                              {state.access.handledBy?.userId.toUpperCase() === u.USERID.toUpperCase() && <Badge className="ml-2">working on it</Badge>}
                            </TableCell>
                            <TableCell>{show(u.NAME)}</TableCell>
                            <TableCell>{show(u.DESIGNATION)}</TableCell>
                            <TableCell>{state.access.list}</TableCell>
                            <TableCell>{state.access.action}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-sm text-destructive">No active user has a matching level, branch, wing and section, so nobody can see this file.</p>
                )}
              </div>

              <details>
                <summary className="cursor-pointer text-sm font-medium">All lists a file passes through (current one highlighted)</summary>
                <div className="mt-2 overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Where</TableHead><TableHead>File state</TableHead><TableHead>Shown in list</TableHead><TableHead>Who must act</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {state.access.stages.map((s) => (
                        <TableRow key={s.key} data-state={s.key === state.access.key ? "selected" : undefined}>
                          <TableCell>{s.where}</TableCell>
                          <TableCell className="whitespace-normal">{s.when}</TableCell>
                          <TableCell className="font-medium">{s.list}{s.key === state.access.key ? "  ◄ now" : ""}</TableCell>
                          <TableCell className="whitespace-normal">{s.action}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </details>

              <p className="text-xs text-muted-foreground">
                A user is listed when their account is active and their level, branch, wing and section equal the file&apos;s live transfer.
                The list is read from the transfer flags using the runbook stage names. The eIDMS app&apos;s own queries can&apos;t be seen from
                here, so confirm against the app. Use Compare users below to check someone who is not listed.
              </p>
            </div>

            <h3 className="font-medium">Travel history</h3>
            <ol className="space-y-2 border-l-2 pl-4">
              {state.transfers.map((t, i) => {
                const gone = t.RECSTATUS === "C" || t.RECSTATUS === "D";
                const done = (v: unknown) => v !== null && v !== undefined && v !== "" && v !== "N";
                const marks: [string, unknown, unknown][] = [
                  ["Received", t.IS_RECEIVED, t.RECEIVED_DATE], ["Distributed", t.IS_DISTRIBUTE, t.DISTRIBUTE_DATE],
                  ["Accepted", t.IS_ACCEPTED, t.ACCEPTED_DATE], ["Section accepted", t.IS_ACCEPTED_SECTION, null],
                  ["Officer accepted", t.IS_ACCEPTED_OFFICER, null], ["Dispatched", t.IS_DISPATCH, null],
                  ["Returned", t.IS_RETURN, null], ["Re-investigate", t.IS_AGAIN_INVESTIGATE, null],
                ];
                return (
                  <li key={String(t.FILE_TRANSFER_ID)} className={`relative rounded-lg border p-3 text-sm ${gone ? "opacity-60" : ""}`}>
                    <span className="absolute -left-[1.4rem] top-4 size-2.5 rounded-full bg-primary" />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">#{i + 1} {show(t.SRC)} → {show(t.DEST)}</span>
                      {Boolean(t.FILE_TYPE) && <Badge variant="outline">Type: {show(t.FILE_TYPE)}</Badge>}
                      {Boolean(t.WING || t.SECTION) && <span className="text-muted-foreground">{show(t.WING)} / {show(t.SECTION)}</span>}
                      {gone && <Badge variant="destructive">Hidden</Badge>}
                      <span className="ml-auto text-muted-foreground">{show(t.TRANSFER_DATE)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {marks.filter(([, v]) => done(v)).map(([l, , d]) => (
                        <Badge key={l} variant="secondary">{l}{d ? ` ${show(d).slice(0, 10)}` : ""}</Badge>
                      ))}
                      {!marks.some(([, v]) => done(v)) && <span className="text-muted-foreground">No action taken yet</span>}
                    </div>
                    {Boolean(t.CREATED_BY || t.RESPONDING_USER || t.REMARKS) && (
                      <p className="mt-1 text-muted-foreground">
                        {t.CREATED_BY ? `Sent by ${show(t.CREATED_BY)}` : ""}{t.RESPONDING_USER ? ` · handled by ${show(t.RESPONDING_USER)}` : ""}{t.REMARKS ? ` · ${show(t.REMARKS)}` : ""}
                      </p>
                    )}
                  </li>
                );
              })}
              {!state.transfers.length && <li className="text-sm text-muted-foreground">This file has not been transferred yet.</li>}
            </ol>

            <details className="rounded-lg border">
              <summary className="cursor-pointer p-3 text-sm font-medium">Raw transfer rows</summary>
              <div className="overflow-x-auto">
                <Grid
                  rows={state.transfers}
                  cols={["FILE_TRANSFER_ID", "SRC", "DEST", "WING", "SECTION", "FILE_TYPE", "RECSTATUS", "IS_RECEIVED", "IS_ACCEPTED", "IS_ACCEPTED_SECTION",
                    "IS_ACCEPTED_OFFICER", "IS_DISTRIBUTE", "IS_DISPATCH", "IS_AGAIN_INVESTIGATE", "TRANSFER_DATE"]}
                />
              </div>
            </details>
          </section>

          <section className="space-y-2">
            <h3 className="font-medium">Why can one user see this file and another can&apos;t?</h3>
            <form onSubmit={compare} className="flex max-w-xl gap-2">
              <Input placeholder="User IDs, comma separated (e.g. jdsds, B0390)" value={cmpUsers} onChange={(e) => setCmpUsers(e.target.value)} />
              <Button type="submit" variant="outline" disabled={busy}>Compare</Button>
            </form>
            {cmp && (
              <div className="space-y-2">
                {cmp.users.map((u) => (
                  <div key={u.userId} className="rounded-lg border p-3 text-sm">
                    {!u.found ? (
                      <p><span className="font-medium">{u.userId}</span>: no active permission record (NSIDB_USER_PERMISION), so the app has no level or section for this user.</p>
                    ) : (
                      <>
                        <p>
                          <span className="font-medium">{u.userId}</span>: {u.level}, {u.wing} / {u.section}{" "}
                          <Badge variant={u.addressed ? "secondary" : "destructive"}>{u.addressed ? "File is addressed to them" : "No live transfer addressed to them"}</Badge>
                        </p>
                        <p className="mt-1 text-muted-foreground">
                          Account {u.account === "A" ? "active" : `status ${u.account}`} · designation {u.designation} · {u.permissionRecords} active permission record{u.permissionRecords === 1 ? "" : "s"}
                          {u.permissionRecords > 1 ? " (more than one: the app may pick a different one)" : ""}
                        </p>
                        <p className="text-muted-foreground">Roles: {u.roles.length ? u.roles.join(", ") : "none"}</p>
                        <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                          {u.checks.map((c) => (
                            <li key={c.transfer}>
                              #{c.transfer} {c.route}: level {c.level ? "✓" : "✗"} · branch {c.branch ? "✓" : "✗"} · wing {c.wing ? "✓" : "✗"} · section {c.section ? "✓" : "✗"}
                              {c.handledBy ? ` · handled by ${c.handledBy}` : ""}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">✗ marks where the user&apos;s level, branch, wing or section differs from that live transfer. This is a diagnostic aid; the app&apos;s own list queries aren&apos;t visible here.</p>
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="font-medium">What happened to the file?</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {recipes.map((r) => (
                <label
                  key={r.key}
                  className={`flex cursor-pointer gap-2 rounded-lg border p-3 text-sm ${recipe === r.key ? "border-primary bg-muted" : ""}`}
                >
                  <input type="radio" name="recipe" checked={recipe === r.key} onChange={() => choose(r.key)} />
                  <span>
                    <span className="font-medium">{r.title}</span>
                    {r.source === "handwritten" && <Badge variant="outline" className="ml-2">from handwritten notes</Badge>}
                    <span className="block text-muted-foreground">{r.description}</span>
                    {recipe === r.key && (
                      <span className="mt-2 block rounded-md border bg-background p-2">
                        <span className="block"><span className="font-medium">Use when:</span> {r.useWhen}</span>
                        <span className="mt-1 block"><span className="font-medium">Result:</span> {r.result}</span>
                        <span className="mt-1 block rounded bg-amber-500/10 p-1.5"><span className="font-medium">Note:</span> {r.note}</span>
                        <span className="mt-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Exactly what changes</span>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4">
                          {r.steps.map((st, i) => (
                            <li key={i}>
                              {st.label}:{" "}
                              <span className="text-muted-foreground">
                                {Object.entries(st.set).map(([c, v]) => (v === null ? `${c} removed (emptied)` : `${c} replaced with '${v}'`)).join("; ")}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </section>

          {preview && (
            <section className="space-y-3">
              <h3 className="font-medium">What &ldquo;{preview.recipe.title}&rdquo; will do</h3>
              <p className="max-w-3xl text-sm text-muted-foreground">
                Only the highlighted columns are changed, step by step, on this file only. Red struck-through is the value that gets
                removed; green is what replaces it (&ldquo;empty&rdquo; means cleared). Hidden rows are never touched, and the old values are saved to the log.
              </p>
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                {preview.steps.map((s, i) => (
                  <li key={i}>
                    <span className="font-medium">{s.label}</span>:{" "}
                    {s.rows.length ? `${s.rows.length} row${s.rows.length === 1 ? "" : "s"} in ${s.table.split(".")[1]}` : "no matching rows, skipped"}
                  </li>
                ))}
              </ol>
              <p className="text-sm font-medium">{affected} row{affected === 1 ? "" : "s"} in total will change.</p>
              {preview.steps.map((s, i) => (
                <div key={i} className="space-y-1">
                  <p className="text-sm">
                    <span className="font-medium">{i + 1}. {s.label}</span>{" "}
                    <span className="text-muted-foreground">
                      ({s.rows.length} row{s.rows.length === 1 ? "" : "s"} in {s.table.split(".")[1]}; set{" "}
                      {Object.entries(s.set).map(([c, v]) => `${c} = ${v === null ? "NULL" : `'${v}'`}`).join(", ")})
                    </span>
                  </p>
                  <div className="overflow-x-auto rounded-lg border"><ChangeGrid rows={s.rows} set={s.set} /></div>
                </div>
              ))}
              {preview.dryRun && (
                <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-2 text-sm">
                  Dry-run mode is ON (<code>DB_DRY_RUN</code>): applying will test the change and roll it back.
                </p>
              )}
              <div className="grid max-w-xl gap-1.5">
                <Label>Reason *</Label>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Sent to wrong wing, requested by …" maxLength={500} />
              </div>
              <Button onClick={run} disabled={busy || !affected || reason.trim().length < 5}>
                {preview.dryRun ? "Test (dry run)" : "Apply recovery"}
              </Button>
            </section>
          )}
        </>
      )}
    </div>
  );
}
