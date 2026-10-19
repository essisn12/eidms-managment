"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const FLAGS = [
  ["CREATEYN", "Create"],
  ["EDITYN", "Edit"],
  ["DELETEYN", "Delete"],
  ["VIEWDETAILYN", "View"],
  ["AUTHYN", "Authorize"],
  ["CANCELYN", "Cancel"],
] as const;
type Flag = (typeof FLAGS)[number][0];

type Feature = {
  featureId: string;
  name: string;
  app: string;
  module: string;
  grant: Record<Flag, boolean>;
};
type Data = { role: { id: number; name: string }; features: Feature[] };

export function RolePermissions({ roleId }: { roleId: number }) {
  const [data, setData] = useState<Data | null>(null);
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/admin/roles/${roleId}/permissions`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error ?? "Failed to load");
        setData(d);
      })
      .catch((e: Error) => toast.error(e.message));
  }, [roleId]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (data?.features ?? []).filter(
      (f) => !q || `${f.app} ${f.module} ${f.name} ${f.featureId}`.toLowerCase().includes(q),
    );
  }, [data, filter]);

  function toggle(featureId: string, flag: Flag, value: boolean) {
    setData((d) =>
      d && {
        ...d,
        features: d.features.map((f) => (f.featureId === featureId ? { ...f, grant: { ...f.grant, [flag]: value } } : f)),
      },
    );
  }

  function setAll(featureIds: Set<string>, value: boolean) {
    setData((d) =>
      d && {
        ...d,
        features: d.features.map((f) =>
          featureIds.has(f.featureId) ? { ...f, grant: Object.fromEntries(FLAGS.map(([k]) => [k, value])) as Feature["grant"] } : f,
        ),
      },
    );
  }

  async function save() {
    if (!data) return;
    setSaving(true);
    const res = await fetch(`/api/admin/roles/${roleId}/permissions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grants: data.features.map((f) => ({ featureId: f.featureId, ...f.grant })) }),
    });
    setSaving(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(body.error ?? "Save failed");
    toast.success(`Saved — ${body.granted} features granted`);
  }

  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const shownIds = new Set(shown.map((f) => f.featureId));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Permissions — {data.role.name}</h2>
        <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save permissions"}</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="Filter features…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <Button variant="outline" size="sm" onClick={() => setAll(shownIds, true)}>Grant all shown</Button>
        <Button variant="outline" size="sm" onClick={() => setAll(shownIds, false)}>Clear all shown</Button>
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Feature</TableHead>
              {FLAGS.map(([k, label]) => <TableHead key={k} className="text-center">{label}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((f, i) => {
              const group = `${f.app} › ${f.module}`;
              const header = i === 0 || group !== `${shown[i - 1].app} › ${shown[i - 1].module}`;
              return [
                header && (
                  <TableRow key={`g-${group}`} className="bg-muted/50">
                    <TableCell colSpan={FLAGS.length + 1} className="text-xs font-medium text-muted-foreground">{group}</TableCell>
                  </TableRow>
                ),
                <TableRow key={f.featureId}>
                  <TableCell>{f.name} <span className="text-xs text-muted-foreground">{f.featureId}</span></TableCell>
                  {FLAGS.map(([k, label]) => (
                    <TableCell key={k} className="text-center">
                      <input
                        type="checkbox"
                        aria-label={`${f.name}: ${label}`}
                        checked={f.grant[k]}
                        onChange={(e) => toggle(f.featureId, k, e.target.checked)}
                      />
                    </TableCell>
                  ))}
                </TableRow>,
              ];
            })}
            {!shown.length && (
              <TableRow>
                <TableCell colSpan={FLAGS.length + 1} className="py-8 text-center text-muted-foreground">No features</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
