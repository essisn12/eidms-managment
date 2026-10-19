// UMS configuration tables managed through the generic CRUD manager (admin only; also the API whitelist).
export type UmsTable = { key: string; label: string; group: string };

export const UMS_TABLES: UmsTable[] = [
  { key: "UMS_APPCONFIG", label: "Applications", group: "Structure" },
  { key: "UMS_MODULECONFIG", label: "Modules", group: "Structure" },
  { key: "UMS_FEATURECONFIG", label: "Features", group: "Structure" },
  { key: "UMS_MENU", label: "Menu", group: "Structure" },
  { key: "UMS_ROLE", label: "Roles", group: "Users" },
  { key: "UMS_CATEGORY", label: "User Categories", group: "Users" },
  { key: "UMS_PASSPOLICY", label: "Password Policy", group: "Users" },
  { key: "UMS_NOTIFICATION_TYPE", label: "Notification Types", group: "Notifications" },
];

export const isUmsTable = (key: string) => UMS_TABLES.some((t) => t.key === key.toUpperCase());
