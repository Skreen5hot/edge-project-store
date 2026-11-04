# Feedback from SDD on M1 and the road to M3

| | |
|---|---|
| **From** | SDD (Semantic Data Dictionary), the first consumer of this contract (M3) |
| **Author** | Claude (agent), drafted at the direction of Aaron Damiano (registrar) |
| **Date** | 2026-11-04 |
| **Read** | `MILESTONES.md`; `spec/edge-project-contract.md` §1–6 and §8–11; `src/node-backend.mjs`; `bin/eps.mjs`; `validation/M1-validation.md` |
| **Ran** | `npm run check` on the working tree (M1 files uncommitted): 25 examples match, schemas current, 87/87 tests pass |
| **Channel** | This file, not the communications board: the repository stays local until the publication decision (D10, M4) |

Item 1 is the registrar's direction (2026-11-04). The rest are suggestions from SDD. Ordered by how much they
matter to SDD.

## 1. Registrar's direction: enforce project structure, not process

§3 requires a structural root in `normalized` for `sdd` to be pipeline-ready (R-E7). SDD v1 reads the Jira Assets
import schema directly, and no normalizer exists, so in project mode every SDD would evaluate as not ready.

The registrar's direction: **the contract enforces project structure and document management, not pipeline
process rules.** SDD will take a "normalish" schema as its input, whatever produced it. Which stage's output feeds
which, and whether a stage was run first, is for the tools and the people using them to decide, not for the
contract to require.

What that likely touches, for the EPS team to work out and bring back to the registrar:

- the "structural root required" column of §3, R-E7 and `pipelineReady` / `notReadyBecause` in the report;
- the examples whose expected reports depend on them;
- staying unchanged: layout, names, records, revisions, never-overwrite, integrity, conflicts, out-of-date
  tracking through declared inputs, and work in progress.

v0.1 is frozen, so this is a new contract version. Because nothing outside this repository has adopted v0.1 yet,
the cheapest moment to make it is before M2.

## 2. M3's version number

`MILESTONES.md` calls M3 "SDD v1.1". SDD released v1.1.0 on 2026-11-04 for an unrelated change (its class
hierarchy now comes from Ontology-Template). Project mode will be the next release after that, v1.2.

## 3. Checks M2 should include, because SDD depends on them

SDD is a single offline HTML page, and it is often run as a **saved copy opened from disk**, not from its website.

- Does `showDirectoryPicker()` work on a page opened from a `file:` URL, and does a stored folder handle (and its
  permission) survive a browser restart there?
- Can managed browser policy disable File System Access? If so, M2 should say what a tool shows when the folder
  cannot be opened, so SDD can fall back to its current save-and-open files.
- §9 already says Web Locks do not span origins. For SDD that means the website and a saved copy, open on the same
  project at once, are two writers with no lock between them. Worth one example or test.

## 4. Node backend: `replace()` on Windows and OneDrive

`replace()` renames a temporary file onto an existing work file with no retry. On Windows a rename onto a file
that another process holds open (OneDrive while uploading, antivirus while scanning) fails briefly with `EPERM`,
`EBUSY` or `EACCES`. SDD's resume file would live in `sdd/work/` and be replaced often. A short bounded retry on
those codes would avoid spurious failures. Committed files are unaffected (they never use `rename`).

## 5. OneDrive files not yet downloaded (please verify, not tested)

With Files On-Demand, a file can be listed but not downloaded. Reading it offline may fail with an error other
than `ENOENT`; `read()` re-throws such errors, so one cloud-only file might stop the whole evaluation instead of
being reported. One more case in M1 step 3: on one PC, "Free up space" on one artifact, go offline, run
`eps status`, and record what it says.

## 6. Smaller points

- M1's files are still uncommitted. Committing them before sign-off would let `validation/M1-validation.md` name a
  single commit rather than `bcad226` plus a file list.
- Temporary files are written inside the synchronized folder, so OneDrive may upload one before it is removed. In
  step 3, note any `W-TEMP-FILE` seen on the other PC; it should be rare and harmless.

## What SDD will bring to M3

On the registrar's go-ahead, SDD will write its side of the M3 proposal: what it commits to `sdd/` (the SDD as an
`assisted` artifact, its input schema as a dependency, the previous SDD as `history`), what it keeps in
`sdd/work/` to resume, and how it detects that work file being out of date (§9).
