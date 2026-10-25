import type { OrgRole } from "@/lib/auth/shared";

export interface UserDoc {
  uid: string;
  email: string;
  displayName: string;
  orgId: string | null;
  orgRole: OrgRole | null;
  status: "active" | "disabled";
}
export interface OrgDoc {
  id: string;
  name: string;
  ownerUid: string;
  status: "active" | "disabled";
}
export interface InviteDoc {
  email: string;
  orgId: string;
  orgRole: Exclude<OrgRole, "owner">;
  invitedBy: string;
}

export async function getUser(_uid: string): Promise<UserDoc | null> { return null; }
export async function createUserDoc(_uid: string, _email: string, _displayName: string) {}
export async function acceptInvite(_uid: string, _email: string): Promise<string | null> { return null; }
export async function getOrg(_id: string): Promise<OrgDoc | null> { return null; }
export async function listOrgs(): Promise<OrgDoc[]> { return []; }
