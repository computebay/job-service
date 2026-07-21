import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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