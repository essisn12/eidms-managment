import { z } from "zod";

/** Admin-assigned starting password; exempt from the password policy but always forces a change at next login. */
export const DEFAULT_PASSWORD = "123456";

export const USER_ID = /^[A-Za-z0-9_.@-]{1,50}$/;

const req = (max: number) => z.string().trim().min(1).max(max);
const opt = (max: number) => z.string().trim().max(max).nullish();

export const userFields = z.object({
  NAME: req(255),
  CATEGORYID: z.coerce.number().int().positive(),
  CELLNO: req(255),
  EMAIL: z.string().trim().min(1).max(255).email(),
  DOB: req(255),
  CATIDVAL: req(50),
  MFA: z.enum(["Y", "N"]),
  MACADDRESS: opt(50),
  IPADDRESS: opt(50),
  RECSTATUS: z.enum(["A", "I"]),
});

const id = z.coerce.number().int().positive();

export const permissionFields = z.object({
  levelId: id,
  branchId: id,
  wingId: id,
  sectionId: id,
  designationId: id,
  nameBangla: req(255),
  nameEnglish: req(255),
});

export const createUserBody = userFields.extend({
  permission: permissionFields.nullish(),
  USERID: z.string().trim().regex(USER_ID, "User ID may contain letters, digits and _ . @ - only"),
  password: z.string().min(1).max(200),
  forceChange: z.boolean().default(true),
  roles: z.array(z.number().int().positive()).default([]),
});

export const updateUserBody = userFields.extend({
  roles: z.array(z.number().int().positive()).optional(),
});

export const actionBody = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("reset-password"),
    password: z.string().min(1).max(200),
    forceChange: z.boolean().default(true),
  }),
  z.object({ action: z.literal("extend-expiry"), days: z.coerce.number().int().min(1).max(3650) }),
  z.object({ action: z.literal("unlock") }),
]);

export const permissionsBody = z.object({
  grants: z.array(
    z.object({
      featureId: z.string().min(1).max(12),
      CREATEYN: z.boolean(),
      EDITYN: z.boolean(),
      DELETEYN: z.boolean(),
      VIEWDETAILYN: z.boolean(),
      AUTHYN: z.boolean(),
      CANCELYN: z.boolean(),
    }),
  ),
});
