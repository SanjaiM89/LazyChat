import { createRemoteJWKSet, jwtVerify } from "jose";

const JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

export const FIREBASE_PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "";

export interface VerifiedToken {
  uid: string;
  email: string;
}

/** Verify a Firebase ID token's signature, issuer, audience and expiry. Returns null if invalid. */
export async function verifyIdToken(
  token: string | undefined | null,
  projectId: string = FIREBASE_PROJECT_ID,
  keys: Parameters<typeof jwtVerify>[1] = JWKS,
): Promise<VerifiedToken | null> {
  if (!token || !projectId) return null;
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
    });
    if (!payload.sub) return null;
    return { uid: payload.sub, email: String(payload.email ?? "").toLowerCase() };
  } catch {
    return null;
  }
}
