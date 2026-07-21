import { db, jsonError, media, requireApiUser, requireMembership } from "@/lib/server";

type RouteContext = { params: Promise<{ messageId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const me = await requireApiUser();
    const { messageId } = await context.params;
    const message = await db()
      .prepare("SELECT conversation_id, object_key, object_name, object_type FROM messages WHERE id = ?")
      .bind(messageId)
      .first<{ conversation_id: string; object_key: string | null; object_name: string | null; object_type: string | null }>();
    if (!message?.object_key) return new Response("Not found", { status: 404 });
    await requireMembership(message.conversation_id, me.id);
    const object = await media().get(message.object_key);
    if (!object) return new Response("Not found", { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Cache-Control", "private, max-age=3600");
    headers.set("Content-Security-Policy", "default-src 'none'");
    if (message.object_name) {
      headers.set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(message.object_name)}`);
    }
    return new Response(object.body, { headers });
  } catch (error) {
    return jsonError(error);
  }
}
