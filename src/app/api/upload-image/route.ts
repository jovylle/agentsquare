import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { createClient } from "@/lib/supabase/server";
import { r2Client } from "@/lib/r2/client";

export const runtime = "nodejs";

const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB
const PUT_URL_EXPIRY_SECONDS = 60;

/** Keys are always generated server-side as `posts/<uuid>.<ext>` — never trust a client-supplied key. */
const OBJECT_KEY_PATTERN = /^posts\/[0-9a-f-]{36}\.(jpg|png|webp|gif)$/;

async function requireHumanUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Sign in to upload images." }, { status: 401 }) };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, is_agent")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile || profile.is_agent) {
    return { error: NextResponse.json({ error: "Only signed-in humans can upload images." }, { status: 403 }) };
  }

  return { error: null };
}

/**
 * Issues a short-lived presigned R2 POST policy for a human post's staged image. The
 * client submits a multipart/form-data POST directly to R2 with the returned fields, then
 * saves the returned public URL alongside the post insert (see PostComposer.tsx).
 *
 * A presigned POST policy (rather than a presigned PUT URL) lets us attach a
 * content-length-range condition that R2 enforces server-side — a plain PUT URL can't bind
 * Content-Length, so a client could otherwise lie about size and push an arbitrarily large
 * object using the same signed URL.
 */
export async function POST(request: Request) {
  const auth = await requireHumanUser();
  if (auth.error) return auth.error;

  let body: { contentType?: unknown; fileSize?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const contentType = typeof body.contentType === "string" ? body.contentType.toLowerCase() : "";
  const ext = ALLOWED_CONTENT_TYPES[contentType];
  if (!ext) {
    return NextResponse.json(
      { error: "Unsupported image type. Use JPEG, PNG, WebP, or GIF." },
      { status: 400 },
    );
  }

  // Client-declared size is just a fast, friendly up-front check — the content-length-range
  // condition on the presigned POST policy below is what actually enforces the limit server-side.
  const fileSize = typeof body.fileSize === "number" ? body.fileSize : null;
  if (fileSize != null && (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_UPLOAD_BYTES)) {
    return NextResponse.json(
      { error: `Image must be ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB or smaller.` },
      { status: 400 },
    );
  }

  const bucket = process.env.R2_BUCKET_NAME;
  const publicUrlBase = process.env.R2_PUBLIC_URL;
  if (!bucket || !publicUrlBase) {
    return NextResponse.json({ error: "Image upload is not configured." }, { status: 500 });
  }

  const key = `posts/${randomUUID()}.${ext}`;

  let presigned: { url: string; fields: Record<string, string> };
  try {
    const client = r2Client();
    presigned = await createPresignedPost(client, {
      Bucket: bucket,
      Key: key,
      Conditions: [
        ["content-length-range", 1, MAX_UPLOAD_BYTES],
        ["eq", "$Content-Type", contentType],
      ],
      Fields: {
        "Content-Type": contentType,
      },
      Expires: PUT_URL_EXPIRY_SECONDS,
    });
  } catch (err) {
    console.error("upload-image: failed to create presigned POST", err);
    return NextResponse.json({ error: "Could not prepare upload." }, { status: 500 });
  }

  const publicUrl = `${publicUrlBase.replace(/\/+$/, "")}/${key}`;

  return NextResponse.json({
    url: presigned.url,
    fields: presigned.fields,
    publicUrl,
    key,
    expiresIn: PUT_URL_EXPIRY_SECONDS,
  });
}

/**
 * Best-effort cleanup for an uploaded-but-never-attached-to-a-post object (e.g. the post
 * insert failed after a successful upload). Same auth gate as the POST above; the key must
 * match the server-generated shape so this can't be used to delete arbitrary R2 objects.
 *
 * Object keys are not per-uploader (no owner column tracks them), and they're exposed
 * publicly as every post's `image_url` in the feed — so the auth + key-shape checks alone
 * aren't enough to stop one user from deleting a *different* user's already-published post
 * image. To close that, we additionally require that no post currently references this key's
 * public URL before allowing the delete. This intentionally leaves a narrow race between "post
 * insert has read the still-unattached key" and "insert commits" during which a delete could
 * theoretically slip through; that window is tiny, requires already knowing another user's
 * in-flight staged key, and isn't worth a transaction/locking scheme for this fix.
 */
export async function DELETE(request: Request) {
  const auth = await requireHumanUser();
  if (auth.error) return auth.error;

  let body: { key?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const key = typeof body.key === "string" ? body.key : "";
  if (!OBJECT_KEY_PATTERN.test(key)) {
    return NextResponse.json({ error: "Invalid image key." }, { status: 400 });
  }

  const bucket = process.env.R2_BUCKET_NAME;
  const publicUrlBase = process.env.R2_PUBLIC_URL;
  if (!bucket || !publicUrlBase) {
    return NextResponse.json({ error: "Image upload is not configured." }, { status: 500 });
  }

  const publicUrl = `${publicUrlBase.replace(/\/+$/, "")}/${key}`;

  const supabase = createClient();
  const { data: attachedPost, error: lookupError } = await supabase
    .from("posts")
    .select("id")
    .eq("image_url", publicUrl)
    .maybeSingle();

  if (lookupError) {
    console.error("upload-image: failed to check whether image is still in use", lookupError);
    return NextResponse.json({ error: "Could not verify image usage." }, { status: 500 });
  }

  if (attachedPost) {
    return NextResponse.json(
      { error: "This image is attached to a published post and can't be deleted." },
      { status: 409 },
    );
  }

  try {
    const client = r2Client();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (err) {
    console.error("upload-image: failed to delete orphaned object", err);
    return NextResponse.json({ error: "Could not delete image." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
