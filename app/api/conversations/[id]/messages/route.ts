import { db, jsonError, requireApiUser, requireMembership } from "@/lib/server";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const me = await requireApiUser();
    const { id } = await context.params;
    await requireMembership(id, me.id);
    const after = Number(new URL(request.url).searchParams.get("after") || 0);
    const result = await db()
      .prepare(`SELECT m.id, m.sender_id AS senderId, u.display_name AS senderName,
        m.kind, m.body, m.object_name AS objectName, m.object_type AS objectType,
        m.created_at AS createdAt
        FROM messages m JOIN users u ON u.id = m.sender_id
        WHERE m.conversation_id = ? AND m.created_at > ?
        ORDER BY m.created_at ASC LIMIT 200`)
      .bind(id, after)
      .all();
    return Response.json({ messages: result.results });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const me = await requireApiUser();
    const { id: conversationId } = await context.params;
    await requireMembership(conversationId, me.id);
    const input = (await request.json()) as { body?: string; uploadId?: string; kind?: string };
    const body = String(input.body || "").trim().slice(0, 4000);
    let kind = "text";
    let objectKey: string | null = null;
    let objectName: string | null = null;
    let objectType: string | null = null;

    if (input.uploadId) {
      const upload = await db()
        .prepare("SELECT object_key, object_name, object_type FROM uploads WHERE id = ? AND owner_id = ? AND claimed = 0")
        .bind(input.uploadId, me.id)
        .first<{ object_key: string; object_name: string; object_type: string }>();
      if (!upload) return Response.json({ error: "Upload not found." }, { status: 404 });
      kind = upload.object_type.startsWith("image/") ? "image" : "audio";
      objectKey = upload.object_key;
      objectName = upload.object_name;
      objectType = upload.object_type;
    } else if (!body) {
      return Response.json({ error: "Message cannot be empty." }, { status: 400 });
    }

    const messageId = crypto.randomUUID();
    const now = Date.now();
    const d1 = db();
    const statements = [
      d1.prepare(`INSERT INTO messages
        (id, conversation_id, sender_id, kind, body, object_key, object_name, object_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(messageId, conversationId, me.id, kind, body || null, objectKey, objectName, objectType, now),
    ];
    if (input.uploadId) {
      statements.push(d1.prepare("UPDATE uploads SET claimed = 1 WHERE id = ? AND owner_id = ?").bind(input.uploadId, me.id));
    }
    await d1.batch(statements);
    return Response.json({ id: messageId, createdAt: now }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
