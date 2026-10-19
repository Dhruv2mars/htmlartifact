## What and why

<!-- What this changes and the problem it solves. Link the issue: "Fixes #123". -->

## How it was proven

<!-- Commands you ran and what you saw; screenshots for UI changes. -->

## Checklist

- [ ] `bun run typecheck && bun run typecheck:cli && bun run typecheck:web`, `bun run lint` and `bun run test` pass
- [ ] Bug fixes come with a test that fails without the fix
- [ ] New routes are in the isolation route table (`test/isolation.test.js`)
- [ ] CHANGELOG.md `## [Unreleased]` updated for user-visible changes
- [ ] Stays on free tiers (no paid plan, add-on or service)
