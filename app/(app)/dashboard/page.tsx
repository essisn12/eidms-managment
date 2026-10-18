import Link from "next/link";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const MODULES = [
  { href: "/master", title: "Master Data", desc: "Geography, people, education, organization and system lookups." },
  { href: "/people", title: "Personal Information", desc: "Search and manage personal records and their sub-forms." },
  { href: "/investigations", title: "Investigations", desc: "Investigation results and file tracking." },
  { href: "/admin/users", title: "User Management", desc: "Users, roles, password reset and expiry extension." },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {MODULES.map((m) => (
          <Link key={m.href} href={m.href}>
            <Card className="h-full transition-colors hover:bg-muted/50">
              <CardHeader>
                <CardTitle>{m.title}</CardTitle>
                <CardDescription>{m.desc}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
