import { db, jsonError, requireApiUser } from "@/lib/server";

export async function GET() {
  try {
    return Response.json({ user: await requireApiUser() });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = (await request.json()) as { displayName?: string; handle?: string; bio?: string };
    const displayName = String(input.displayName || "").trim().slice(0, 50);
    const handle = String(input.handle || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24);
    const bio = String(input.bio || "").trim().slice(0, 140);
    if (displayName.length < 2 || handle.length < 3) {
      return Response.json({ error: "Use a name of 2+ characters and a handle of 3+ characters." }, { status: 400 });
    }
    try {
      await db()
        .prepare("UPDATE users SET display_name = ?, handle = ?, bio = ?, last_seen = ? WHERE id = ?")
        .bind(displayName, handle, bio, Date.now(), user.id)
        .run();
    } catch {
      return Response.json({ error: "That handle is already taken." }, { status: 409 });
    }
    return Response.json({ user: { ...user, displayName, handle, bio } });
  } catch (error) {
    return jsonError(error);
  }
}
