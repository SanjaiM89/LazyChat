import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "./client";
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

const userFrom = (id: string, d: Record<string, unknown>): UserDoc => ({
  uid: id,
  email: String(d.email ?? ""),
  displayName: String(d.displayName ?? ""),
  orgId: (d.orgId as string | null) ?? null,
  orgRole: (d.orgRole as OrgRole | null) ?? null,
  status: d.status === "disabled" ? "disabled" : "active",
});
const orgFrom = (id: string, d: Record<string, unknown>): OrgDoc => ({
  id,
  name: String(d.name ?? ""),
  ownerUid: String(d.ownerUid ?? ""),
  status: d.status === "disabled" ? "disabled" : "active",
});

export async function getUser(uid: string): Promise<UserDoc | null> {
  const s = await getDoc(doc(db, "users", uid));
  return s.exists() ? userFrom(s.id, s.data()) : null;
}

export async function createUserDoc(uid: string, email: string, displayName: string) {
  await setDoc(doc(db, "users", uid), {
    email: email.toLowerCase(),
    displayName,
    orgId: null,
    orgRole: null,
    status: "active",
    createdAt: serverTimestamp(),
  });
}

/** Consume a pending invite for this email, if any. Returns the joined org id. */
export async function acceptInvite(uid: string, email: string): Promise<string | null> {
  const ref = doc(db, "invites", email.toLowerCase());
  const s = await getDoc(ref);
  if (!s.exists()) return null;
  const { orgId, orgRole } = s.data() as { orgId: string; orgRole: OrgRole };
  const b = writeBatch(db);
  b.update(doc(db, "users", uid), { orgId, orgRole });
  b.delete(ref);
  await b.commit();
  return orgId;
}

export async function createOrg(name: string, ownerUid: string): Promise<string> {
  const ref = doc(collection(db, "orgs"));
  const b = writeBatch(db);
  b.set(ref, { name: name.trim(), ownerUid, status: "active", createdAt: serverTimestamp() });
  b.update(doc(db, "users", ownerUid), { orgId: ref.id, orgRole: "owner" });
  await b.commit();
  return ref.id;
}

export async function getOrg(id: string): Promise<OrgDoc | null> {
  const s = await getDoc(doc(db, "orgs", id));
  return s.exists() ? orgFrom(s.id, s.data()) : null;
}

export async function listOrgs(): Promise<OrgDoc[]> {
  const s = await getDocs(collection(db, "orgs"));
  return s.docs.map((d) => orgFrom(d.id, d.data())).sort((a, b) => a.name.localeCompare(b.name));
}

export async function renameOrg(id: string, name: string) {
  await updateDoc(doc(db, "orgs", id), { name: name.trim() });
}

export async function setOrgStatus(id: string, status: "active" | "disabled") {
  await updateDoc(doc(db, "orgs", id), { status });
}

export async function listMembers(orgId: string): Promise<UserDoc[]> {
  const s = await getDocs(query(collection(db, "users"), where("orgId", "==", orgId)));
  return s.docs.map((d) => userFrom(d.id, d.data())).sort((a, b) => a.email.localeCompare(b.email));
}

export async function listAllUsers(): Promise<UserDoc[]> {
  const s = await getDocs(collection(db, "users"));
  return s.docs.map((d) => userFrom(d.id, d.data())).sort((a, b) => a.email.localeCompare(b.email));
}

export async function listInvites(orgId: string): Promise<InviteDoc[]> {
  const s = await getDocs(query(collection(db, "invites"), where("orgId", "==", orgId)));
  return s.docs.map((d) => ({ ...(d.data() as Omit<InviteDoc, "email">), email: d.id }));
}

export async function listAllInvites(): Promise<InviteDoc[]> {
  const s = await getDocs(collection(db, "invites"));
  return s.docs.map((d) => ({ ...(d.data() as Omit<InviteDoc, "email">), email: d.id }));
}

export async function createInvite(email: string, orgId: string, orgRole: InviteDoc["orgRole"], invitedBy: string) {
  await setDoc(doc(db, "invites", email.trim().toLowerCase()), {
    orgId,
    orgRole,
    invitedBy,
    createdAt: serverTimestamp(),
  });
}

export async function deleteInvite(email: string) {
  await deleteDoc(doc(db, "invites", email.toLowerCase()));
}

export async function setMemberRole(uid: string, orgRole: Exclude<OrgRole, "owner">) {
  await updateDoc(doc(db, "users", uid), { orgRole });
}

export async function removeMember(uid: string) {
  await updateDoc(doc(db, "users", uid), { orgId: null, orgRole: null });
}

export async function setUserStatus(uid: string, status: "active" | "disabled") {
  await updateDoc(doc(db, "users", uid), { status });
}

/** Super admin: move a user into an org (or out, with orgId=null). */
export async function assignUser(uid: string, orgId: string | null, orgRole: OrgRole | null) {
  await updateDoc(doc(db, "users", uid), { orgId, orgRole: orgId ? orgRole : null });
}

/** Super admin: delete the Firestore profile. The Auth record cannot be removed without the Admin SDK. */
export async function deleteUserDoc(uid: string) {
  await deleteDoc(doc(db, "users", uid));
}

/** Super admin: detach every member, drop pending invites, delete the org. */
export async function deleteOrg(orgId: string) {
  const [members, invites] = await Promise.all([listMembers(orgId), listInvites(orgId)]);
  const b = writeBatch(db);
  for (const m of members) b.update(doc(db, "users", m.uid), { orgId: null, orgRole: null });
  for (const i of invites) b.delete(doc(db, "invites", i.email));
  b.delete(doc(db, "orgs", orgId));
  await b.commit();
}
