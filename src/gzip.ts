import { crc32, inflateRawSync } from "node:zlib";
import { formatBytes, type Issue, type PageInput } from "./html-policy-rules.ts";

// Pages uploaded gzip-compressed (CLI 0.3.0 and later): each page's `gzip` is
// the base64 of one gzip member holding the page's UTF-8 bytes. The server
// stores those bytes as received and serves them with Content-Encoding: gzip
// (src/serve.ts), so the bytes a browser renders are the bytes inflated and
// validated here. To keep it that way, only a single member with nothing after
// it is accepted: browsers differ on concatenated members and trailing data.
//
// node:zlib's synchronous inflate is native and stops at `maxOutputLength`, so
// a decompression bomb costs at most the upload limit; the stream API costs
// ~4x the CPU here (4 KiB chunks, a promise each). Workers Free has 10 ms.

// What the server stores for one page: the HTML text (plain uploads), or the
// gzip member it was sent as.
export type StoredBody = string | Uint8Array;

export interface DecodedPages {
  // The pages as the validator reads them: `html` is always text.
  pages: PageInput[];
  // What to store per page, in the same order.
  bodies: (StoredBody | null)[];
  // Set when a gzip page cannot be read; nothing else is checked then.
  issue: Issue | null;
}

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * Inflates the gzip pages of an upload (at most `maxBytes` of HTML in all) and
 * returns every page as text, with what to store for it.
 */
export function decodePages(pages: PageInput[] | unknown, maxBytes: number): DecodedPages {
  if (!Array.isArray(pages)) return { pages: [], bodies: [], issue: null };
  const decoded: PageInput[] = [];
  const bodies: (StoredBody | null)[] = [];
  let inflated = 0;
  for (const page of pages as (PageInput | null | undefined)[]) {
    const path = typeof page?.path === "string" && pages.length > 1 ? page.path : undefined;
    if (page?.gzip === undefined || page.gzip === null) {
      decoded.push({ path: page?.path, html: page?.html });
      bodies.push(typeof page?.html === "string" ? page.html : null);
      continue;
    }
    if (page.html !== undefined && page.html !== null) {
      return failed(gzipIssue('A page has both "html" and "gzip". Send one.', path));
    }
    const bytes = typeof page.gzip === "string" ? fromBase64(page.gzip) : null;
    if (!bytes) return failed(gzipIssue('"gzip" is not base64.', path));
    const result = gunzipMember(bytes, maxBytes - inflated);
    if (result === "too-large") {
      return failed({
        level: "error",
        code: "too-large",
        message: `HTML is over the ${formatBytes(maxBytes)} (${maxBytes}-byte) limit for this upload.`,
        fix: "The limit is for the whole upload, every page counted, uncompressed. Publish it as several artifacts that link to each other, or move large inline images or data out to https URLs. Do not drop requested content.",
        count: 1
      });
    }
    if (result === "invalid") return failed(gzipIssue('"gzip" is not one complete gzip stream (a single member, nothing after it).', path));
    inflated += result.byteLength;
    let html: string;
    try {
      html = utf8.decode(result);
    } catch {
      return failed(gzipIssue("The page is not valid UTF-8. Send UTF-8 HTML.", path));
    }
    decoded.push({ path: page.path, html });
    bodies.push(bytes);
  }
  return { pages: decoded, bodies, issue: null };
}

/**
 * Inflates one gzip member of at most `maxBytes` inflated bytes. "invalid" for
 * anything else: a bad header, checksum or length, a truncated stream, a second
 * member, or any byte after the first member.
 */
function gunzipMember(bytes: Uint8Array, maxBytes: number): Uint8Array | "too-large" | "invalid" {
  const start = memberBody(bytes);
  if (start === null || bytes.byteLength < start + 8) return "invalid";
  const end = bytes.byteLength - 8;
  const trailer = new DataView(bytes.buffer, bytes.byteOffset + end, 8);
  const crc = trailer.getUint32(0, true);
  const size = trailer.getUint32(4, true);
  // The trailer's length is not trusted for the limit (trailing junk would
  // read as one): inflating stops at maxBytes instead.
  let inflated: Uint8Array;
  let consumed: number;
  try {
    const { buffer, engine } = inflateRawSync(bytes.subarray(start, end), { info: true, maxOutputLength: Math.max(1, maxBytes) }) as unknown as {
      buffer: Uint8Array;
      engine: { bytesWritten: number };
    };
    inflated = buffer;
    consumed = engine.bytesWritten;
  } catch (error) {
    // Past maxOutputLength: Node says ERR_BUFFER_TOO_LARGE, workerd a RangeError.
    const code = (error as { code?: unknown })?.code;
    return error instanceof RangeError || code === "ERR_BUFFER_TOO_LARGE" ? "too-large" : "invalid";
  }
  // The deflate stream must end exactly where the trailer starts: anything
  // between (a second member, junk) was not inflated, so it is refused.
  if (consumed !== end - start) return "invalid";
  if (inflated.byteLength !== size || crc32(inflated) >>> 0 !== crc) return "invalid";
  return inflated;
}

// Where a gzip member's deflate data starts (RFC 1952), or null if the header
// is not one: magic, deflate, no reserved flags, optional extra/name/comment
// fields, and a header CRC when flagged.
function memberBody(bytes: Uint8Array): number | null {
  if (bytes.byteLength < 10 || bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 8) return null;
  const flags = bytes[3]!;
  if (flags & 0xe0) return null;
  let at = 10;
  if (flags & 0x04) {
    if (bytes.byteLength < at + 2) return null;
    at += 2 + (bytes[at]! | (bytes[at + 1]! << 8));
  }
  for (const flag of [0x08, 0x10]) {
    if (!(flags & flag)) continue;
    while (at < bytes.byteLength && bytes[at] !== 0) at++;
    at++;
  }
  if (flags & 0x02) {
    if (bytes.byteLength < at + 2) return null;
    const stored = bytes[at]! | (bytes[at + 1]! << 8);
    if ((crc32(bytes.subarray(0, at)) & 0xffff) !== stored) return null;
    at += 2;
  }
  return at <= bytes.byteLength ? at : null;
}

function fromBase64(text: string): Uint8Array | null {
  try {
    // Workers have Uint8Array.fromBase64 (strict); TypeScript's ES2023 lib does not.
    return (Uint8Array as unknown as { fromBase64(text: string): Uint8Array }).fromBase64(text);
  } catch {
    return null;
  }
}

function gzipIssue(message: string, path: string | undefined): Issue {
  return { level: "error", code: "bad-gzip", message, count: 1, ...(path ? { path } : {}) };
}

function failed(issue: Issue): DecodedPages {
  return { pages: [], bodies: [], issue };
}
