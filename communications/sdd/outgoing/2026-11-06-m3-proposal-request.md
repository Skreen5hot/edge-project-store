---
id: EPS-SDD-2026-11-06-m3-proposal-request
from: EPS
to: SDD
date: 2026-11-06
type: request
subject: M2 is validated; please write SDD's side of the M3 proposal (SDD project mode, v1.2)
in_reply_to: null
refs:
  - repo: Skreen5hot/edge-project-store
    commit: 8a9d747bd897f671bca1c67022a752f4911b4093
    path: MILESTONES.md
    sha256: 632f0cebfe738fa42cd7f23d09f542050e498db2dbcb729932158cb4b751b502
  - repo: Skreen5hot/edge-project-store
    commit: 8a9d747bd897f671bca1c67022a752f4911b4093
    path: validation/M2-validation.md
    sha256: b517ba3499949743c75768536d3466914dd7a225942d9bd10171dc1e7172723e
  - repo: Skreen5hot/edge-project-store
    commit: 8a9d747bd897f671bca1c67022a752f4911b4093
    path: review/2026-11-04-sdd-feedback.md
    sha256: 0db651c130d8470327e99d2938af3a5401c8d8e76f23d19a8916797c87f527c0
  - repo: Skreen5hot/edge-project-store
    commit: 8a9d747bd897f671bca1c67022a752f4911b4093
    path: spec/edge-project-contract.md
    sha256: 0304c27ea35434417ad1bea1e813c10362a00d13f56e79ec230abffb079cf6f9
  - repo: Skreen5hot/edge-project-store
    commit: 8a9d747bd897f671bca1c67022a752f4911b4093
    path: src/browser-backend.mjs
    sha256: 79625daa8c7effdedc25d4c8289f093d48e25acb5fe1ff2c4934c8628c54c571
author: Claude Opus 5.5 (agent), drafted at the direction of Aaron Damiano (registrar)
requires_act: false
---

# M2 is validated; please write SDD's side of the M3 proposal

## What we ask

In your feedback of 2026-11-04 (`review/2026-11-04-sdd-feedback.md`, "What SDD will bring to M3") you offered to
write SDD's side of the M3 proposal on the registrar's go-ahead. M3 depends on M2, and M2 is now validated: the
registrar asks you to write it.

Please cover what you listed then:

1. what SDD commits to `sdd/`: the SDD as an `assisted` artifact, its input schema as a dependency, the previous
   SDD as `history`;
2. what it keeps in `sdd/work/` to resume unfinished work;
3. how it detects that the work file is out of date (§9: detected, not prevented);

and, now that M2 has measured the browser side:

4. what SDD shows when a project folder cannot be opened (M2-c), and its fallback to opening and saving single
   files;
5. how SDD shows that it is saving: a commit writes three files or more, at about 0.5–0.9 s each in a OneDrive
   folder in the registrar's run (slowest 2.5 s, 5–7 s each in an earlier run);
6. how SDD takes the EPS module in: packaging is M4 and not yet decided, so say what SDD needs (for example a
   vendored copy pinned by digest), not how it is published.

Send it as a message (or as a proposal file the message refers to). The contract is frozen at **v0.2**: anything
in it SDD needs changed goes in the proposal as a request, for the registrar's decision.

## What M2 gives SDD

Validated by the registrar on 2026-11-06 (`validation/M2-validation.md`, run `run-20261106-201535`, Chrome 156,
commit `2772f47`; sign-off at `8a9d747`):

- **`browserBackend(directoryHandle)`** (`src/browser-backend.mjs`), used with `openProject` and `loadTree` from
  `src/index.mjs` exactly as the Node backend is. It passes the same conformance and writer tests (25 of 25
  examples, byte for byte) in a real folder, on a page opened as a file and on one served from `localhost`.
- **The folder picker works on a page opened from a `file:` URL**, your question in item 3 of the feedback. A stored
  folder handle and its permission **survived a browser restart, still granted**, on both kinds of page (M2-b).
- **When folder access is unavailable** (no API, or disabled), the project page says so plainly and greys out
  *Open* (M2-c); `browser/access.mjs` has the words.
- **A file the browser cannot read** is reported as `E-UNREADABLE` with the browser's error name (M2-e).

## Limits SDD should design for

- **Checked, not exclusive (R-W9).** Tabs of one origin never race (Web Locks). Two origins, such as SDD's website
  and a saved copy, open on one project at once, can race: in the registrar's run, Chrome's `move()` **replaced** a
  file another page had just written, and the loss was **reported** (`E-INTEGRITY`, `E-CURRENT-UNRESOLVED`), never
  silent. A fork from one head is `conflicted`, 2 heads, for a person to resolve (R-W3).
- **Two origins remember separately:** the website and a saved copy each keep their own folder and permission.
- **Path length in Chrome on Windows:** full paths over about 252 characters cannot be written directly (259
  through the backend). A revision path inside a project is up to 113 characters, so a project folder's own path
  must stay under about 140–145 characters for browser tools. Such a file is reported as
  `E-UNREADABLE (NotFoundError)` and the project page says the folder is probably too deep.
- **OneDrive can interrupt a write for a moment:** the backend retries it (4 of 298 writes in the registrar's run).

## Not in this message

No decision: the M3 decision is the registrar's, on your proposal. Packaging (M4) is not decided. This
repository became public on 2026-11-06; the refs above are at commits there, and their digests are of committed
bytes.
