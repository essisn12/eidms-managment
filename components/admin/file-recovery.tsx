"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Row = Record<string, unknown>;
type Recipe = { key: string; title: string; description: string; source: "printed" | "handwritten" };
type Step = { label: string; table: string; set: Record<string, string | null>; rows: Row[] };
type Preview = { recipe: { key: string; title: string }; steps: Step[]; dryRun: boolean };
type State = { investigation: Row; transfers: Row[]; preview: Preview | null };

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

  const pick = (id: number) => {
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
                  <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">No matching files</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {state && selected !== null && (
        <>
          <section className="space-y-2">
            <h3 className="font-medium">Current transfers of file {selected}</h3>
            <div className="overflow-x-auto rounded-lg border">
              <Grid
                rows={state.transfers}
                cols={["FILE_TRANSFER_ID", "SRC", "DEST", "RECSTATUS", "IS_RECEIVED", "IS_ACCEPTED", "IS_ACCEPTED_SECTION",
                  "IS_ACCEPTED_OFFICER", "IS_DISTRIBUTE", "IS_DISPATCH", "IS_AGAIN_INVESTIGATE", "TRANSFER_DATE"]}
              />
            </div>
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
                  </span>
                </label>
              ))}
            </div>
          </section>

          {preview && (
            <section className="space-y-3">
              <h3 className="font-medium">Rows that will change — {preview.recipe.title}</h3>
              {preview.steps.map((s, i) => (
                <div key={i} className="space-y-1">
                  <p className="text-sm">
                    <span className="font-medium">{i + 1}. {s.label}</span>{" "}
                    <span className="text-muted-foreground">
                      ({s.rows.length} row{s.rows.length === 1 ? "" : "s"}; set{" "}
                      {Object.entries(s.set).map(([c, v]) => `${c} = ${v === null ? "NULL" : `'${v}'`}`).join(", ")})
                    </span>
                  </p>
                  <div className="overflow-x-auto rounded-lg border"><Grid rows={s.rows} cols={s.rows.length ? undefined : ["—"]} /></div>
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
