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

export const BUCKET_NAME = process.env.MINIO_BUCKET!;

/**
 * Generate a presigned URL for downloading an object from MinIO
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
  
  return getSignedUrl(s3, command, { expiresIn });
}

/**
 * Get the public MinIO endpoint URL for an object
 * @param key Object key in MinIO
 * @returns Direct URL to the object
 */
export function getPublicUrl(key: string): string {
  const endpoint = process.env.MINIO_ENDPOINT!;
  return `${endpoint}/${BUCKET_NAME}/${key}`;
}