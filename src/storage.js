// Artifact HTML lives in R2. Keys are generated server-side from IDs and
// validated page paths.

export async function putHtmlObject(bucket, key, html) {
  await bucket.put(key, html, {
    httpMetadata: { contentType: "text/html; charset=utf-8", cacheControl: "no-store" }
  });
}

export async function getHtmlObject(bucket, key) {
  const object = await bucket.get(key);
  if (!object) throw new Error(`Missing artifact object: ${key}`);
  return object.text();
}
