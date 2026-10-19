"use client";

import { Database, FileSearch, LayoutDashboard, LogOut, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MASTER_TABLES } from "@/lib/master-config";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/master", label: "Master Data", icon: Database },
  { href: "/people", label: "Personal Information", icon: Users },
  { href: "/investigations", label: "Investigations", icon: FileSearch },
  { href: "/admin", label: "User Management", icon: ShieldCheck, adminOnly: true },
];

export function AppSidebar({ userName, isAdmin }: { userName: string; isAdmin: boolean }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="border-b px-4 py-4 text-sm font-semibold">EIDMS Management</div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {NAV.filter((n) => isAdmin || !n.adminOnly).map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent",
              pathname.startsWith(href) && "bg-sidebar-accent font-medium",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        ))}
        {pathname.startsWith("/master/") && (
          <ul className="ml-3 mt-1 space-y-0.5 border-l pl-2">
            {MASTER_TABLES.map((t) => (
              <li key={t.key}>
                <Link
                  href={`/master/${t.key}`}
                  className={cn(
                    "block rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground",
                    pathname === `/master/${t.key}` && "font-medium text-foreground",
                  )}
                >
                  {t.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </nav>
      <div className="flex items-center justify-between border-t p-3 text-sm">
        <span className="truncate" title={userName}>{userName}</span>
        <button onClick={logout} aria-label="Sign out" className="rounded p-1 hover:bg-sidebar-accent">
          <LogOut className="size-4" />
        </button>
      </div>
    </aside>
  );
}
