"use client";

import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { Trash2, UserPlus, X } from "lucide-react";
import { Badge, Button, Modal } from "@/components/ui";
import { useAuth } from "@/lib/auth/AuthProvider";
import {
  createInvite,
  createOrg,
  deleteInvite,
  listInvites,
  listMembers,
  removeMember,
  renameOrg,
  setMemberRole,
  type InviteDoc,
  type UserDoc,
} from "@/lib/firebase/data";

const input =
  "h-8 rounded-md border border-border-strong bg-bg-control transition-[border-color,box-shadow] duration-200 hover:border-border-stronger px-2.5 text-[13px] text-fg placeholder:text-fg-faint focus:outline-none focus:border-brand/60 focus:shadow-[0_0_0_3px_var(--accent-soft)]";

export function OrgDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, profile, org, refresh } = useAuth();
  const [members, setMembers] = useState<UserDoc[]>([]);
  const [invites, setInvites] = useState<InviteDoc[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManage = profile?.orgRole === "owner" || profile?.orgRole === "admin";
  const orgId = org?.id;

  const reload = useCallback(async () => {
    if (!orgId) return;
    try {
      setMembers(await listMembers(orgId));
      if (canManage) setInvites(await listInvites(orgId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [orgId, canManage]);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  async function run(fn: () => Promise<unknown>, refreshSelf = false) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (refreshSelf) await refresh();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={org ? org.name : "Organization"} subtitle="Members and access" width="max-w-xl">
      <div className="space-y-4 p-1">
        {error && <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] text-danger animate-fade-in-up">{error}</p>}

        {!org && user && (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) void run(() => createOrg(name, user.uid), true);
            }}
          >
            <p className="text-[13px] text-fg-secondary">
              You&apos;re not in an organization. Create one to invite teammates and share provider keys, skills and
              connections, or ask an admin to invite your email.
            </p>
            <div className="flex gap-2">
              <input className={`${input} flex-1`} placeholder="Organization name" value={name} onChange={(e) => setName(e.target.value)} />
              <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
                Create
              </Button>
            </div>
          </form>
        )}

        {org && (
          <>
            {canManage && (
              <div className="flex gap-2">
                <input
                  className={`${input} flex-1`}
                  defaultValue={org.name}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== org.name) void run(() => renameOrg(org.id, v), true);
                  }}
                  aria-label="Organization name"
                />
              </div>
            )}

            <section>
              <h3 className="mb-2 eyebrow">Members ({members.length})</h3>
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-bg-surface-100 stagger [--stagger:35ms]">
                {members.map((m) => (
                  <li key={m.uid} className="flex items-center gap-2.5 px-3 py-2 text-[13px] transition-colors hover:bg-bg-hover">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-600 p-px">
                      <span className="flex h-full w-full items-center justify-center rounded-full bg-bg-surface-200 text-[11px] font-semibold text-accent">
                        {(m.displayName || m.email || "?").charAt(0).toUpperCase()}
                      </span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-fg">{m.displayName || m.email}</div>
                      <div className="truncate text-[12px] text-fg-muted">{m.email}</div>
                    </div>
                    {m.orgRole === "owner" || !canManage || m.uid === user?.uid ? (
                      <Badge>{m.orgRole}</Badge>
                    ) : (
                      <>
                        <select
                          className={input}
                          value={m.orgRole ?? "member"}
                          onChange={(e) => void run(() => setMemberRole(m.uid, e.target.value as "admin" | "member"))}
                        >
                          <option value="member">member</option>
                          <option value="admin">admin</option>
                        </select>
                        <button
                          title="Remove from organization"
                          className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-danger-soft hover:text-danger"
                          onClick={() => void run(() => removeMember(m.uid))}
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            {canManage && (
              <section>
                <h3 className="mb-2 eyebrow">Invite</h3>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!email.trim() || !user) return;
                    void run(async () => {
                      await createInvite(email, org.id, inviteRole, user.uid);
                      setEmail("");
                    });
                  }}
                >
                  <input className={`${input} flex-1`} type="email" placeholder="teammate@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                  <select className={input} value={inviteRole} onChange={(e) => setInviteRole(e.target.value as "admin" | "member")}>
                    <option value="member">member</option>
                    <option value="admin">admin</option>
                  </select>
                  <Button type="submit" variant="primary" disabled={busy || !email.trim()}>
                    <UserPlus size={14} /> Invite
                  </Button>
                </form>
                <p className="mt-1.5 text-[12px] text-fg-muted">They join automatically when they sign up or sign in with this email.</p>
                {invites.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {invites.map((i) => (
                      <li key={i.email} className="flex items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-1.5 text-[13px] text-fg-secondary animate-fade-in-up">
                        <span className="flex-1 truncate">{i.email}</span>
                        <Badge>{i.orgRole} · pending</Badge>
                        <button className="rounded-md p-1 text-fg-muted transition-colors hover:bg-danger-soft hover:text-danger" title="Revoke" onClick={() => void run(() => deleteInvite(i.email))}>
                          <X size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
