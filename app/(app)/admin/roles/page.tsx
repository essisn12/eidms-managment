import { MasterManager } from "@/components/master/master-manager";

export default function AdminRolesPage() {
  return (
    <MasterManager
      table="UMS_ROLE"
      title="Roles"
      rowLink={{ label: "Permissions", href: "/admin/roles/{id}/permissions" }}
    />
  );
}
