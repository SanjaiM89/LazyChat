#!/usr/bin/env node
// Creates (or signs into) the super-admin Firebase account. Credentials come from
// .env.local (SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD); nothing is hardcoded.
// Run once, BEFORE exposing the app: the super admin is identified by this email.
import fs from "node:fs";
import path from "node:path";
import { initializeApp } from "firebase/app";
import { createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword, updateProfile } from "firebase/auth";
import { doc, getDoc, getFirestore, serverTimestamp, setDoc } from "firebase/firestore";

for (const f of [".env.local", ".env"]) {
  const p = path.resolve(process.cwd(), f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const e = process.env;
const email = (e.SUPER_ADMIN_EMAIL ?? "").toLowerCase();
const password = e.SUPER_ADMIN_PASSWORD;
if (!email || !password) {
  console.error("Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD in .env.local");
  process.exit(1);
}

const app = initializeApp({
  apiKey: e.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: e.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: e.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: e.NEXT_PUBLIC_FIREBASE_APP_ID,
});
const auth = getAuth(app);
const db = getFirestore(app);

let cred;
try {
  cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: "Super Admin" });
  console.log(`Created Auth user ${email}`);
} catch (err) {
  if (err?.code !== "auth/email-already-in-use") throw err;
  cred = await signInWithEmailAndPassword(auth, email, password);
  console.log(`Auth user ${email} already exists`);
}

const ref = doc(db, "users", cred.user.uid);
if (!(await getDoc(ref).catch(() => null))?.exists?.()) {
  await setDoc(ref, {
    email,
    displayName: "Super Admin",
    orgId: null,
    orgRole: null,
    status: "active",
    createdAt: serverTimestamp(),
  });
  console.log("Wrote users/" + cred.user.uid);
}
console.log("Done. Sign in at /login — you will be taken to /admin.");
process.exit(0);
