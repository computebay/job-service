import { PutObjectCommand } from "@aws-sdk/client-s3";
import JSZip from "jszip";
import { s3 } from "./s3";

const BUNDLE_FILENAME = "bundle.zip";
const DEFAULT_ENTRY_FILE = "main.js";

/**
 * Build a zip buffer from inline code (async).
 * Filename is derived from entrypoint (e.g. ["node", "app.js"] → "app.js") or defaults to "main.js".
 */
export async function buildZipFromCodeAsync(
  code: string,
  entrypoint?: string[]
): Promise<Buffer> {
  const zip = new JSZip();
  const filename =
    entrypoint?.length && entrypoint[entrypoint.length - 1]
      ? entrypoint[entrypoint.length - 1]
      : DEFAULT_ENTRY_FILE;
  zip.file(filename, code);
  return (await zip.generateAsync({ type: "nodebuffer" })) as Buffer;
}

/**
 * Build a zip buffer from a project (map of path → content).
 */
export async function buildZipFromProjectAsync(
  project: Record<string, string>
): Promise<Buffer> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(project)) {
    zip.file(path, content);
  }
  return (await zip.generateAsync({ type: "nodebuffer" })) as Buffer;
}

export async function uploadInputArtifact(
  jobId: string,
  fileBuffer: Buffer,
  contentType = "application/zip"
): Promise<string> {
  const key = `inputs/${jobId}/${BUNDLE_FILENAME}`;

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

export type ArtifactPayload =
  | { code: string }
  | { project: Record<string, string> };

/**
 * Prepare artifact (zip code or project) and upload to MinIO.
 * Returns the object key (e.g. "inputs/{jobId}/bundle.zip").
 */
export async function prepareAndUploadArtifact(
  jobId: string,
  payload: ArtifactPayload,
  entrypoint?: string[]
): Promise<string> {
  let buffer: Buffer;
  if ("code" in payload) {
    buffer = await buildZipFromCodeAsync(payload.code, entrypoint);
  } else {
    buffer = await buildZipFromProjectAsync(payload.project);
  }
  return uploadInputArtifact(jobId, buffer);
}
