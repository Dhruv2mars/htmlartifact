import { readFileSync } from "node:fs";
import express from "express";
import { randomToken, sha256 } from "./crypto.js";
import { config } from "./config.js";
import {
  FLAGS,
  findApiKeyByToken,
  newEventId,
  pool,
  publicUploadAuth,
  withTransaction
} from "./db.js";
import { newDraftId, newInternalId } from "./ids.js";
import { renderHome, renderNotFound } from "./render.js";
import { createRateLimiter } from "./rate-limit.js";
import { getHtmlObject, putHtmlObject } from "./storage.js";
import { formatBytes, validateUpload } from "./html-policy.js";
import { clientIp } from "./client-ip.js";
import { listAccountDrafts } from "./drafts.js";
import { registerWebRoutes } from "./web.js";
import {
  getDraftPublicUrl,
  getDraftRawUrl,
  getDraftRefFromHost,
  getHomeUrl,
  getRequestBaseUrl,
  slugProblem
} from "./public-url.js";

// What scripted drafts cannot do, reported by /api/check so agents can plan
// around the sandbox before they build a page.
const SANDBOX_LIMITS = [
  "script src (external scripts)",
  "fetch, XHR, WebSocket, and EventSource",
  "localStorage, sessionStorage, indexedDB, and cookies",
  "alert, confirm, and prompt",
  "workers",
  "forms",
  "iframes, embeds, and objects",
  "meta refresh"
];

export function createApp() {
  const app = express();
  app.set("trust proxy", true);
  const uploadIpRateLimit = createRateLimiter({
    windowMs: Number(process.env.UPLOAD_IP_RATE_LIMIT_WINDOW_MS || 60_000),
    max: Number(process.env.UPLOAD_IP_RATE_LIMIT_MAX || 60),
    keyPrefix: "upload-ip",
    key: (req) => clientIp(req) || "anonymous"
  });
  const uploadKeyRateLimit = createRateLimiter({
    windowMs: Number(process.env.UPLOAD_RATE_LIMIT_WINDOW_MS || 60_000),
    max: Number(process.env.UPLOAD_RATE_LIMIT_MAX || 30),
    keyPrefix: "upload-key",
    key: (req) => req.auth?.id || clientIp(req) || "anonymous"
  });

  app.use(noStoreHeaders);

  // Registered before the shared /api JSON parser: upload bodies are parsed
  // after auth, with a limit sized to the caller's HTML budget, so anonymous
  // requests cannot send the largest bodies.
  app.post(
    "/api/uploads",
    uploadIpRateLimit,
    optionalUploadAuth,
    uploadKeyRateLimit,
    uploadJson,
    handleUpload
  );
  app.post("/api/check", uploadIpRateLimit, optionalUploadAuth, uploadJson, handleCheck);

  // Scoped to /api so that draft GETs carrying a stray JSON body (some HTTP
  // clients always send Content-Type: application/json) can never fail with a
  // body-parser error instead of the draft HTML.
  app.use("/api", express.json());

  // Served on every host (apex and draft subdomains) so browsers that probe
  // /favicon.ico get postplan's icon instead of a 404. Immutable-cached: the
  // icon only changes with a deploy, and these override the global no-store.
  const favicons = [
    { path: "/favicon.svg", type: "image/svg+xml", body: readAsset("favicon.svg") },
    { path: "/favicon.ico", type: "image/png", body: readAsset("favicon.png") },
    { path: "/favicon.png", type: "image/png", body: readAsset("favicon.png") }
  ];
  for (const icon of favicons) {
    app.get(icon.path, (req, res) => {
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.type(icon.type).send(icon.body);
    });
  }

  app.get("/", (req, res, next) => {
    // Draft hosts fall through to the draft route at the end.
    if (getDraftRefFromRequest(req)) return next();
    res.type("html").send(renderHome({ publicBaseUrl: getHomeUrlForRequest(req) }));
  });

  app.get("/healthz", async (req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ ok: true });
    } catch (error) {
      res.status(503).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/me", requireAuth, (req, res) => {
    res.json({
      accountId: req.auth.account_id,
      accountName: req.auth.account_name,
      apiKeyId: req.auth.id,
      apiKeyName: req.auth.name,
      flags: req.auth.flags
    });
  });

  // The "my docs" feed — shared with the dashboard (src/drafts.js).
  app.get("/api/drafts", requireAuth, async (req, res, next) => {
    try {
      const drafts = await listAccountDrafts(req.auth.account_id, {
        requestBaseUrl: getRequestBaseUrl(req)
      });
      res.json({ ok: true, drafts });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/api-keys", requireAuth, async (req, res, next) => {
    try {
      const token = `pp_${randomToken(32)}`;
      const apiKeyId = newInternalId();
      const name = cleanText(req.body?.name) || "CLI API Key";

      await pool.query(
        `
          INSERT INTO api_keys (id, account_id, name, key_hash)
          VALUES ($1, $2, $3, $4)
        `,
        [apiKeyId, req.auth.account_id, name, sha256(token)]
      );

      res.status(201).json({
        ok: true,
        apiKey: {
          id: apiKeyId,
          name
        },
        token
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/api-keys/:apiKeyId/revoke", requireAuth, async (req, res, next) => {
    try {
      const result = await pool.query(
        `
          UPDATE api_keys
          SET revoked_at = now()
          WHERE id = $1
            AND account_id = $2
            AND revoked_at IS NULL
          RETURNING id
        `,
        [req.params.apiKeyId, req.auth.account_id]
      );

      if (!result.rowCount) {
        return res.status(404).json({ ok: false, error: "API key not found." });
      }

      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  // Deleting a draft frees its custom URL.
  app.delete("/api/drafts/:draftId", requireAuth, async (req, res, next) => {
    try {
      const result = await pool.query(
        `
          UPDATE drafts
          SET deleted_at = now(), slug = NULL, updated_at = now()
          WHERE id = $1
            AND account_id = $2
            AND deleted_at IS NULL
          RETURNING id
        `,
        [req.params.draftId, req.auth.account_id]
      );

      if (!result.rowCount) {
        return res.status(404).json({ ok: false, error: "Draft not found." });
      }

      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/drafts/:draftId/disable", requireAuth, async (req, res, next) => {
    try {
      const reason = cleanText(req.body?.reason) || "Disabled by owner.";
      const result = await pool.query(
        `
          UPDATE drafts
          SET disabled_at = now(), disabled_reason = $3, updated_at = now()
          WHERE id = $1
            AND account_id = $2
            AND deleted_at IS NULL
          RETURNING id
        `,
        [req.params.draftId, req.auth.account_id, reason]
      );

      if (!result.rowCount) {
        return res.status(404).json({ ok: false, error: "Draft not found." });
      }

      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  registerWebRoutes(app);

  // Every draft URL serves raw uploaded HTML. A draft subdomain maps its whole
  // path; the apex uses /d/<draft>/... Both accept a draft ID or custom URL.
  app.get("/{*path}", async (req, res, next) => {
    try {
      const target = draftTarget(req);
      if (!target) {
        next();
        return;
      }
      await serveDraft(req, res, target);
    } catch (error) {
      next(error);
    }
  });

  app.use((req, res) => {
    res.status(404).type("html").send(renderNotFound());
  });

  app.use((error, req, res, _next) => {
    // Express's own errors (such as an undecodable URL) set `status`.
    const status = error.statusCode || error.status || 500;
    const message = status >= 500 ? "Internal server error." : error.message;
    if (status >= 500) {
      console.error(error);
    }
    res.status(status).json({ ok: false, error: message });
  });

  return app;
}

async function handleUpload(req, res, next) {
  try {
    const { filename, metadata = {}, draftId, description } = req.body || {};
    const capabilities = uploadCapabilities(req);
    const validation = validateUpload(requestPages(req.body), capabilities);

    if (!validation.ok) {
      return res.status(422).json({
        ok: false,
        errors: validation.errors,
        warnings: validation.warnings,
        issues: validation.issues
      });
    }

    const slug = normalizeSlug(req.body?.slug);
    const slugError = slug === null ? null : slugRequestProblem(slug, capabilities);
    if (slugError) {
      return res.status(slugError.status).json({ ok: false, error: slugError.message });
    }

    const { pages } = validation;
    const index = pages.find((page) => page.path === "index.html");
    const extraPages = pages.filter((page) => page !== index);
    const sourceIp = clientIp(req);
    // Railway's edge sets X-Railway-Request-Id and documents it for correlating
    // against network logs, so we store it verbatim rather than minting our own.
    const requestId = cleanText(req.get("x-railway-request-id"));
    const cleanDescription = cleanText(description, 1000);

    const result = await withTransaction(async (client) => {
      // A slug is the draft's portable identity: the same slug updates the
      // same draft from any machine. A draftId sent with it must name that
      // same draft; with a free slug, draftId names the draft to rename.
      const slugDraft = slug ? await findDraftBySlug(client, slug) : null;
      if (slugDraft && slugDraft.account_id !== req.auth.account_id) {
        throw httpError(409, `The custom URL "${slug}" belongs to another account.`);
      }
      if (slugDraft && draftId && slugDraft.id !== draftId) {
        throw httpError(
          409,
          `The custom URL "${slug}" already names draft ${slugDraft.id}. Upload with --slug alone to update it.`
        );
      }

      const existingDraft =
        slugDraft || (draftId ? await findOwnedDraft(client, draftId, req.auth.account_id) : null);
      if (draftId && !existingDraft) {
        throw httpError(404, "Draft not found.");
      }

      const currentVersion = existingDraft?.current_version_id
        ? (
            await client.query(
              "SELECT id, version_number, content_hash FROM draft_versions WHERE id = $1",
              [existingDraft.current_version_id]
            )
          ).rows[0]
        : null;
      // Re-sending identical content (a blind retry) keeps the current version.
      const unchanged = currentVersion?.content_hash === validation.contentHash;

      const draft = existingDraft || { id: newDraftId() };
      const title = validation.title || existingDraft?.title || filename || "Untitled Draft";
      let versionId = currentVersion?.id;
      let versionNumber = Number(currentVersion?.version_number);

      if (!unchanged) {
        versionNumber = existingDraft
          ? Number(
              (
                await client.query(
                  "SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM draft_versions WHERE draft_id = $1",
                  [draft.id]
                )
              ).rows[0].next_version
            )
          : 1;
        versionId = newInternalId();
        await insertVersion(client, {
          req,
          draft,
          existingDraft,
          versionId,
          versionNumber,
          title,
          validation,
          index,
          extraPages,
          filename,
          metadata,
          sourceIp,
          requestId,
          cleanDescription,
          slug
        });
      }

      // Draft metadata applies even when the content is unchanged; only new
      // content moves updated_at.
      await client.query(
        `
          UPDATE drafts
          SET current_version_id = $1,
              title = $2,
              description = COALESCE($3, description),
              repo_org = COALESCE($4, repo_org),
              repo_name = COALESCE($5, repo_name),
              repo_host = COALESCE($6, repo_host),
              slug = COALESCE($7, slug),
              updated_at = CASE WHEN $9::boolean THEN updated_at ELSE now() END
          WHERE id = $8
        `,
        [
          versionId,
          title,
          cleanDescription,
          cleanText(metadata.repoOrg),
          cleanText(metadata.repoName),
          cleanText(metadata.repoHost),
          slug,
          draft.id,
          unchanged
        ]
      );

      return {
        created: !existingDraft,
        unchanged,
        draftId: draft.id,
        slug: slug || existingDraft?.slug || null,
        versionId,
        versionNumber,
        title
      };
    });

    const urlOptions = {
      draftId: result.slug || result.draftId,
      publicBaseUrl: config.publicBaseUrl,
      requestBaseUrl: getRequestBaseUrl(req)
    };
    const publicUrl = getDraftPublicUrl(urlOptions);
    const multiPage = pages.length > 1;

    res.status(result.created ? 201 : 200).json({
      ok: true,
      ...result,
      requestId,
      contentHash: validation.contentHash,
      totalBytes: validation.totalBytes,
      account: capabilities.signedIn
        ? { id: req.auth.account_id, name: req.auth.account_name }
        : null,
      publicUrl,
      rawUrl: getDraftRawUrl(urlOptions),
      // Built from the draft ID, which never moves: a slug can be renamed
      // and later claimed by another draft. Multi-page URLs end in "/" so
      // relative links between pages resolve.
      versionUrl: `${getDraftPublicUrl({ ...urlOptions, draftId: result.draftId })}/v/${
        result.versionNumber
      }${multiPage ? "/" : ""}`,
      pages: multiPage
        ? pages.map((page) => ({ path: page.path, url: `${publicUrl}/${page.path}` }))
        : undefined,
      warnings: validation.warnings
    });
  } catch (error) {
    // Two uploads racing to claim the same new custom URL.
    if (error.code === "23505" && error.constraint === "drafts_slug_idx") {
      return res.status(409).json({ ok: false, error: "That custom URL was just taken. Pick another." });
    }
    next(error);
  }
}

// Stores a new version: page objects, the draft row for a new draft, the
// version and page rows, and the upload event. Runs inside the upload
// transaction.
async function insertVersion(client, {
  req,
  draft,
  existingDraft,
  versionId,
  versionNumber,
  title,
  validation,
  index,
  extraPages,
  filename,
  metadata,
  sourceIp,
  requestId,
  cleanDescription,
  slug
}) {
  const { pages } = validation;
  const objectKey = `drafts/${draft.id}/versions/${versionId}.html`;
  const pageObjectKey = (page) => `drafts/${draft.id}/versions/${versionId}/${page.path}`;

  await Promise.all([
    putHtmlObject(objectKey, index.html),
    ...extraPages.map((page) => putHtmlObject(pageObjectKey(page), page.html))
  ]);

  if (!existingDraft) {
    await client.query(
      `
        INSERT INTO drafts (id, account_id, title, description, repo_org, repo_name, repo_host, slug)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        draft.id,
        req.auth.account_id,
        title,
        cleanDescription,
        cleanText(metadata.repoOrg),
        cleanText(metadata.repoName),
        cleanText(metadata.repoHost),
        slug
      ]
    );
  }

  const externalImageHosts = [
    ...new Set(pages.flatMap((page) => page.stats.externalImageHosts))
  ].sort();

  await client.query(
    `
      INSERT INTO draft_versions (
        id, draft_id, version_number, object_key, content_hash, file_size,
        created_by_api_key_id, source_ip, user_agent, cli_version,
        git_branch, git_commit_sha, original_filename,
        git_commit_subject, git_dirty, request_id, has_inline_script,
        external_image_hosts, ci_run_url, ci_actor, page_count
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
              $14, $15, $16, $17, $18, $19, $20, $21)
    `,
    [
      versionId,
      draft.id,
      versionNumber,
      objectKey,
      validation.contentHash,
      validation.totalBytes,
      req.auth.id,
      sourceIp,
      req.get("user-agent") || null,
      cleanText(metadata.cliVersion),
      cleanText(metadata.gitBranch),
      cleanText(metadata.gitCommitSha),
      cleanText(filename),
      cleanText(metadata.gitCommitSubject),
      typeof metadata.gitDirty === "boolean" ? metadata.gitDirty : null,
      requestId,
      index.hasScripts,
      JSON.stringify(externalImageHosts),
      cleanText(metadata.ciRunUrl),
      cleanText(metadata.ciActor),
      pages.length
    ]
  );

  for (const page of extraPages) {
    await client.query(
      `
        INSERT INTO draft_pages (
          draft_version_id, path, object_key, content_hash, file_size, title, has_inline_script
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [versionId, page.path, pageObjectKey(page), sha256(page.html), page.bytes, page.title, page.hasScripts]
    );
  }

  await client.query(
    `
      INSERT INTO upload_events (
        id, draft_id, draft_version_id, api_key_id, event_type,
        source_ip, user_agent, metadata_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      newEventId(),
      draft.id,
      versionId,
      req.auth.id,
      existingDraft ? "draft.updated" : "draft.created",
      sourceIp,
      req.get("user-agent") || null,
      metadata
    ]
  );
}

// A read-only preflight: what the caller can publish, and whether a given
// upload body would pass. It never creates a draft.
async function handleCheck(req, res, next) {
  try {
    const body = req.body || {};
    const capabilities = uploadCapabilities(req);
    const report = {
      ok: true,
      account: capabilities.signedIn
        ? { id: req.auth.account_id, name: req.auth.account_name, apiKeyName: req.auth.name }
        : null,
      flags: capabilities.flags,
      limits: { maxBytes: capabilities.maxBytes, maxPages: capabilities.maxPages },
      capabilities: {
        inlineScripts: capabilities.inlineScripts,
        multiPage: capabilities.maxPages > 1,
        customUrls: capabilities.customUrls,
        externalAssets: "https images, video, audio, fonts, and stylesheets",
        blockedInSandbox: SANDBOX_LIMITS
      }
    };

    if (body.html !== undefined || body.files !== undefined) {
      const validation = validateUpload(requestPages(body), capabilities);
      Object.assign(report, {
        ok: validation.ok,
        totalBytes: validation.totalBytes,
        pages: validation.pages.map((page) => ({
          path: page.path,
          bytes: page.bytes,
          title: page.title,
          hasScripts: page.hasScripts
        })),
        issues: validation.issues,
        errors: validation.errors,
        warnings: validation.warnings
      });
    }

    const slug = normalizeSlug(body.slug);
    if (slug !== null) {
      report.slug = await slugStatus(slug, req, capabilities);
      if (report.slug.status === "unavailable" || report.slug.status === "taken") {
        report.ok = false;
      }
    }

    res.json(report);
  } catch (error) {
    next(error);
  }
}

// What this request may publish. Shared by uploads and /api/check so a
// passing check means the upload passes too.
function uploadCapabilities(req) {
  const signedIn = req.isAuthenticatedUpload;
  const flags = signedIn ? req.auth.flags || [] : [];
  const { limits } = config;
  let maxBytes = limits.anonymousBytes;
  if (signedIn) {
    maxBytes = flags.includes(FLAGS.largeUploads) ? limits.largeBytes : limits.accountBytes;
  }
  return {
    signedIn,
    flags,
    maxBytes,
    maxPages: signedIn ? limits.maxPages : 1,
    inlineScripts: signedIn,
    customUrls: flags.includes(FLAGS.customUrls)
  };
}

const uploadJsonParsers = new Map();

// JSON body parsing for uploads, sized to the caller's HTML budget. JSON can
// spend up to 6 bytes per HTML byte: standard encoders write "<" (Go) or "é"
// (Python) as \uXXXX escapes. 6x accepts any encoding of an in-limit page;
// validateUpload then enforces the decoded limit. The extra MiB covers metadata.
function uploadJson(req, res, next) {
  const { maxBytes } = uploadCapabilities(req);
  if (!uploadJsonParsers.has(maxBytes)) {
    uploadJsonParsers.set(maxBytes, express.json({ limit: maxBytes * 6 + 1024 * 1024 }));
  }
  uploadJsonParsers.get(maxBytes)(req, res, (error) => {
    if (error?.type === "entity.too.large") {
      const message = `Upload is over the ${formatBytes(maxBytes)} HTML limit for this account.`;
      return res.status(413).json({ ok: false, error: message, errors: [message] });
    }
    next(error);
  });
}

// An upload is one document (`html`) or a folder of pages (`files`).
function requestPages(body) {
  if (Array.isArray(body?.files)) {
    return body.files.map((file) => ({ path: file?.path, html: file?.html }));
  }
  return [{ path: "index.html", html: body?.html }];
}

// Returns null when no slug was sent. Any other value goes through
// slugProblem, so a blank or non-string slug is rejected, not ignored.
function normalizeSlug(value) {
  if (value === undefined || value === null) return null;
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function slugRequestProblem(slug, capabilities) {
  if (!capabilities.customUrls) {
    return {
      status: 403,
      message: "Custom URLs are not enabled for this account. Upload without --slug."
    };
  }
  const problem = slugProblem(slug);
  return problem ? { status: 422, message: problem } : null;
}

async function slugStatus(slug, req, capabilities) {
  const problem = slugRequestProblem(slug, capabilities);
  if (problem) return { slug, status: "unavailable", message: problem.message };

  const result = await pool.query(
    "SELECT account_id FROM drafts WHERE slug = $1 AND deleted_at IS NULL LIMIT 1",
    [slug]
  );
  const owner = result.rows[0];
  if (!owner) return { slug, status: "available" };
  if (owner.account_id === req.auth.account_id) return { slug, status: "yours" };
  return { slug, status: "taken", message: `The custom URL "${slug}" belongs to another account.` };
}

// Splits a draft request into the draft reference and the path segments
// below the draft root. Returns null for requests that are not for a draft.
// "/d/<ref>" gives [] (no trailing slash); "/d/<ref>/" gives [""].
function draftTarget(req) {
  // Decode each segment once, as Express route params did. An undecodable
  // segment or an encoded "/" names no draft or page.
  const segments = [];
  for (const raw of req.path.split("/").slice(1)) {
    let segment;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (segment.includes("/")) return null;
    segments.push(segment);
  }
  const hostRef = getDraftRefFromRequest(req);
  if (hostRef) return { ref: hostRef, segments };
  if (segments[0] !== "d" || !segments[1]) return null;
  return { ref: segments[1].toLowerCase(), segments: segments.slice(2) };
}

// Serve the exact uploaded HTML, byte for byte, to EVERY client — browsers,
// curl, and agent fetchers alike. There is deliberately no browser detection,
// iframe wrapper, or consent interstitial: any heuristic that tried to tell an
// agent from a browser inevitably misclassified some agent fetcher and hid the
// draft content the service exists to share. A draft URL is just its HTML.
//
// Below the draft root: "v/<n>/" pins a version, "raw" (or "raw/") names the
// index page, and anything else names a page of a multi-page version.
async function serveDraft(req, res, { ref, segments }) {
  let parts = segments;
  let versionNumber;
  if (parts[0] === "v") {
    if (!/^[1-9]\d{0,8}$/.test(parts[1] || "")) return sendNotFound(res);
    versionNumber = Number(parts[1]);
    parts = parts.slice(2);
  }
  const rawWithSlash = parts[0] === "raw" && parts.length === 2 && parts[1] === "";
  if (parts[0] === "raw" && (parts.length === 1 || rawWithSlash)) {
    parts = [""];
  }

  const { draft, version } = await findPublicDraftVersion(ref, versionNumber);
  if (!draft || !version) return sendNotFound(res);

  const multiPage = Number(version.page_count || 1) > 1;
  const pagePath = parts.join("/");

  // Relative links on ".../raw/" would resolve under "raw/"; ".../raw"
  // resolves them against the draft root, like the index page itself.
  if (rawWithSlash && multiPage) return redirectTo(req, res, req.path.slice(0, -1));

  if (pagePath === "" || pagePath === "index.html") {
    // Relative links between pages only resolve from a URL ending in "/".
    if (parts.length === 0 && multiPage) return redirectWithSlash(req, res);
    return sendPage(res, { draft, version, page: version });
  }
  if (!multiPage) return sendNotFound(res);

  const candidates = pagePath.endsWith("/")
    ? [`${pagePath}index.html`]
    : pagePath.endsWith(".html")
      ? [pagePath]
      : [`${pagePath}.html`, `${pagePath}/index.html`];
  const result = await pool.query(
    "SELECT * FROM draft_pages WHERE draft_version_id = $1 AND path = ANY($2)",
    [version.id, candidates]
  );
  const page = candidates.map((path) => result.rows.find((row) => row.path === path)).find(Boolean);
  if (!page) return sendNotFound(res);
  if (page.path === `${pagePath}/index.html`) return redirectWithSlash(req, res);

  return sendPage(res, { draft, version, page });
}

// `page` is the version row for index.html, or a draft_pages row.
async function sendPage(res, { draft, version, page }) {
  const html = await getHtmlObject(page.object_key);
  const allowInlineScripts =
    page.has_inline_script === true &&
    Boolean(version.created_by_api_key_id) &&
    version.created_by_api_key_id !== publicUploadAuth.id;
  res.setHeader(
    "Content-Security-Policy",
    draftContentSecurityPolicy({ allowInlineScripts })
  );
  res.setHeader("X-Postplan-Draft-Id", draft.id);
  res.setHeader("X-Postplan-Draft-Version", String(Number(version.version_number)));
  res.type("html").send(html);
}

function redirectWithSlash(req, res) {
  redirectTo(req, res, `${req.path}/`);
}

// Redirects within the draft, keeping the query. Only called for paths that
// start with a draft root, "/raw", or "/v/<n>", so the target can never
// become a protocol-relative ("//host") URL.
function redirectTo(req, res, path) {
  const queryStart = req.originalUrl.indexOf("?");
  const query = queryStart === -1 ? "" : req.originalUrl.slice(queryStart);
  res.redirect(302, `${path}${query}`);
}

function sendNotFound(res) {
  res.status(404).type("html").send(renderNotFound());
}

// A CSP is the only thing kept from the old serving path. It never alters the
// bytes a curl/agent client reads, so it does not gate content in any way. For
// scripted drafts, the response-level sandbox deliberately omits
// allow-same-origin: JavaScript (inline scripts and inline handlers) can update
// its own DOM but gets an opaque origin, cannot read Postplan cookies/storage,
// and cannot act as the apex UI even when the HTML is fetched through a /d/...
// alias. New tabs are allowed without inheriting the draft's sandbox
// restrictions. Images, media, fonts, and stylesheets may load from any https
// host, so assets uploaded elsewhere (for example with file-upload) embed.
function draftContentSecurityPolicy({ allowInlineScripts = false } = {}) {
  const inline = allowInlineScripts ? "'unsafe-inline'" : "'none'";
  const directives = [
    "default-src 'none'",
    `script-src ${inline}`,
    `script-src-attr ${inline}`,
    "style-src 'unsafe-inline' https:",
    "img-src https: data:",
    "media-src https: data:",
    "font-src https: data:",
    "connect-src 'none'",
    "worker-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri https:",
    "form-action 'none'"
  ];
  if (allowInlineScripts) {
    directives.push("sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox");
  }
  return directives.join("; ");
}

// `ref` is a draft ID or a custom URL slug; the formats never overlap.
async function findPublicDraftVersion(ref, versionNumber) {
  const draftResult = await pool.query(
    `
      SELECT *
      FROM drafts
      WHERE (id = $1 OR slug = $1)
        AND deleted_at IS NULL
        AND disabled_at IS NULL
      LIMIT 1
    `,
    [ref]
  );

  const draft = draftResult.rows[0] || null;
  if (!draft) return { draft: null, version: null };

  const versionResult = versionNumber
    ? await pool.query(
        `
          SELECT *
          FROM draft_versions
          WHERE draft_id = $1 AND version_number = $2
          LIMIT 1
        `,
        [draft.id, versionNumber]
      )
    : await pool.query("SELECT * FROM draft_versions WHERE id = $1 LIMIT 1", [
        draft.current_version_id
      ]);

  return { draft, version: versionResult.rows[0] || null };
}

// Both draft lookups lock the row, so concurrent uploads to one draft take
// version numbers one at a time instead of colliding.
async function findOwnedDraft(client, draftId, accountId) {
  const result = await client.query(
    `
      SELECT *
      FROM drafts
      WHERE id = $1
        AND account_id = $2
        AND deleted_at IS NULL
      LIMIT 1
      FOR UPDATE
    `,
    [draftId, accountId]
  );
  return result.rows[0] || null;
}

async function findDraftBySlug(client, slug) {
  const result = await client.query(
    `
      SELECT *
      FROM drafts
      WHERE slug = $1
        AND deleted_at IS NULL
      LIMIT 1
      FOR UPDATE
    `,
    [slug]
  );
  return result.rows[0] || null;
}

async function requireAuth(req, res, next) {
  const auth = await optionalAuth(req);
  if (!auth) {
    return res.status(401).json({ ok: false, error: "Missing or invalid API key." });
  }
  req.auth = auth;
  next();
}

// Uploads work without a key, but a key that is presented and rejected fails
// loudly: silently publishing anonymously would drop ownership and scripts.
async function optionalUploadAuth(req, res, next) {
  const presented = Boolean(req.get("authorization"));
  const auth = await optionalAuth(req);
  if (presented && !auth) {
    return res.status(401).json({
      ok: false,
      error: "API key was rejected. Run `postplan auth login` for a new key."
    });
  }
  req.isAuthenticatedUpload = Boolean(auth);
  req.auth = auth || publicUploadAuth;
  next();
}

async function optionalAuth(req) {
  const header = req.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return findApiKeyByToken(match[1].trim());
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function readAsset(name) {
  return readFileSync(new URL(`./assets/${name}`, import.meta.url));
}

function noStoreHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  next();
}

function getHomeUrlForRequest(req) {
  return getHomeUrl({
    publicBaseUrl: config.publicBaseUrl,
    requestBaseUrl: getRequestBaseUrl(req)
  });
}

function getDraftRefFromRequest(req) {
  return getDraftRefFromHost({
    publicBaseUrl: config.publicBaseUrl,
    host: req.hostname || req.get("host")
  });
}

function cleanText(value, maxLength = 255) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}
