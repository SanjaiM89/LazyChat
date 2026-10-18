"use client";

import * as React from "react";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, updateProfile } from "firebase/auth";
import { Sparkles } from "lucide-react";
import { auth } from "@/lib/firebase/client";
import { createUserDoc, getUser } from "@/lib/firebase/data";
import { setCookie, useAuth } from "@/lib/auth/AuthProvider";
import { isSuperEmail } from "@/lib/auth/shared";
import { Button, Spinner } from "@/components/ui";

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

  const input =
    "h-10 w-full rounded-lg border border-border bg-bg px-3 text-[14px] text-fg placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-accent/50";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm animate-[fade-in-up_0.3s_ease-out]">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-strong text-white">
            <Sparkles size={20} />
          </div>
          <span className="text-xl font-bold text-fg">Omnia</span>
        </div>
        <form onSubmit={submit} className="space-y-3 rounded-2xl border border-border bg-bg-elevated p-6 shadow-[var(--shadow-soft)]">
          <h1 className="text-[17px] font-semibold text-fg">{mode === "signin" ? "Sign in" : "Create your account"}</h1>
          {disabled && (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
              Your account or organization has been disabled. Contact your administrator.
            </p>
          )}
          {mode === "signup" && (
            <input className={input} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          )}
          <input className={input} type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          <input
            className={input}
            type="password"
            required
            minLength={6}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
          />
          {error && <p className="text-[13px] text-danger">{error}</p>}
          {info && <p className="text-[13px] text-success">{info}</p>}
          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
            {busy ? <Spinner /> : mode === "signin" ? "Sign in" : "Sign up"}
          </Button>
          <div className="flex items-center justify-between text-[13px] text-fg-secondary">
            <button type="button" className="hover:text-fg" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); }}>
              {mode === "signin" ? "Create an account" : "I already have an account"}
            </button>
            {mode === "signin" && (
              <button type="button" className="hover:text-fg" onClick={reset}>
                Forgot password?
              </button>
            )}
          </div>
        </form>
        <p className="mt-4 text-center text-[12px] text-fg-muted">
          Invited to an organization? Sign up with the invited email and you&apos;ll be added automatically.
        </p>
      </div>
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
