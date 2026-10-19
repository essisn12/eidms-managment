"use client";

import { ScrollText } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Row = Record<string, string | number | null>;
const PAGE_SIZE = 20;
const dt = (v: unknown) => (v ? String(v).replace("T", " ").slice(0, 19) : "—");

async function load(url: string): Promise<{ rows: Row[]; total: number }> {
  // A timeout turns a hung request into an error toast instead of an endless "Loading…".
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch((e: Error) => {
    throw new Error(e.name === "TimeoutError" ? "The server took too long to respond" : e.message);
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Failed to load");
  return data;
}

export function SessionsViewer() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ key: string; rows: Row[]; total: number } | null>(null);
  const [viewing, setViewing] = useState<Row | null>(null);

  const key = `${page}|${query}`;
  const loading = result?.key !== key;
  const pages = Math.max(1, Math.ceil((result?.total ?? 0) / PAGE_SIZE));

  useEffect(() => {
    let cancelled = false;
    const sp = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), q: query });
    load(`/api/admin/sessions?${sp}`)
      .then((d) => !cancelled && setResult({ key, ...d }))
      .catch((e: Error) => {
        if (cancelled) return;
        toast.error(e.message);
        setResult({ key, rows: [], total: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [page, query, key]);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Login sessions</h2>
      <form
        className="flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQuery(search);
        }}
      >
        <Input placeholder="Search by user, IP, app…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button type="submit" variant="outline">Search</Button>
      </form>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Session</TableHead>
              <TableHead>User</TableHead>
              <TableHead>App</TableHead>
              <TableHead>IP</TableHead>
              <TableHead>Login</TableHead>
              <TableHead>Logout</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(result?.rows ?? []).map((r) => (
              <TableRow key={String(r.SESSIONID)}>
                <TableCell>{r.SESSIONID}</TableCell>
                <TableCell className="font-medium">{r.USERID}</TableCell>
                <TableCell>{r.APPID}</TableCell>
                <TableCell>{r.IPADDRESS}</TableCell>
                <TableCell>{dt(r.LOGINDATETIME)}</TableCell>
                <TableCell>{dt(r.LOGOUTDATETIME)}</TableCell>
                <TableCell>
                  <Button size="icon-sm" variant="ghost" aria-label="Activity" title="Activity" onClick={() => setViewing(r)}>
                    <ScrollText />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!result?.rows.length && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  {loading ? "Loading…" : "No sessions"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{result?.total ?? 0} sessions</span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span>Page {page} of {pages}</span>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      </div>
      {viewing && <ActivityDialog session={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function ActivityDialog({ session, onClose }: { session: Row; onClose: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    load(`/api/admin/sessions/${session.SESSIONID}`)
      .then((d) => setRows(d.rows))
      .catch((e: Error) => {
        toast.error(e.message);
        setRows([]);
      });
  }, [session.SESSIONID]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Activity — {session.USERID} (session {session.SESSIONID})</DialogTitle>
        </DialogHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Feature</TableHead>
              <TableHead>Module</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Type</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rows ?? []).map((r) => (
              <TableRow key={String(r.ACTIVITYID)}>
                <TableCell>{dt(r.ACTIONDATETIME)}</TableCell>
                <TableCell>{r.FEATUREID}</TableCell>
                <TableCell>{r.MODULEID}</TableCell>
                <TableCell>{r.ACTIONNAME}</TableCell>
                <TableCell>{r.ACTIONTYPE}</TableCell>
              </TableRow>
            ))}
            {!rows?.length && (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                  {rows ? "No activity recorded" : "Loading…"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}
