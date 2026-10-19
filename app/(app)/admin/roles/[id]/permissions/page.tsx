import Link from "next/link";
import { notFound } from "next/navigation";
import { RolePermissions } from "@/components/admin/role-permissions";

export default async function RolePermissionsPage({ params }: PageProps<"/admin/roles/[id]/permissions">) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  return (
    <div className="space-y-3">
      <Link href="/admin/roles" className="text-sm text-muted-foreground hover:text-foreground">← Roles</Link>
      <RolePermissions roleId={Number(id)} />
    </div>
  );
}
