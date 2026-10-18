import Link from "next/link";
import { MASTER_TABLES } from "@/lib/master-config";

export default function MasterIndexPage() {
  const groups = Object.groupBy(MASTER_TABLES, (t) => t.group);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Master Data</h1>
      {Object.entries(groups).map(([group, tables]) => (
        <section key={group} className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">{group}</h2>
          <div className="flex flex-wrap gap-2">
            {tables!.map((t) => (
              <Link key={t.key} href={`/master/${t.key}`} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
                {t.label}
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
