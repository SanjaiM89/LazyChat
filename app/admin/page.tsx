"use client";

import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signOut as fbSignOut, updateProfile } from "firebase/auth";
import { Building2, KeyRound, LogOut, Plus, Power, ShieldCheck, Trash2, Users } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { auth, db, secondaryAuth } from "@/lib/firebase/client";
import {
  assignUser,
  createInvite,
  createUserDoc,
  deleteInvite,
  deleteOrg,
  deleteUserDoc,
  listAllInvites,
  listAllUsers,
  listOrgs,
  renameOrg,
  setOrgStatus,
  setUserStatus,
  type InviteDoc,
  type OrgDoc,
  type UserDoc,
} from "@/lib/firebase/data";
import type { OrgRole } from "@/lib/auth/shared";
import { Badge, Button, Modal, Spinner } from "@/components/ui";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";

const input =
  "h-9 rounded-lg border border-border bg-bg px-3 text-[13px] text-fg placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-accent/50";

type Tab = "orgs" | "users";

export default function AdminPage() {
  const router = useRouter();
  const { user, ready, isSuper, signOut } = useAuth();
  const [tab, setTab] = useState<Tab>("orgs");
  const [orgs, setOrgs] = useState<OrgDoc[]>([]);
  const [users, setUsers] = useState<UserDoc[]>([]);
  const [invites, setInvites] = useState<InviteDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrg, setSelectedOrg] = useState<string | null>(null);
  const [newOrg, setNewOrg] = useState("");
  const [userModal, setUserModal] = useState(false);

  useEffect(() => {
    if (ready && !isSuper) router.replace(user ? "/" : "/login");
  }, [ready, isSuper, user, router]);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [o, u, i] = await Promise.all([listOrgs(), listAllUsers(), listAllInvites()]);
      setOrgs(o);
      setUsers(u);
      setInvites(i);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready && isSuper) void reload();
  }, [ready, isSuper, reload]);

  async function act(fn: () => Promise<unknown>, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const members = (id: string) => users.filter((u) => u.orgId === id);
  const org = orgs.find((o) => o.id === selectedOrg) ?? null;

  if (!ready || !isSuper) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg">
        <Spinner />
      </div>
    );
  }

  // Super admin creates an org they don't belong to: owner is assigned later via a member.
  async function createOrgDoc() {
    const name = newOrg.trim();
    if (!name) return;
    await act(async () => {
      await addDoc(collection(db, "orgs"), { name, ownerUid: "", status: "active", createdAt: serverTimestamp() });
      setNewOrg("");
    });
  }

  const th = "px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-fg-muted";
  const td = "px-3 py-2.5 text-[13px] text-fg";

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="flex items-center gap-3 border-b border-border bg-bg-elevated px-6 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent-strong text-white">
          <ShieldCheck size={17} />
        </div>
        <div className="flex-1">
          <div className="text-[15px] font-semibold">Omnia Super Admin</div>
          <div className="text-[12px] text-fg-muted">{user?.email}</div>
        </div>
        <Button variant="ghost" onClick={() => void signOut()}>
          <LogOut size={14} /> Sign out
        </Button>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 p-6">
        <div className="flex gap-1 rounded-xl bg-bg-subtle p-1 w-fit">
          {([
            ["orgs", "Organizations", Building2],
            ["users", "Users", Users],
          ] as const).map(([k, label, Icon]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] ${tab === k ? "bg-bg-elevated text-fg shadow-sm" : "text-fg-secondary hover:text-fg"}`}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
        {loading && <Spinner />}

        {tab === "orgs" && (
          <section className="space-y-3">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void createOrgDoc();
              }}
            >
              <input className={`${input} w-72`} placeholder="New organization name" value={newOrg} onChange={(e) => setNewOrg(e.target.value)} />
              <Button type="submit" variant="primary" disabled={!newOrg.trim()}>
                <Plus size={14} /> Create
              </Button>
            </form>
            <div className="overflow-hidden rounded-xl border border-border bg-bg-elevated">
              <table className="w-full">
                <thead className="border-b border-border">
                  <tr>
                    <th className={th}>Name</th>
                    <th className={th}>Members</th>
                    <th className={th}>Status</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {orgs.map((o) => (
                    <tr key={o.id} className="hover:bg-bg-hover/50">
                      <td className={td}>
                        <button className="font-medium hover:text-accent" onClick={() => setSelectedOrg(o.id)}>
                          {o.name}
                        </button>
                      </td>
                      <td className={td}>{members(o.id).length}</td>
                      <td className={td}>
                        <Badge tone={o.status === "active" ? "success" : "danger"}>{o.status}</Badge>
                      </td>
                      <td className={`${td} text-right`}>
                        <button
                          title={o.status === "active" ? "Disable" : "Enable"}
                          className="rounded p-1.5 text-fg-muted hover:bg-bg-hover hover:text-fg"
                          onClick={() => void act(() => setOrgStatus(o.id, o.status === "active" ? "disabled" : "active"))}
                        >
                          <Power size={14} />
                        </button>
                        <button
                          title="Delete"
                          className="rounded p-1.5 text-fg-muted hover:bg-bg-hover hover:text-danger"
                          onClick={() => void act(() => deleteOrg(o.id), `Delete "${o.name}"? Members are kept but detached from the organization.`)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!loading && orgs.length === 0 && (
                    <tr>
                      <td className={`${td} text-fg-muted`} colSpan={4}>
                        No organizations yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === "users" && (
          <section className="space-y-3">
            <Button variant="primary" onClick={() => setUserModal(true)}>
              <Plus size={14} /> Create user
            </Button>
            <div className="overflow-hidden rounded-xl border border-border bg-bg-elevated">
              <table className="w-full">
                <thead className="border-b border-border">
                  <tr>
                    <th className={th}>User</th>
                    <th className={th}>Organization</th>
                    <th className={th}>Role</th>
                    <th className={th}>Status</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {users.map((u) => (
                    <tr key={u.uid}>
                      <td className={td}>
                        <div>{u.displayName || u.email}</div>
                        <div className="text-[12px] text-fg-muted">{u.email}</div>
                      </td>
                      <td className={td}>
                        <select
                          className={input}
                          value={u.orgId ?? ""}
                          onChange={(e) => void act(() => assignUser(u.uid, e.target.value || null, e.target.value ? (u.orgRole ?? "member") : null))}
                        >
                          <option value="">— none —</option>
                          {orgs.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={td}>
                        {u.orgId ? (
                          <select className={input} value={u.orgRole ?? "member"} onChange={(e) => void act(() => assignUser(u.uid, u.orgId, e.target.value as OrgRole))}>
                            <option value="owner">owner</option>
                            <option value="admin">admin</option>
                            <option value="member">member</option>
                          </select>
                        ) : (
                          <span className="text-fg-muted">—</span>
                        )}
                      </td>
                      <td className={td}>
                        <Badge tone={u.status === "active" ? "success" : "danger"}>{u.status}</Badge>
                      </td>
                      <td className={`${td} text-right whitespace-nowrap`}>
                        <button
                          title="Send password reset email"
                          className="rounded p-1.5 text-fg-muted hover:bg-bg-hover hover:text-fg"
                          onClick={() => void act(() => sendPasswordResetEmail(auth, u.email))}
                        >
                          <KeyRound size={14} />
                        </button>
                        <button
                          title={u.status === "active" ? "Disable" : "Enable"}
                          className="rounded p-1.5 text-fg-muted hover:bg-bg-hover hover:text-fg"
                          onClick={() => void act(() => setUserStatus(u.uid, u.status === "active" ? "disabled" : "active"))}
                        >
                          <Power size={14} />
                        </button>
                        <button
                          title="Remove user"
                          className="rounded p-1.5 text-fg-muted hover:bg-bg-hover hover:text-danger"
                          onClick={() =>
                            void act(
                              () => deleteUserDoc(u.uid),
                              `Remove ${u.email}? Their profile is deleted and they lose access. (Their sign-in record stays in Firebase Auth; delete it from the Firebase console if needed.)`,
                            )
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>

      <Modal open={!!org} onClose={() => setSelectedOrg(null)} title={org?.name} subtitle="Organization detail" width="max-w-xl">
        {org && (
          <OrgDetail
            org={org}
            members={members(org.id)}
            invites={invites.filter((i) => i.orgId === org.id)}
            adminUid={user!.uid}
            act={act}
          />
        )}
      </Modal>

      <CreateUserModal
        open={userModal}
        orgs={orgs}
        onClose={() => setUserModal(false)}
        onCreated={() => {
          setUserModal(false);
          void reload();
        }}
      />
    </div>
  );
}

function OrgDetail({
  org,
  members,
  invites,
  adminUid,
  act,
}: {
  org: OrgDoc;
  members: UserDoc[];
  invites: InviteDoc[];
  adminUid: string;
  act: (fn: () => Promise<unknown>, confirmMsg?: string) => Promise<void>;
}) {
  const [name, setName] = useState(org.name);
  const [email, setEmail] = useState("");
  return (
    <div className="space-y-4 p-1">
      <div className="flex gap-2">
        <input className={`${input} flex-1`} value={name} onChange={(e) => setName(e.target.value)} />
        <Button disabled={!name.trim() || name === org.name} onClick={() => void act(() => renameOrg(org.id, name))}>
          Rename
        </Button>
      </div>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {members.map((m) => (
          <li key={m.uid} className="flex items-center gap-2 px-3 py-2 text-[13px]">
            <span className="flex-1 truncate">{m.email}</span>
            <Badge>{m.orgRole}</Badge>
            <button className="rounded p-1 text-fg-muted hover:text-danger" title="Remove from organization" onClick={() => void act(() => assignUser(m.uid, null, null))}>
              <Trash2 size={14} />
            </button>
          </li>
        ))}
        {members.length === 0 && <li className="px-3 py-2 text-[13px] text-fg-muted">No members.</li>}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!email.trim()) return;
          void act(async () => {
            await createInvite(email, org.id, "admin", adminUid);
            setEmail("");
          });
        }}
      >
        <input className={`${input} flex-1`} type="email" placeholder="Invite admin by email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button type="submit" variant="primary" disabled={!email.trim()}>
          Invite
        </Button>
      </form>
      {invites.map((i) => (
        <div key={i.email} className="flex items-center gap-2 text-[13px] text-fg-secondary">
          <span className="flex-1">{i.email}</span>
          <Badge>{i.orgRole} · pending</Badge>
          <button className="text-fg-muted hover:text-danger" onClick={() => void act(() => deleteInvite(i.email))}>
            Revoke
          </button>
        </div>
      ))}
    </div>
  );
}

function CreateUserModal({
  open,
  orgs,
  onClose,
  onCreated,
}: {
  open: boolean;
  orgs: OrgDoc[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgId, setOrgId] = useState("");
  const [role, setRole] = useState<OrgRole>("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Created via a second Firebase app so the admin stays signed in.
      const sec = secondaryAuth();
      const cred = await createUserWithEmailAndPassword(sec, email.trim(), password);
      await updateProfile(cred.user, { displayName: name.trim() || email.split("@")[0] });
      await fbSignOut(sec);
      await createUserDoc(cred.user.uid, email.trim(), name.trim() || email.split("@")[0]);
      if (orgId) await assignUser(cred.user.uid, orgId, role);
      setName("");
      setEmail("");
      setPassword("");
      setOrgId("");
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create user" width="max-w-md">
      <form onSubmit={submit} className="space-y-2 p-1">
        <input className={`${input} w-full`} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={`${input} w-full`} type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className={`${input} w-full`} type="password" required minLength={6} placeholder="Initial password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="flex gap-2">
          <select className={`${input} flex-1`} value={orgId} onChange={(e) => setOrgId(e.target.value)}>
            <option value="">No organization</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <select className={input} value={role} disabled={!orgId} onChange={(e) => setRole(e.target.value as OrgRole)}>
            <option value="member">member</option>
            <option value="admin">admin</option>
            <option value="owner">owner</option>
          </select>
        </div>
        {error && <p className="text-[13px] text-danger">{error}</p>}
        <Button type="submit" variant="primary" className="w-full" disabled={busy}>
          {busy ? <Spinner /> : "Create"}
        </Button>
      </form>
    </Modal>
  );
}
