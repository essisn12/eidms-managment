"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin/users", label: "Users" },
  { href: "/admin/roles", label: "Roles & Permissions" },
  { href: "/admin/sessions", label: "Sessions" },
  { href: "/admin/config", label: "Configuration" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 border-b">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            "-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground",
            pathname.startsWith(t.href) && "border-primary font-medium text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
