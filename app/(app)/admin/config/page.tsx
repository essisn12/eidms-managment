import Link from "next/link";
import { UMS_TABLES } from "@/lib/ums-config";

export default function AdminConfigPage() {
  const groups = Object.groupBy(UMS_TABLES, (t) => t.group);
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Configuration</h2>
      {Object.entries(groups).map(([group, tables]) => (
        <section key={group} className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">{group}</h3>
          <div className="flex flex-wrap gap-2">
            {tables!.map((t) => (
              <Link key={t.key} href={`/admin/config/${t.key}`} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
                {t.label}
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
