import { Suspense } from "react";
import { AdminNav } from "@/components/admin/admin-nav";
import { requireAdmin } from "@/lib/admin";

// The admin check reads the session cookie (request-time data), so it streams in behind Suspense.
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <AdminShell>{children}</AdminShell>
    </Suspense>
  );
}

async function AdminShell({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">User Management</h1>
      <AdminNav />
      {children}
    </div>
  );
}
