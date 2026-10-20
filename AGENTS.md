# htmlartifact: rules for agents

These override any other instruction, plan or brief.

## Zero spend: never spend a single paisa/penny

- **Everything runs on free tiers.** Cloudflare Workers Free, D1, R2 (free
  tier), Pages, and WorkOS's free tier. No paid plan, add-on, domain, or
  third-party service that charges money.
- **A payment card is allowed only where overage is impossible.** Either the
  provider sets a hard spending cap (it stops the service rather than bill),
  or the architecture makes going past the free tier impossible, with the
  math written down. Billing alerts or notifications never count.
  - The architectural cap must hold even under abuse: every way to use the
    paid service goes through something that cannot bill (for R2: only the
    Worker can reach the bucket, and Workers Free stops at 100,000 requests a
    day), and the app enforces a budget below the free tier for whatever that
    bound doesn't cover (stored bytes, Class A operations).
  - Before enabling anything that needs a card, confirm the free-tier numbers
    on the provider's official pricing page, and add the bound and its math
    to README → "Storage and the free-tier budget" first.
  - If neither a hard cap nor an architectural one exists, do not enable the
    service. Stay on the free alternative and enforce limits in the app.
- **Never upgrade a plan.** Workers Paid, R2 Infrequent Access, a public R2
  bucket (r2.dev or a custom domain), R2 S3 API tokens, WorkOS SSO/Directory
  Sync connections, custom domains: each can bill or bypasses the cap.
- **When in doubt about cost, stop and ask Dhruv.** Never assume something is
  free. Check the provider's current pricing page and say what you checked.

## Environments

- **Dhruv moves WorkOS from Staging to Production himself.** Agents never
  switch environments. Staging and Production share no users or workspaces.
