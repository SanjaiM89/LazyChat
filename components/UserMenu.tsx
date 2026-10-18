"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { Building2, DatabaseBackup, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { OrgDialog } from "@/components/OrgDialog";
import { useAppStore } from "@/lib/app-store";

export function UserMenu() {
  const { user, profile, org, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [legacy, setLegacy] = useState(0);
  const [importing, setImporting] = useState(false);

  // Chats saved before accounts existed can be adopted once by whoever signs in first.
  useEffect(() => {
    void fetch("/api/legacy")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setLegacy((j?.chats ?? 0) + (j?.artifacts ?? 0)))
      .catch(() => {});
  }, []);

  async function importLegacy() {
    setImporting(true);
    try {
      await fetch("/api/legacy", { method: "POST" });
      setLegacy(0);
      void useAppStore.getState().loadConversations();
    } finally {
      setImporting(false);
    }
  }
  if (!user) return null;
  const label = profile?.displayName || user.displayName || user.email || "Account";
  const row =
    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-fg-secondary hover:bg-bg-hover hover:text-fg transition-colors";
  return (
    <>
      <button onClick={() => setOpen(true)} className={row}>
        <Building2 size={15} className="text-accent" />
        <span className="truncate">{org ? org.name : "Create organization"}</span>
      </button>
      {legacy > 0 && (
        <button onClick={() => void importLegacy()} disabled={importing} className={row}>
          <DatabaseBackup size={15} className="text-accent" />
          <span className="truncate">{importing ? "Importing…" : `Import ${legacy} earlier item${legacy === 1 ? "" : "s"}`}</span>
        </button>
      )}
      <div className="mt-1 flex items-center gap-2 border-t border-border px-3 pt-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent">
          {label.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] text-fg">{label}</div>
          {profile?.orgRole && <div className="text-[11px] text-fg-muted">{profile.orgRole}</div>}
        </div>
        <button onClick={() => void signOut()} title="Sign out" className="rounded p-1.5 text-fg-muted hover:bg-bg-hover hover:text-fg">
          <LogOut size={15} />
        </button>
      </div>
      <OrgDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
