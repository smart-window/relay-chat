import { db, jsonError, requireApiUser } from "@/lib/server";

export async function GET(request: Request) {
  try {
    const me = await requireApiUser();
    const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 40) || "";
    if (query.length < 2) return Response.json({ users: [] });
    const needle = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    const result = await db()
      .prepare(`SELECT id, display_name AS displayName, handle, bio, last_seen AS lastSeen
        FROM users WHERE id != ? AND (display_name LIKE ? ESCAPE '\\' OR handle LIKE ? ESCAPE '\\')
        ORDER BY last_seen DESC LIMIT 12`)
      .bind(me.id, needle, needle)
      .all();
    return Response.json({ users: result.results });
  } catch (error) {
    return jsonError(error);
  }
}
