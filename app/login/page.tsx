"use client";

import * as React from "react";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, updateProfile } from "firebase/auth";
import { ArrowRight, ShieldCheck, Bot, Network } from "lucide-react";
import { auth } from "@/lib/firebase/client";
import { createUserDoc, getUser } from "@/lib/firebase/data";
import { setCookie, useAuth } from "@/lib/auth/AuthProvider";
import { isSuperEmail } from "@/lib/auth/shared";
import { Button, Input, Spinner } from "@/components/ui";
import { OmniaLogo, OmniaMark } from "@/components/brand/OmniaLogo";
import { BrandIcon } from "@/components/brand/BrandIcon";

function friendly(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found"))
    return "Incorrect email or password.";
  if (code.includes("email-already-in-use")) return "An account with this email already exists.";
  if (code.includes("weak-password")) return "Password must be at least 6 characters.";
  if (code.includes("invalid-email")) return "That email address isn't valid.";
  if (code.includes("too-many-requests")) return "Too many attempts. Try again in a few minutes.";
  return (e as Error)?.message || "Something went wrong.";
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, ready, profile } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const disabled = params.get("disabled") === "1";

  // Already signed in (and not bounced here because disabled): go home.
  useEffect(() => {
    if (!ready || !user || disabled) return;
    router.replace(isSuperEmail(user.email) ? "/admin" : "/");
  }, [ready, user, disabled, router, profile]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === "signup") {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        const displayName = name.trim() || email.split("@")[0];
        await updateProfile(cred.user, { displayName });
        await createUserDoc(cred.user.uid, email.trim(), displayName);
      } else {
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        // Accounts created elsewhere (e.g. the Auth console) may lack a profile doc.
        if (!isSuperEmail(cred.user.email) && !(await getUser(cred.user.uid))) {
          await createUserDoc(cred.user.uid, cred.user.email ?? email.trim(), cred.user.displayName ?? email.split("@")[0]);
        }
      }
      // Set the cookie now so the first request after the redirect is already authenticated.
      setCookie(await auth.currentUser!.getIdToken());
      window.location.href = isSuperEmail(email) ? "/admin" : "/";
    } catch (err) {
      setError(friendly(err));
      setBusy(false);
    }
  }

  async function reset() {
    if (!email.trim()) return setError("Enter your email first.");
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setInfo("Password reset email sent.");
      setError(null);
    } catch (err) {
      setError(friendly(err));
    }
  }

  return (
    <main className="relative flex min-h-dvh bg-bg text-fg">
      {/* Brand side */}
      <section className="relative hidden w-[46%] max-w-[640px] flex-col justify-between overflow-hidden border-r border-border bg-bg-alternative p-10 lg:flex">
        <div className="hero-backdrop" aria-hidden>
          <div className="hero-grid" />
          <div className="hero-aurora" />
          <span className="hero-beam" style={{ top: "24%", animationDelay: "0.4s" }} />
          <span className="hero-beam" style={{ top: "68%", animationDelay: "3.6s", animationDuration: "9s" }} />
          <span className="hero-beam-v" style={{ left: "30%", animationDelay: "1.4s" }} />
          <span className="hero-beam-v" style={{ left: "78%", animationDelay: "5s", animationDuration: "11s" }} />
        </div>
        <div className="relative z-10 animate-fade-in">
          <OmniaLogo height={26} />
        </div>
        <div className="relative z-10 stagger [--stagger:90ms]">
          <OmniaMark size={64} animated className="mb-8" />
          <p className="eyebrow mb-3">AI workspace</p>
          <h2 className="max-w-md text-[34px] font-medium leading-[1.15] tracking-[-0.02em]">
            One workspace for <span className="text-brand-gradient">every model</span>, agent and answer.
          </h2>
          <p className="mt-4 max-w-sm text-[14px] leading-relaxed text-fg-muted">
            Chat with any provider, run sandboxed agents and ask the Company Brain — self-hosted and yours.
          </p>
          <ul className="mt-8 space-y-2.5 text-[13px] text-fg-secondary">
            {[
              { icon: <Network size={14} />, text: "Multi-provider chat with live model lists" },
              { icon: <Bot size={14} />, text: "Autonomous agents in local sandboxes" },
              { icon: <ShieldCheck size={14} />, text: "Organization-scoped data and access" },
            ].map((f) => (
              <li key={f.text} className="flex items-center gap-2.5">
                <span className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-bg-surface-200 text-accent">{f.icon}</span>
                {f.text}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative z-10 flex items-center gap-4 text-fg-muted animate-fade-in">
          {(["claude", "openai", "gemini", "deepseek", "qwen", "mistral", "ollama"] as const).map((k) => (
            <span key={k} className="opacity-60 grayscale transition-all duration-300 hover:scale-110 hover:opacity-100 hover:grayscale-0">
              <BrandIcon name={k} size={18} />
            </span>
          ))}
        </div>
      </section>

      {/* Form side */}
      <section className="relative flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-[380px] stagger [--stagger:70ms]">
          <div className="mb-8 flex justify-center lg:hidden">
            <OmniaLogo height={26} />
          </div>
          <div className="mb-6">
            <h1 className="text-[24px] font-medium tracking-[-0.01em] text-fg">
              {mode === "signin" ? "Welcome back" : "Get started"}
            </h1>
            <p className="mt-1 text-[13.5px] text-fg-muted">
              {mode === "signin" ? "Sign in to your account" : "Create a new account"}
            </p>
          </div>
          <form onSubmit={submit} className="space-y-4">
            {disabled && (
              <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] text-danger animate-scale-in">
                Your account or organization has been disabled. Contact your administrator.
              </p>
            )}
            {mode === "signup" && (
              <label className="block animate-fade-in-up">
                <span className="mb-1.5 block text-[13px] text-fg-secondary">Name</span>
                <Input className="h-9" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </label>
            )}
            <label className="block">
              <span className="mb-1.5 block text-[13px] text-fg-secondary">Email</span>
              <Input className="h-9" type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </label>
            <label className="block">
              <span className="mb-1.5 flex items-center justify-between text-[13px] text-fg-secondary">
                Password
                {mode === "signin" && (
                  <button type="button" className="text-[12px] text-fg-muted transition-colors hover:text-fg" onClick={reset}>
                    Forgot password?
                  </button>
                )}
              </span>
              <Input
                className="h-9"
                type="password"
                required
                minLength={6}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
              />
            </label>
            {error && <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] text-danger animate-scale-in">{error}</p>}
            {info && <p className="rounded-md border border-brand/30 bg-success-soft px-3 py-2 text-[13px] text-success animate-scale-in">{info}</p>}
            <Button type="submit" variant="primary" size="lg" className="group w-full" disabled={busy}>
              {busy ? (
                <Spinner />
              ) : (
                <>
                  {mode === "signin" ? "Sign in" : "Sign up"}
                  <ArrowRight size={15} className="transition-transform duration-300 group-hover:translate-x-0.5" />
                </>
              )}
            </Button>
          </form>
          <p className="mt-6 text-center text-[13px] text-fg-muted">
            {mode === "signin" ? "Don't have an account? " : "Have an account? "}
            <button
              type="button"
              className="text-fg underline decoration-border-stronger underline-offset-4 transition-colors hover:decoration-brand"
              onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); }}
            >
              {mode === "signin" ? "Sign up now" : "Sign in now"}
            </button>
          </p>
          <p className="mt-8 border-t border-border pt-4 text-center text-[12px] leading-relaxed text-fg-muted">
            Invited to an organization? Sign up with the invited email and you&apos;ll be added automatically.
          </p>
        </div>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
