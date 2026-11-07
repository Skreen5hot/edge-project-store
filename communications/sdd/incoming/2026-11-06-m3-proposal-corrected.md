---
id: SDD-EPS-2026-11-06-m3-proposal-corrected
from: SDD
to: EPS
date: 2026-11-06
type: answer
subject: "Corrected: SDD's side of M3 (SDD v1.2 project mode), approved in direction by the registrar; no EPS contract change"
in_reply_to: SDD-EPS-2026-11-06-m3-proposal
refs:
  - repo: Skreen5hot/SemanticDataDictionary
    commit: f38a630146fd1f90195854d4b27b326542c67614
    path: review/proposals/prop-005/prop-005.md
    sha256: 456131eec3640db73417171f5524f00ccb029c0f5c8290cb35b78e315ab1aee4
  - repo: Skreen5hot/SemanticDataDictionary
    commit: f38a630146fd1f90195854d4b27b326542c67614
    path: project/DECISIONS.md
    sha256: 5ede6fc764cf46223fa9a877c503d3dcf7c719e6f163fb89dce523ed1a045be6
author: Claude Opus 5.5 (agent), drafted at the direction of Aaron Damiano (registrar)
requires_act: true
source:
  repo: Skreen5hot/SemanticDataDictionary
  commit: 02f8d0ed4b9a4e14ebf002b7b3735555fd34e99f
  path: communications/eps/outgoing/2026-11-06-m3-proposal-corrected.md
  sha256: f2152e080ae1689c1b804e36520a91897cb883c5ba747f71e261173c182c29dd
---
---
id: SDD-EPS-2026-11-06-m3-proposal-corrected
from: SDD
to: EPS
date: 2026-11-06
type: answer
subject: "Corrected: SDD's side of M3 (SDD v1.2 project mode), approved in direction by the registrar; no EPS contract change"
in_reply_to: SDD-EPS-2026-11-06-m3-proposal
refs:
  - repo: Skreen5hot/SemanticDataDictionary
    commit: f38a630146fd1f90195854d4b27b326542c67614
    path: review/proposals/prop-005/prop-005.md
    sha256: 456131eec3640db73417171f5524f00ccb029c0f5c8290cb35b78e315ab1aee4
  - repo: Skreen5hot/SemanticDataDictionary
    commit: f38a630146fd1f90195854d4b27b326542c67614
    path: project/DECISIONS.md
    sha256: 5ede6fc764cf46223fa9a877c503d3dcf7c719e6f163fb89dce523ed1a045be6
author: Claude Opus 5.5 (agent), drafted at the direction of Aaron Damiano (registrar)
requires_act: true
---

# SDD's side of M3: SDD v1.2, project mode

**This corrects `SDD-EPS-2026-11-06-m3-proposal`**, which answers your request
`EPS-SDD-2026-11-06-m3-proposal-request`. Its header is not valid YAML: the `subject` has an unquoted `: `, so
`tools/alert.py` and any YAML reader refuse it. A committed message never changes (Rule 1), so this one replaces
it. The body below is the same, word for word. Please record this one; the other was never announced.

The proposal is **prop-005, revision 2** (first ref). The registrar approved its direction on 2026-11-06, required
six targeted revisions, and authorized implementation on the revised text. ADR-010 (second ref) records the
decision.

## Your six questions, answered

| # | You asked | prop-005 |
|---|---|---|
| 1 | What SDD commits to `sdd/` | §2: the SDD (`kind: sdd`, `generation: assisted`, `sdd-author`), with a `structure` dependency on its input, and on a rerun `history` on the previous SDD. One revision per commit. Rerun rules in §2.1 |
| 2 | What it keeps in `sdd/work/` | §3: one file per work session, `session-<id>.json`, saved through `replace()`, one save at a time. After a commit it is kept until a person removes it (§3.1) |
| 3 | How it detects stale work | §4, D1–D6: input moved on, a newer SDD head (commit blocked until the person confirms), another writer, the same session diverged on two PCs, a term list or tool change, an unreadable work file |
| 4 | When a folder cannot be opened | §5: `browser/access.mjs`'s words, then the single-file fallback; the path-depth message; asking for permission again |
| 5 | How it shows saving | §6: "1 of 3 … 3 of 3" for a commit, with every action disabled until it ends; a quiet status for work saves |
| 6 | How it takes the module in | §7: vendored at one EPS commit, each file pinned by SHA-256, verified before every build, inlined into the single page |

## What matters to EPS

- **No change to the EPS v0.2 contract** is requested or authorized (§8). v0.2 already has everything SDD needs:
  EX-07, EX-19, R-P6, R-W3, R-W4 and R-E10.
- **SDD's input, in the build order:** SDD, EPS, the normalizer, RML, BIBS 2.0. Until the Schema service exists,
  SDD cites a Jira Assets schema in `source/` directly (EX-07). It never writes `normalized/`.
- **For the module (§7):** SDD needs:
  - a stable list of the browser module's files;
  - no dependencies;
  - ES modules that can be inlined;
  - a tagged commit per module version.
- **For your milestone file:** the M3 acceptance criteria for SDD's side are prop-005 §10, M3-1 to M3-9. M3-9 (the
  normalized-schema conformance check) waits for the Schema service's contract and is not needed for M3 sign-off.
  Please carry them into `MILESTONES.md`.
- **Found while revising, not requested:** `commit()` takes whatever heads exist when it writes as its parents, so a
  head that arrives during SDD's commit is superseded without a fork. SDD detects this after the commit and tells
  the person (§4, "The window around a commit"). An option to commit only on expected parents would close it. That
  is a module change, not a contract change, and it would need the registrar's separate decision.

## Not in this message

The Schema service's format and key algorithm (§1.1 lists only what SDD needs from them), the RML service, and
packaging (M4).
