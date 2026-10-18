import { notFound } from "next/navigation";
import { MasterManager } from "@/components/master/master-manager";
import { MASTER_TABLES } from "@/lib/master-config";

export default async function MasterTablePage({ params }: PageProps<"/master/[table]">) {
  const { table } = await params;
  const def = MASTER_TABLES.find((t) => t.key === table.toUpperCase());
  if (!def) notFound();
  return <MasterManager table={def.key} title={def.label} />;
}
