import fs from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config, requireEnv } from "./config.js";

// Artifact HTML lives on local disk (HTMLARTIFACT_STORAGE_DIR) or in any
// S3-compatible bucket (AWS, R2, MinIO). Keys are generated server-side.

let client;

function getClient() {
  if (client) return client;

  client = new S3Client({
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    forcePathStyle: config.s3.forcePathStyle,
    credentials: {
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: config.s3.secretAccessKey
    }
  });

  return client;
}

export function assertStorageConfigured() {
  if (config.storageDir) return;
  requireEnv("HTMLARTIFACT_STORAGE_DIR or AWS_S3_BUCKET_NAME", config.s3.bucketName);
  requireEnv("AWS_ACCESS_KEY_ID", config.s3.accessKeyId);
  requireEnv("AWS_SECRET_ACCESS_KEY", config.s3.secretAccessKey);
}

export async function putHtmlObject(key, html) {
  if (config.storageDir) {
    const file = diskPath(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, html);
    return;
  }
  await getClient().send(
    new PutObjectCommand({
      Bucket: config.s3.bucketName,
      Key: key,
      Body: html,
      ContentType: "text/html; charset=utf-8",
      CacheControl: "no-store"
    })
  );
}

export async function getHtmlObject(key) {
  if (config.storageDir) {
    return fs.readFile(diskPath(key), "utf8");
  }
  const result = await getClient().send(
    new GetObjectCommand({ Bucket: config.s3.bucketName, Key: key })
  );
  return result.Body.transformToString("utf8");
}

// Keys are built from generated IDs and validated page paths, but resolve and
// check anyway so no key can ever escape the storage root.
function diskPath(key) {
  const root = path.resolve(config.storageDir);
  const file = path.resolve(root, key);
  if (!file.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Storage key escapes the storage directory: ${key}`);
  }
  return file;
}
