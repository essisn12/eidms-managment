"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

type Field = {
  name: string;
  label: string;
  kind: "text" | "textarea" | "number" | "date" | "select";
  required: boolean;
  maxLength?: number;
  lookup?: string;
  options?: { value: string; label: string }[];
};
type Meta = { pk: string; fields: Field[]; lookups: Record<string, { value: number; label: string }[]> };
type Row = Record<string, string | number | null>;

const PAGE_SIZE = 20;
const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const toDateInput = (v: unknown) => (v ? String(v).slice(0, 10) : "");

export function MasterManager({
  table, title, rowLink,
}: { table: string; title: string; rowLink?: { label: string; href: string } }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<{ key: string; rows: Row[]; total: number } | null>(null);
  const [editing, setEditing] = useState<Row | "new" | null>(null);

  const key = `${table}|${page}|${query}|${reload}`;
  const loading = result?.key !== key;
  const rows = result?.rows ?? [];
  const total = result?.total ?? 0;
  const load = () => setReload((n) => n + 1);

  useEffect(() => {
    let cancelled = false;
    const sp = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), q: query });
    fetch(`/api/master/${table}?${sp}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to load");
        return res.json();
      })
      .then((data) => !cancelled && setResult({ key, rows: data.rows, total: data.total }))
      .catch((e: Error) => {
        if (cancelled) return;
        toast.error(e.message);
        setResult({ key, rows: [], total: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [table, page, query, key]);

  useEffect(() => {
    fetch(`/api/master/${table}/meta`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setMeta)
      .catch(() => toast.error("Failed to load form definition"));
  }, [table]);

  async function remove(row: Row) {
    if (!meta || !confirm("Delete this record?")) return;
    const res = await fetch(`/api/master/${table}/${row[meta.pk]}`, { method: "DELETE" });
    if (!res.ok) return toast.error((await res.json().catch(() => ({}))).error ?? "Delete failed");
    toast.success("Deleted");
    load();
  }

  const columns = meta ? [meta.pk, ...meta.fields.map((f) => f.name)].slice(0, 7) : [];
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <Button onClick={() => setEditing("new")} disabled={!meta}>
          <Plus /> Add
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
        <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button type="submit" variant="outline">Search</Button>
      </form>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c) => <TableHead key={c}>{c}</TableHead>)}
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {meta && rows.map((r, i) => (
              <TableRow key={`${String(r[meta.pk])}-${i}`}>
                {columns.map((c) => <TableCell key={c}>{String(r[c] ?? "")}</TableCell>)}
                <TableCell className="text-right whitespace-nowrap">
                  {rowLink && (
                    <Link
                      href={rowLink.href.replace("{id}", String(r[meta.pk]))}
                      className="mr-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
                    >
                      {rowLink.label}
                    </Link>
                  )}
                  <Button size="icon-sm" variant="ghost" aria-label="Edit" onClick={() => setEditing(r)}><Pencil /></Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Delete" onClick={() => remove(r)}><Trash2 /></Button>
                </TableCell>
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow>
                <TableCell colSpan={columns.length + 1} className="py-8 text-center text-muted-foreground">
                  {loading ? "Loading…" : "No records"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{total} records</span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span>Page {page} of {pages}</span>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      </div>

      {meta && editing && (
        <RecordDialog
          table={table}
          meta={meta}
          row={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function RecordDialog({
  table, meta, row, onClose, onSaved,
}: { table: string; meta: Meta; row: Row | null; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const form = new FormData(e.currentTarget);
    const body: Record<string, FormDataEntryValue> = {};
    for (const f of meta.fields) body[f.name] = form.get(f.name) ?? "";
    const res = await fetch(row ? `/api/master/${table}/${row[meta.pk]}` : `/api/master/${table}`, {
      method: row ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) return toast.error((await res.json().catch(() => ({}))).error ?? "Save failed");
    toast.success(row ? "Updated" : "Created");
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{row ? "Edit record" : "New record"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-3">
          {meta.fields.map((f) => {
            const value = row?.[f.name];
            const id = `f-${f.name}`;
            return (
              <div key={f.name} className="grid gap-1.5">
                <Label htmlFor={id}>{f.label}{f.required && " *"}</Label>
                {f.kind === "textarea" ? (
                  <Textarea id={id} name={f.name} defaultValue={String(value ?? "")} required={f.required} />
                ) : f.kind === "select" ? (
                  <select id={id} name={f.name} defaultValue={String(value ?? (row ? "" : f.options?.[0]?.value ?? ""))} required={f.required} className={selectClass}>
                    <option value="">— Select —</option>
                    {(f.options ?? meta.lookups[f.lookup!])?.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id={id}
                    name={f.name}
                    type={f.kind === "number" ? "number" : f.kind === "date" ? "date" : "text"}
                    defaultValue={f.kind === "date" ? toDateInput(value) : String(value ?? "")}
                    required={f.required}
                    maxLength={f.maxLength}
                  />
                )}
              </div>
            );
          })}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
