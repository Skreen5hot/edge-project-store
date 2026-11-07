---
id: EPS-SDD-2026-11-07-m3-decisions
from: EPS
to: SDD
date: 2026-11-07
type: answer
subject: "The registrar's decisions on prop-005: M3 criteria accepted; expectedHeads added; module files listed and tagged eps-module-v0.2.0"
in_reply_to: SDD-EPS-2026-11-06-m3-proposal-corrected
refs:
  - repo: Skreen5hot/edge-project-store
    commit: 346b88600b44ad5593665f237145e486b76a9fd3
    path: MILESTONES.md
    sha256: f5a565de4f56c91fc45c7e7fde35c53f6d51c52cd93c8cd5d4785818ece6927d
  - repo: Skreen5hot/edge-project-store
    commit: 346b88600b44ad5593665f237145e486b76a9fd3
    path: README.md
    sha256: 481fbbffc61a7463684fa45ef3eb9aaf8522e8f6e72b59f19ee2ec5f298852ad
  - repo: Skreen5hot/edge-project-store
    commit: 346b88600b44ad5593665f237145e486b76a9fd3
    path: src/project.mjs
    sha256: eb1ec0dd826bbf98763d316d35df9c08a40a3d6a8921e5847e66a7ad38f0520c
author: Claude Opus 5.5 (agent), drafted at the direction of Aaron Damiano (registrar)
requires_act: false
---

# The registrar's decisions on prop-005

Thank you for prop-005, revision 2. The registrar decided on 2026-11-07, on our recommendations, the three things
your message asked of EPS. All three are done at commit `346b886`, tagged **`eps-module-v0.2.0`**. The contract
is unchanged (v0.2).

## 1. M3's criteria: accepted as written

`MILESTONES.md` now has an M3 section carrying prop-005 §10, M3-1 to M3-9, word for word, with this message's
decisions. M3-9 waits for the Schema service's contract and is not needed for M3 sign-off, as you wrote. You build
and validate M3 in your repository; the sign-off is the registrar's.

## 2. Committing only on the heads the person saw: added

`commit()` and `merge()` take an optional **`expectedHeads`**: the stage's heads, as revision paths exactly as the
report's `stages.sdd.heads` lists them, that SDD showed the person (D2). If the heads differ when the write starts,
**nothing is written** and the call fails with `EpsWriteError` code **`HEADS-CHANGED`**. Order does not matter.
`[]` means "the person saw no SDD".

A correction to prop-005 §4, "The window around a commit". `commit()` does not take whatever heads exist at the
moment it writes. It reads the heads when it starts. R-W5 then refuses with `STAGE-CHANGED` if any revision appears
while it writes, and it writes no revision (the artifacts already written stay uncommitted, `W-UNCOMMITTED`). So the
window was not during the commit. It was **between the person's confirmation and the start of `commit()`**. A head
that arrived then was superseded without anyone seeing it. `expectedHeads` closes that window, leaving only the
instant before the revision is created that R-W5 already narrows. Across origins (your website and a saved copy) and across PCs,
the checked level still applies (R-W9, §9): narrowed, not prevented. A fork is still reported as `conflicted`.

For SDD, that probably means:

- pass the heads the person confirmed as `expectedHeads`;
- on `HEADS-CHANGED`, show D2 again with the new heads;
- keep the after-commit check, for the cross-origin case.

That choice is yours.

## 3. The module for vendoring

`README.md`, "Using the module in a browser tool", lists the files:

- **always:** `src/index.mjs`, `contract.mjs`, `sha256.mjs`, `jsonschema.mjs`, `schemas.mjs`, `project.mjs`,
  `memory-backend.mjs`, `browser-backend.mjs`;
- **optional:** `browser/access.mjs` (the words for M2-c) and `browser/handle-store.mjs` (remembering the folder).

They are plain ES modules with no dependencies and no imports outside the list, so they can be inlined.
`src/node-backend.mjs` and `src/summary.mjs` are for Node only. The repository is `* -text`, so the committed bytes
are what you pin. Module versions are tags `eps-module-v<version>`; pin **`eps-module-v0.2.0`**
(`346b88600b44ad5593665f237145e486b76a9fd3`). The rest of packaging is M4.

## Not in this message

The M3 sign-off, and packaging and publication of the module beyond the tag (M4).
