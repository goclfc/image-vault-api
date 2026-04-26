import { Router, Response } from "express";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import { pool } from "./db";
import { requireAuth, AuthedRequest } from "./auth";

const s3 = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: !!process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
  },
});

const BUCKET = process.env.S3_BUCKET || "";
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export const uploadsRouter = Router();

uploadsRouter.post("/presign", requireAuth, async (req: AuthedRequest, res: Response) => {
  const { contentType } = req.body ?? {};
  if (typeof contentType !== "string" || !ALLOWED_TYPES.has(contentType)) {
    return res.status(400).json({ error: "unsupported content-type" });
  }
  const key = `users/${req.userId}/${randomUUID()}`;
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: 300 }
  );
  res.json({ uploadUrl: url, key });
});

uploadsRouter.post("/confirm", requireAuth, async (req: AuthedRequest, res) => {
  const { key, contentType } = req.body ?? {};
  if (typeof key !== "string" || typeof contentType !== "string") {
    return res.status(400).json({ error: "key and contentType required" });
  }
  if (!key.startsWith(`users/${req.userId}/`)) {
    return res.status(403).json({ error: "forbidden" });
  }
  const { rows } = await pool.query(
    "INSERT INTO images (user_id, key, content_type) VALUES ($1, $2, $3) RETURNING id, key, created_at",
    [req.userId, key, contentType]
  );
  res.json({ image: rows[0] });
});

uploadsRouter.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(
    "SELECT id, key, content_type, created_at FROM images WHERE user_id = $1 ORDER BY created_at DESC",
    [req.userId]
  );
  const images = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      createdAt: r.created_at,
      url: await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: r.key }), {
        expiresIn: 3600,
      }),
    }))
  );
  res.json({ images });
});
