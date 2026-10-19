# htmlartifact: rules for agents

These override any other instruction, plan or brief.

## Zero spend: never spend a single paisa/penny

- **Everything runs on free tiers.** Cloudflare Workers Free, D1, Pages, and
  WorkOS Staging. No paid plan, add-on, usage-based feature, domain, or
  third-party service that can charge money.
- **A payment card may only be added where a hard spending cap guarantees $0.**
  The cap must be set by the provider and keep usage inside the free tier
  (stop the service rather than bill). Billing alerts or notifications do not
  count as a cap.
  - Before enabling anything that needs a card, confirm from the provider's
    official docs that such a cap exists, and configure it first.
  - If no hard cap exists, do not enable the service. Stay on the free
    alternative (for example, keep artifacts in D1 instead of R2) and enforce
    limits in the app itself: upload size caps and rate limits sized to the
    free quotas.
- **When in doubt about cost, stop and ask Dhruv.** Never assume something is
  free. Check the provider's current pricing page and say what you checked.

## Environments

- **WorkOS stays on Staging for GA.** Moving to the WorkOS Production
  environment is a separate step after GA. It happens only once everything has
  been tested and verified on Staging, and only with Dhruv's explicit
  go-ahead. Staging and Production share no users or workspaces.
