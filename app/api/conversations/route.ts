import { db, jsonError, requireApiUser } from "@/lib/server";

export async function GET() {
  try {
    const me = await requireApiUser();
    const result = await db()
      .prepare(`SELECT c.id, c.kind, c.title, c.created_at AS createdAt,
        u.id AS peerId, u.display_name AS peerName, u.handle AS peerHandle, u.last_seen AS peerLastSeen,
        m.body AS lastBody, m.kind AS lastKind, m.created_at AS lastMessageAt
        FROM conversations c
        JOIN conversation_members mine ON mine.conversation_id = c.id AND mine.user_id = ?
        LEFT JOIN conversation_members other ON other.conversation_id = c.id AND other.user_id != ?
        LEFT JOIN users u ON u.id = other.user_id
        LEFT JOIN messages m ON m.id = (
          SELECT id FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
        )
        ORDER BY COALESCE(m.created_at, c.created_at) DESC`)
      .bind(me.id, me.id)
      .all();
    return Response.json({ conversations: result.results });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const me = await requireApiUser();
    const { userId } = (await request.json()) as { userId?: string };
    if (!userId || userId === me.id) return Response.json({ error: "Choose another person." }, { status: 400 });
    const peer = await db().prepare("SELECT id FROM users WHERE id = ?").bind(userId).first();
    if (!peer) return Response.json({ error: "User not found." }, { status: 404 });
    const existing = await db()
      .prepare(`SELECT a.conversation_id AS id FROM conversation_members a
        JOIN conversation_members b ON b.conversation_id = a.conversation_id
        JOIN conversations c ON c.id = a.conversation_id AND c.kind = 'direct'
        WHERE a.user_id = ? AND b.user_id = ?
        AND (SELECT COUNT(*) FROM conversation_members x WHERE x.conversation_id = a.conversation_id) = 2
        LIMIT 1`)
      .bind(me.id, userId)
      .first<{ id: string }>();
    if (existing) return Response.json({ id: existing.id });

    const id = crypto.randomUUID();
    const now = Date.now();
    const d1 = db();
    await d1.batch([
      d1.prepare("INSERT INTO conversations (id, kind, created_at) VALUES (?, 'direct', ?)").bind(id, now),
      d1.prepare("INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)").bind(id, me.id, now),
      d1.prepare("INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)").bind(id, userId, now),
    ]);
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
