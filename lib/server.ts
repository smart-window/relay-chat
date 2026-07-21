import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";

type Bindings = {
  DB: D1Database;
  MEDIA: R2Bucket;
};

export type AppUser = {
  id: string;
  displayName: string;
  handle: string;
  bio: string;
  lastSeen: number;
};

const bindings = env as unknown as Bindings;
let schemaReady: Promise<void> | null = null;

export function db() {
  if (!bindings.DB) throw new Error("Database is unavailable");
  return bindings.DB;
}

export function media() {
  if (!bindings.MEDIA) throw new Error("Media storage is unavailable");
  return bindings.MEDIA;
}

export async function ensureSchema() {
  if (!schemaReady) {
    const d1 = db();
    schemaReady = d1
      .batch([
        d1.prepare(`CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
          handle TEXT NOT NULL UNIQUE, bio TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL
        )`),
        d1.prepare(`CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'direct', title TEXT,
          created_at INTEGER NOT NULL
        )`),
        d1.prepare(`CREATE TABLE IF NOT EXISTS conversation_members (
          conversation_id TEXT NOT NULL, user_id TEXT NOT NULL, joined_at INTEGER NOT NULL,
          PRIMARY KEY (conversation_id, user_id)
        )`),
        d1.prepare(`CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, sender_id TEXT NOT NULL,
          kind TEXT NOT NULL, body TEXT, object_key TEXT, object_name TEXT,
          object_type TEXT, created_at INTEGER NOT NULL
        )`),
        d1.prepare(`CREATE TABLE IF NOT EXISTS uploads (
          id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE,
          object_name TEXT NOT NULL, object_type TEXT NOT NULL, size INTEGER NOT NULL,
          claimed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
        )`),
        d1.prepare(`CREATE INDEX IF NOT EXISTS messages_conversation_idx
          ON messages (conversation_id, created_at)`),
        d1.prepare(`CREATE TABLE IF NOT EXISTS calls (
          id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, caller_id TEXT NOT NULL,
          callee_id TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL,
          offer_sdp TEXT, answer_sdp TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        )`),
        d1.prepare(`CREATE INDEX IF NOT EXISTS calls_callee_idx
          ON calls (callee_id, status, updated_at)`),
        d1.prepare(`CREATE INDEX IF NOT EXISTS members_user_idx
          ON conversation_members (user_id, conversation_id)`),
      ])
      .then(() => undefined)
      .catch((error: unknown) => {
        schemaReady = null;
        throw error;
      });
  }
  return schemaReady;
}

function cleanHandle(email: string) {
  const base = email.split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 18);
  return base || "member";
}

export async function requireApiUser(): Promise<AppUser> {
  const identity = await getChatGPTUser();
  if (!identity) throw new Response("Authentication required", { status: 401 });
  await ensureSchema();

  const existing = await db()
    .prepare("SELECT id, display_name, handle, bio, last_seen FROM users WHERE email = ?")
    .bind(identity.email)
    .first<{ id: string; display_name: string; handle: string; bio: string; last_seen: number }>();

  const now = Date.now();
  if (existing) {
    await db().prepare("UPDATE users SET last_seen = ? WHERE id = ?").bind(now, existing.id).run();
    return {
      id: existing.id,
      displayName: existing.display_name,
      handle: existing.handle,
      bio: existing.bio,
      lastSeen: now,
    };
  }

  const id = crypto.randomUUID();
  let handle = cleanHandle(identity.email);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const taken = await db().prepare("SELECT id FROM users WHERE handle = ?").bind(handle).first();
    if (!taken) break;
    handle = `${cleanHandle(identity.email).slice(0, 14)}${Math.floor(1000 + Math.random() * 9000)}`;
  }
  const displayName = identity.fullName?.slice(0, 50) || handle;
  await db()
    .prepare("INSERT INTO users (id, email, display_name, handle, bio, created_at, last_seen) VALUES (?, ?, ?, ?, '', ?, ?)")
    .bind(id, identity.email, displayName, handle, now, now)
    .run();
  return { id, displayName, handle, bio: "", lastSeen: now };
}

export async function requireMembership(conversationId: string, userId: string) {
  const row = await db()
    .prepare("SELECT 1 AS ok FROM conversation_members WHERE conversation_id = ? AND user_id = ?")
    .bind(conversationId, userId)
    .first<{ ok: number }>();
  if (!row) throw new Response("Conversation not found", { status: 404 });
}

export function jsonError(error: unknown) {
  if (error instanceof Response) return error;
  console.error(error);
  return Response.json({ error: "Something went wrong" }, { status: 500 });
}
