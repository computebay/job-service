import { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

export const s3 = new S3Client({
  region: process.env.MINIO_REGION!,
  endpoint: process.env.MINIO_ENDPOINT!,
  forcePathStyle: true, // REQUIRED for MinIO
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY!,
    secretAccessKey: process.env.MINIO_SECRET_KEY!,
  },
});

const s3Public = process.env.MINIO_ENDPOINT_PUBLIC
  ? new S3Client({
      region: process.env.MINIO_REGION!,
      endpoint: process.env.MINIO_ENDPOINT_PUBLIC,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.MINIO_ACCESS_KEY!,
        secretAccessKey: process.env.MINIO_SECRET_KEY!,
      },
    })
  : s3;

export const BUCKET_NAME = process.env.MINIO_BUCKET!;

/**
 * Generate a presigned URL for downloading an object from MinIO.
 * Uses MINIO_ENDPOINT_PUBLIC if set, otherwise falls back to MINIO_ENDPOINT.
 * @param key Object key in MinIO
 * @param expiresIn Expiration time in seconds (default: 15 minutes)
 * @returns Presigned URL
 */
export async function getPresignedUrl(
  key: string,
  expiresIn: number = 900
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  return getSignedUrl(s3Public, command, { expiresIn });
}

/** Max single-file upload size (500MB, matches multipart limit in index.ts). */
export const MAX_UPLOAD_BYTES = 1024 * 1024 * 500;

/**
 * Sanitize a user-supplied filename for use in a staging key.
 * Keeps basename only, replaces unsafe chars, caps length.
 */
export function sanitizeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() || "file";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 150);
  return cleaned || "file";
}

/** Build a fresh staging key for an upload. */
export function buildStagingKey(filename: string): string {
  return `staging/${randomUUID()}-${sanitizeFilename(filename)}`;
}

/**
 * Generate a presigned PUT URL so browsers can upload directly to MinIO,
 * bypassing job-service for the file bytes. Uses the public endpoint when set.
 */
export async function getPresignedPutUrl(
  key: string,
  contentType: string = "application/octet-stream",
  expiresIn: number = 300
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });

  return getSignedUrl(s3Public, command, { expiresIn });
}

/** Fail-fast existence check used before creating a batch-image job. */
export async function stagingKeyExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
    return true;
  } catch {
    return false;
  }
}