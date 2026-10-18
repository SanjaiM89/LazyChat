import fs from "node:fs";
import path from "node:path";

import { authed } from "@/lib/auth/context";
import { readJSON, writeJSON, saveConversation, type StoredConversation } from "@/lib/store";
import { ARTIFACTS_DIR } from "@/lib/artifacts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Pre-auth data (chats in data/conversations.json, artifacts with no owner) can be adopted once by a signed-in
 * user. Chats move into their Firestore space; the first caller wins and the local copies are removed.
 */
const INDEX = path.join(ARTIFACTS_DIR, "_index.json");

const readIndex = (): Array<{ ownerId?: string }> => {
  try {
    return JSON.parse(fs.readFileSync(INDEX, "utf8"));
  } catch {
    return [];
  }
};

export const GET = authed(async () => {
  const chats = (await readJSON<StoredConversation[]>("conversations.json", [])).filter((c) => !c.ownerId);
  const artifacts = readIndex().filter((a) => !a.ownerId);
  return Response.json({ chats: chats.length, artifacts: artifacts.length });
});

export const POST = authed(async (_req, user) => {
  const all = await readJSON<StoredConversation[]>("conversations.json", []);
  const mine = all.filter((c) => !c.ownerId);
  let imported = 0;
  const kept = [...all];
  for (const c of mine) {
    await saveConversation(c, { uid: user.uid, orgId: user.orgId });
    kept.splice(kept.indexOf(c), 1);
    imported++;
    await writeJSON("conversations.json", kept); // progress survives a crash halfway through
  }
  const idx = readIndex();
  let artifacts = 0;
  for (const a of idx) {
    if (!a.ownerId) {
      a.ownerId = user.uid;
      artifacts++;
    }
  }
  if (artifacts) fs.writeFileSync(INDEX, JSON.stringify(idx, null, 2));
  return Response.json({ chats: imported, artifacts });
});
