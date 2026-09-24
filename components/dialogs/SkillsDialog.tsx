"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { BookOpen, Plus, Trash2, Loader2 } from "lucide-react";
import { Modal, Button, Badge, Toggle } from "@/components/ui";
import { useAppStore } from "@/lib/app-store";
import type { SkillDef } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Skills dialog — custom instructions the model follows in-chat.     */
/* ------------------------------------------------------------------ */

export function SkillsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const skills = useAppStore((s) => s.skills);
  const setSkills = useAppStore((s) => s.setSkills);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const res = await fetch("/api/skills", { cache: "no-store" });
    if (res.ok) setSkills(await res.json());
  };

  useEffect(() => {
    if (open) void refresh();
  }, [open]);

  const add = async () => {
    if (!name.trim() || !description.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, description, prompt }),
      });
      if (res.ok) {
        setSkills(await res.json());
        setName("");
        setDescription("");
        setPrompt("");
      }
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (s: SkillDef) => {
    await fetch("/api/skills", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...s, enabled: !s.enabled }),
    });
    void refresh();
  };

  const remove = async (id: string) => {
    await fetch(`/api/skills?id=${id}`, { method: "DELETE" });
    void refresh();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Skills"
      subtitle="Custom capabilities and instructions the model can follow in conversation."
      width="max-w-2xl"
    >
      <div className="space-y-4">
        {/* add form */}
        <div className="rounded-xl border border-border bg-bg-subtle/50 p-3.5 space-y-2">
          <div className="flex items-center gap-2 text-[13px] font-medium text-fg-secondary">
            <Plus size={14} className="text-accent" /> Add a skill
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Skill name (e.g. 'SQL expert')"
            className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-[13px] text-fg placeholder:text-fg-muted/60 focus:outline-none focus:border-accent/50"
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="One-line description of what it does"
            className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-[13px] text-fg placeholder:text-fg-muted/60 focus:outline-none focus:border-accent/50"
          />
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Instructions the model should follow when this skill applies…"
            rows={3}
            className="w-full resize-none rounded-lg border border-border bg-bg-elevated px-3 py-2 text-[13px] text-fg placeholder:text-fg-muted/60 focus:outline-none focus:border-accent/50"
          />
          <div className="flex justify-end">
            <Button variant="primary" onClick={add} disabled={busy || !name.trim() || !description.trim()}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Add skill
            </Button>
          </div>
        </div>

        {/* list */}
        {skills.length === 0 && (
          <p className="text-center text-[13px] text-fg-muted py-4">
            No skills yet — add one above.
          </p>
        )}
        <div className="space-y-2">
          {skills.map((s) => (
            <div
              key={s.id}
              className="flex items-start gap-3 rounded-xl border border-border bg-bg-elevated p-3"
            >
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <BookOpen size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-[13.5px] font-medium text-fg">{s.name}</p>
                  <Badge tone={s.enabled ? "success" : "neutral"}>
                    {s.enabled ? "enabled" : "disabled"}
                  </Badge>
                </div>
                <p className="mt-0.5 text-[12.5px] text-fg-secondary line-clamp-2">
                  {s.description}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Toggle checked={s.enabled} onChange={() => toggle(s)} label="enable" />
                <button
                  onClick={() => remove(s.id)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-muted hover:bg-danger-soft hover:text-danger transition-colors"
                  title="Delete skill"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
