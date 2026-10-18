# Auth, organizations and the super-admin panel

## Setup (once)

1. Firebase Console > Authentication > Sign-in method: enable **Email/Password**.
2. Firebase Console > Firestore Database: create the database.
3. Put the web config in `.env.local` (see `.env.example`), plus `SUPER_ADMIN_EMAIL`,
   `NEXT_PUBLIC_SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD`, `OMNIA_INTERNAL_TOKEN`, `SANDBOX_SECRET`.
4. Deploy the rules: `npx firebase-tools deploy --only firestore:rules`.
   `firestore.rules` identifies the super admin by the literal email `super@admin.com` - change it there if you change `SUPER_ADMIN_EMAIL`.
5. `npm run seed:admin` creates the super-admin account. **Run it before anyone else can sign up**: the super admin is
   whoever owns that email.
6. Chats saved before accounts existed: the first non-admin user to sign in sees "Import N earlier items" in the sidebar menu; it moves them into their Firestore space.

## Model

| Collection | Fields |
|---|---|
| `users/{uid}` | email, displayName, orgId, orgRole (owner/admin/member), status |
| `orgs/{id}` | name, ownerUid, status |
| `invites/{email}` | orgId, orgRole, invitedBy |
| `conversations/{id}` | ownerId, orgId, title, timestamps, provider, model, usage, lastRun, messageCount |
| `conversations/{id}/messages/{i_c}` | idx, chunk, total, h (hash), json (one UI message, chunked at 250k chars) |

Chats are private to their owner. The server reads and writes them **as the user** (their ID token, so the rules apply).
Saves are incremental (only changed messages). If a background run outlives the token, the conversation is parked in
`data/outbox/` and pushed on the owner's next request; the browser also pings `/api/auth/session` after each token
refresh so long runs keep a fresh token.

Everything else (artifacts, agents, workspaces, brain memory, sandboxes) stays where it was, stamped with
`ownerId`. Provider keys, search providers, MCP servers and skills are stored per org (or per user without an org) in
`data/scopes/`.

## How requests are authenticated

The browser keeps the Firebase ID token in the `omnia_token` cookie. `proxy.ts` verifies it against Google's public keys
(`jose`), looks up the user's org/role in Firestore as that user (so the rules apply), strips any client-supplied
`x-omnia-*` headers and sets trusted ones. Route handlers read them through `requireUser` / `authed` / `scoped`
(`lib/auth`). `currentUser()` makes the user available to deep library code (config scoping, ownership stamps).

## Limits of the client-SDK-only design

- No Admin SDK, so "remove user" deletes the Firestore profile and blocks access, but the Firebase Auth record remains.
- Anyone can still create an Auth account with the project's API key; without an org they only get their own private space.
- Local (stdio) MCP servers run commands on the host as the server user. Org owners/admins (and users without an org) can add them, so only give those roles to people you trust with the machine.
