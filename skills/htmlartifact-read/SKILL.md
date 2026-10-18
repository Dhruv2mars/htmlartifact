---
name: htmlartifact-read
description: Read an htmlartifact link (a URL on the user's htmlartifact server, usually containing /d/) that the user or a teammate shared. Use whenever you need the contents of such a page. Plain fetch or web tools cannot open these links because they require the user's team sign-in.
---

# htmlartifact-read

Artifacts are private to a team, so web fetch tools get a sign-in page or a
401. Read them with the CLI, which uses the user's own sign-in:

```sh
htmlartifact read '<url>'
```

It prints the final `URL`, the `Version` it read, and the `File` it saved the
HTML to. Read that file.

- Drop any `#fragment`; keep the rest of the path. `/v/<n>` pins a version,
  and a page path such as `/details` names one page of a multi-page artifact.
- For a multi-page artifact, resolve the relative links you need against the
  printed `URL` (a `<base href>` in the document overrides it) and read each
  one the same way.
- Cite the version you read when the user may update the page later.

## Failures

| Message | Meaning |
|---|---|
| `Not signed in` | Ask the user to run `htmlartifact login` |
| `HTTP 404 … current team` | Missing, or it belongs to another of the user's teams: `htmlartifact org list`, then ask before `htmlartifact org switch <team>` |
| `not your htmlartifact server` | The link is on a different server than the one the user signed in to; ask which one to use |

Never paste a token into a URL or a curl command to work around these.
