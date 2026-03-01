import { PutObjectCommand } from "@aws-sdk/client-s3";
import { s3 } from "./s3";

export async function uploadInputArtifact(
  jobId: string,
  fileBuffer: Buffer,
  contentType = "application/zip"
): Promise<string> {
  const key = `inputs/${jobId}/bundle.zip`;

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.MINIO_BUCKET!,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType,
    })
  );

  return key;
}