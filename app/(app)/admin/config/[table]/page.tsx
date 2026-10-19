import Link from "next/link";
import { notFound } from "next/navigation";
import { MasterManager } from "@/components/master/master-manager";
import { UMS_TABLES } from "@/lib/ums-config";

export default async function AdminConfigTablePage({ params }: PageProps<"/admin/config/[table]">) {
  const { table } = await params;
  const def = UMS_TABLES.find((t) => t.key === table.toUpperCase());
  if (!def) notFound();
  return (
    <div className="space-y-3">
      <Link href="/admin/config" className="text-sm text-muted-foreground hover:text-foreground">← Configuration</Link>
      <MasterManager table={def.key} title={def.label} />
    </div>
  );
}
