import { Suspense } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { isAdmin } from "@/lib/admin";
import { requireUser } from "@/lib/auth";

// The session read is request-time data, so the whole authenticated area streams in behind Suspense.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<div className="flex-1 p-8 text-sm text-muted-foreground">Loading…</div>}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}

async function Shell({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex min-h-screen flex-1">
      <AppSidebar userName={user.name} isAdmin={isAdmin(user)} />
      <main className="min-w-0 flex-1 p-6">{children}</main>
    </div>
  );
}
