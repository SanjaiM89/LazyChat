"use client";

import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signOut as fbSignOut, updateProfile } from "firebase/auth";
import { Building2, KeyRound, LogOut, Mail, Plus, Power, ShieldCheck, Trash2, Users } from "lucide-react";
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
import { Badge, Button, Modal, Segmented, Spinner } from "@/components/ui";
import { OmniaLogo } from "@/components/brand/OmniaLogo";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";

const input =
  "h-8 rounded-md border border-border-strong bg-bg-control px-2.5 text-[13px] text-fg placeholder:text-fg-faint transition-[border-color,box-shadow] duration-200 hover:border-border-stronger focus:outline-none focus:border-brand/60 focus:shadow-[0_0_0_3px_var(--accent-soft)]";

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
        <Spinner className="text-accent" size={20} />
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

  const th = "bg-bg-surface-100 px-4 py-2 text-left font-mono text-[11px] font-normal uppercase tracking-wider text-fg-muted";
  const td = "px-4 py-2.5 text-[13px] text-fg";
  const iconBtn = "rounded-md p-1.5 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg";
  const activeOrgs = orgs.filter((o) => o.status === "active").length;
  const stats = [
    { label: "Organizations", value: orgs.length, icon: <Building2 size={14} /> },
    { label: "Active orgs", value: activeOrgs, icon: <Power size={14} /> },
    { label: "Users", value: users.length, icon: <Users size={14} /> },
    { label: "Pending invites", value: invites.length, icon: <Mail size={14} /> },
  ];

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="glass sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border px-6">
        <OmniaLogo height={20} />
        <span className="text-fg-faint">/</span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-accent-soft px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wider text-accent">
          <ShieldCheck size={11} /> Super admin
        </span>
        <div className="flex-1" />
        <span className="hidden text-[12px] text-fg-muted sm:inline">{user?.email}</span>
        <Button variant="ghost" size="sm" onClick={() => void signOut()}>
          <LogOut size={14} /> Sign out
        </Button>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 p-6">
        <div className="animate-fade-in-up">
          <p className="eyebrow">Administration</p>
          <h1 className="mt-1 text-[22px] font-medium tracking-[-0.01em]">Organizations &amp; users</h1>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 stagger [--stagger:60ms]">
          {stats.map((s) => (
            <div key={s.label} className="lift relative overflow-hidden rounded-lg border border-border bg-bg-surface-100 p-4">
              <div className="flex items-center justify-between text-fg-muted">
                <span className="font-mono text-[10.5px] uppercase tracking-wider">{s.label}</span>
                <span className="text-accent">{s.icon}</span>
              </div>
              <div className="mt-2 text-[26px] font-medium tabular-nums tracking-tight">{loading ? <span className="skeleton inline-block h-7 w-10" /> : s.value}</div>
            </div>
          ))}
        </div>

        <Segmented
          className="w-[260px]"
          value={tab}
          onChange={setTab}
          options={[
            { value: "orgs", label: "Organizations", icon: <Building2 size={13} /> },
            { value: "users", label: "Users", icon: <Users size={13} /> },
          ]}
        />

        {error && <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] text-danger animate-scale-in">{error}</p>}
        {loading && <Spinner className="text-accent" />}

        {tab === "orgs" && (
          <section className="space-y-3 animate-fade-in-up">
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
            <div className="overflow-hidden rounded-lg border border-border bg-bg-elevated shadow-soft">
              <table className="w-full">
                <thead className="border-b border-border">
                  <tr>
                    <th className={th}>Name</th>
                    <th className={th}>Members</th>
                    <th className={th}>Status</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-muted">
                  {orgs.map((o) => (
                    <tr key={o.id} className="transition-colors hover:bg-bg-hover">
                      <td className={td}>
                        <button className="font-medium transition-colors hover:text-accent" onClick={() => setSelectedOrg(o.id)}>
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
                          className={iconBtn}
                          onClick={() => void act(() => setOrgStatus(o.id, o.status === "active" ? "disabled" : "active"))}
                        >
                          <Power size={14} />
                        </button>
                        <button
                          title="Delete"
                          className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-danger-soft hover:text-danger"
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
          <section className="space-y-3 animate-fade-in-up">
            <Button variant="primary" onClick={() => setUserModal(true)}>
              <Plus size={14} /> Create user
            </Button>
            <div className="overflow-hidden rounded-lg border border-border bg-bg-elevated shadow-soft">
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
                <tbody className="divide-y divide-border-muted">
                  {users.map((u) => (
                    <tr key={u.uid} className="transition-colors hover:bg-bg-hover">
                      <td className={td}>
                        <div>{u.displayName || u.email}</div>
                        <div className="font-mono text-[11.5px] text-fg-muted">{u.email}</div>
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
                          className={iconBtn}
                          onClick={() => void act(() => sendPasswordResetEmail(auth, u.email))}
                        >
                          <KeyRound size={14} />
                        </button>
                        <button
                          title={u.status === "active" ? "Disable" : "Enable"}
                          className={iconBtn}
                          onClick={() => void act(() => setUserStatus(u.uid, u.status === "active" ? "disabled" : "active"))}
                        >
                          <Power size={14} />
                        </button>
                        <button
                          title="Remove user"
                          className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-danger-soft hover:text-danger"
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
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-bg-surface-100">
        {members.map((m) => (
          <li key={m.uid} className="flex items-center gap-2 px-3 py-2 text-[13px]">
            <span className="flex-1 truncate">{m.email}</span>
            <Badge>{m.orgRole}</Badge>
            <button className="rounded-md p-1 text-fg-muted transition-colors hover:bg-danger-soft hover:text-danger" title="Remove from organization" onClick={() => void act(() => assignUser(m.uid, null, null))}>
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
          <button className="text-[12px] text-fg-muted transition-colors hover:text-danger" onClick={() => void act(() => deleteInvite(i.email))}>
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
      <form onSubmit={submit} className="space-y-2.5 p-1">
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
