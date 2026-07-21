import { db, jsonError, media, requireApiUser } from "@/lib/server";

const MAX_FILE_SIZE = 12 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const me = await requireApiUser();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Choose a file to upload." }, { status: 400 });
    if (file.size > MAX_FILE_SIZE) return Response.json({ error: "Files must be 12 MB or smaller." }, { status: 413 });
    if (!file.type.startsWith("image/") && !file.type.startsWith("audio/")) {
      return Response.json({ error: "Only images and audio are supported." }, { status: 415 });
    }

    const uploadId = crypto.randomUUID();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || "upload";
    const objectKey = `${me.id}/${uploadId}-${safeName}`;
    await media().put(objectKey, file.stream(), {
      httpMetadata: { contentType: file.type },
      customMetadata: { owner: me.id, originalName: file.name.slice(0, 180) },
    });
    await db()
      .prepare(`INSERT INTO uploads
        (id, owner_id, object_key, object_name, object_type, size, claimed, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?)`)
      .bind(uploadId, me.id, objectKey, file.name.slice(0, 180), file.type, file.size, Date.now())
      .run();
    return Response.json({ uploadId, name: file.name, type: file.type }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
