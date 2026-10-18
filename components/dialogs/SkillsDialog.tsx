"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { BookOpen, Plus, Trash2 } from "lucide-react";
import { Modal, Button, Badge, Toggle, Spinner } from "@/components/ui";
import { useAppStore } from "@/lib/app-store";
import type { SkillDef } from "@/lib/types";


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
        <div className="space-y-2 rounded-lg border border-border bg-bg-surface-100 p-3.5">
          <div className="eyebrow flex items-center gap-2">
            <Plus size={12} className="text-accent" /> Add a skill
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Skill name (e.g. 'SQL expert')"
            className="w-full rounded-md border border-border-strong bg-bg-control transition-[border-color,box-shadow] duration-200 hover:border-border-stronger px-2.5 py-1.5 text-[13px] text-fg placeholder:text-fg-faint focus:outline-none focus:border-brand/60 focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="One-line description of what it does"
            className="w-full rounded-md border border-border-strong bg-bg-control transition-[border-color,box-shadow] duration-200 hover:border-border-stronger px-2.5 py-1.5 text-[13px] text-fg placeholder:text-fg-faint focus:outline-none focus:border-brand/60 focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          />
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Instructions the model should follow when this skill applies…"
            rows={3}
            className="w-full resize-none rounded-md border border-border-strong bg-bg-control transition-[border-color,box-shadow] duration-200 hover:border-border-stronger px-2.5 py-1.5 text-[13px] text-fg placeholder:text-fg-faint focus:outline-none focus:border-brand/60 focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          />
          <div className="flex justify-end">
            <Button variant="primary" onClick={add} disabled={busy || !name.trim() || !description.trim()}>
              {busy ? <Spinner size={13} /> : <Plus size={14} />}
              Add skill
            </Button>
          </div>
        </div>

        {skills.length === 0 && (
          <p className="rounded-lg border border-dashed border-border py-6 text-center text-[13px] text-fg-muted">
            No skills yet — add one above.
          </p>
        )}
        <div className="space-y-2 stagger [--stagger:45ms]">
          {skills.map((s) => (
            <div
              key={s.id}
              className="lift group flex items-start gap-3 rounded-lg border border-border bg-bg-surface-100 p-3 hover:border-border-strong"
            >
              <span className="brand-tile brand-tile-glow mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-bg-surface-200 text-accent">
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
                  className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted opacity-60 transition-all group-hover:opacity-100 hover:bg-danger-soft hover:text-danger"
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
