import { db, jsonError, requireApiUser, requireMembership } from "@/lib/server";

export async function GET(request: Request) {
  try {
    const me = await requireApiUser();
    const url = new URL(request.url);
    const conversationId = url.searchParams.get("conversationId");
    const callId = url.searchParams.get("callId");
    let row;
    if (callId) {
      row = await db()
        .prepare(`SELECT c.id, c.conversation_id AS conversationId, c.caller_id AS callerId,
          c.callee_id AS calleeId, c.mode, c.status, c.offer_sdp AS offerSdp,
          c.answer_sdp AS answerSdp, c.created_at AS createdAt,
          u.display_name AS callerName
          FROM calls c JOIN users u ON u.id = c.caller_id
          WHERE c.id = ? AND (c.caller_id = ? OR c.callee_id = ?)`)
        .bind(callId, me.id, me.id)
        .first();
    } else if (conversationId) {
      await requireMembership(conversationId, me.id);
      row = await db()
        .prepare(`SELECT c.id, c.conversation_id AS conversationId, c.caller_id AS callerId,
          c.callee_id AS calleeId, c.mode, c.status, c.offer_sdp AS offerSdp,
          c.answer_sdp AS answerSdp, c.created_at AS createdAt,
          u.display_name AS callerName
          FROM calls c JOIN users u ON u.id = c.caller_id
          WHERE c.conversation_id = ? AND (c.caller_id = ? OR c.callee_id = ?)
          AND c.status IN ('ringing', 'active') ORDER BY c.updated_at DESC LIMIT 1`)
        .bind(conversationId, me.id, me.id)
        .first();
    } else {
      row = await db()
        .prepare(`SELECT c.id, c.conversation_id AS conversationId, c.caller_id AS callerId,
          c.callee_id AS calleeId, c.mode, c.status, c.offer_sdp AS offerSdp,
          c.answer_sdp AS answerSdp, c.created_at AS createdAt,
          u.display_name AS callerName
          FROM calls c JOIN users u ON u.id = c.caller_id
          WHERE c.callee_id = ? AND c.status = 'ringing'
          ORDER BY c.updated_at DESC LIMIT 1`)
        .bind(me.id)
        .first();
    }
    return Response.json({ call: row || null });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const me = await requireApiUser();
    const input = (await request.json()) as {
      action?: string; conversationId?: string; callId?: string; mode?: string; sdp?: string;
    };
    const now = Date.now();
    if (input.action === "start") {
      if (!input.conversationId || !input.sdp || !["voice", "video"].includes(input.mode || "")) {
        return Response.json({ error: "Invalid call." }, { status: 400 });
      }
      await requireMembership(input.conversationId, me.id);
      const peer = await db()
        .prepare("SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ? LIMIT 1")
        .bind(input.conversationId, me.id)
        .first<{ user_id: string }>();
      if (!peer) return Response.json({ error: "No one else is in this conversation." }, { status: 400 });
      const id = crypto.randomUUID();
      await db()
        .prepare(`INSERT INTO calls
          (id, conversation_id, caller_id, callee_id, mode, status, offer_sdp, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'ringing', ?, ?, ?)`)
        .bind(id, input.conversationId, me.id, peer.user_id, input.mode, input.sdp, now, now)
        .run();
      return Response.json({ id }, { status: 201 });
    }
    if (!input.callId) return Response.json({ error: "Call not found." }, { status: 400 });
    const call = await db()
      .prepare("SELECT caller_id, callee_id, status FROM calls WHERE id = ?")
      .bind(input.callId)
      .first<{ caller_id: string; callee_id: string; status: string }>();
    if (!call || (call.caller_id !== me.id && call.callee_id !== me.id)) {
      return Response.json({ error: "Call not found." }, { status: 404 });
    }
    if (input.action === "answer" && call.callee_id === me.id && input.sdp) {
      await db().prepare("UPDATE calls SET answer_sdp = ?, status = 'active', updated_at = ? WHERE id = ?")
        .bind(input.sdp, now, input.callId).run();
      return Response.json({ ok: true });
    }
    if (input.action === "end") {
      await db().prepare("UPDATE calls SET status = 'ended', updated_at = ? WHERE id = ?")
        .bind(now, input.callId).run();
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Invalid call action." }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
