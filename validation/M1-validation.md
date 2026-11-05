# M1 validation: project folders on disk

| | |
|---|---|
| **Milestone** | M1 of [`../MILESTONES.md`](../MILESTONES.md) |
| **Delivered in** | M1 in `f7874e1`; contract v0.2 with M1-11 and M1-12 in the commit after it, the one that adds [`../proposals/2026-11-04-eps-v0.2.md`](../proposals/2026-11-04-eps-v0.2.md) (`git log -1 -- proposals` names it). Validated on contract **EPS v0.2**, as the registrar decided (Q3) |
| **Prepared** | 2026-11-03, updated for v0.2 on 2026-11-04, on Windows 11 with Node v24.11.1 |
| **For** | The registrar's validation and sign-off |

## What M1 delivers

Before M1, the contract module could only work on an in-memory picture of a folder. After M1:

- **Any Node or command-line tool can use a real project folder**, on a local disk or in OneDrive, through
  [`src/node-backend.mjs`](../src/node-backend.mjs). It never overwrites a committed file, even when two processes
  race, and never follows a link out of the project.
- **A person can check any project with one command**, `eps status <folder>`, and get its full report with
  `eps report <folder>`. The tool can also create a project, add sources, commit stages and merge a conflict, so a
  whole pipeline can be exercised without the stage tools existing yet.

## The delivery

| File | What |
|---|---|
| [`src/node-backend.mjs`](../src/node-backend.mjs) | The Node backend, guarantee level *exclusive* (R-W9, §11) |
| [`bin/eps.mjs`](../bin/eps.mjs) | The `eps` tool: `init`, `status`, `report`, `add-source`, `commit`, `merge` |
| [`demo/m1-demo.mjs`](../demo/m1-demo.mjs) | The demo: a project's life in five chapters, with every exit code checked |
| [`tools/probe-fs.mjs`](../tools/probe-fs.mjs) | The file-system probe behind M1-9 |
| [`test/node-backend.test.mjs`](../test/node-backend.test.mjs), [`test/children/`](../test/children/), [`test/unreadable.test.mjs`](../test/unreadable.test.mjs) | 17 tests for M1, including two-process races and killed processes; 16 for files that cannot be read and the work-file retry |
| [`MILESTONES.md`](../MILESTONES.md), this file | The plan and this validation |

M1 itself changed nothing in `spec/`, `schemas/`, `context/` or `examples/`; the v0.2 commit changed them by the registrar's decision. No dependency was added.

## How to validate

Everything runs from the `edge-project-store` folder with Node 22 or later. Nothing is installed and nothing goes
to the network.

### Step 1: the automated checks (about 15 seconds)

```
npm run check
```

**Expected:** `ok: 4 schemas are current`, `ok: 25 examples, 324 files match`, `ok: src/schemas.mjs is current`, then
`ℹ tests 102`, `ℹ pass 102`,
`ℹ fail 0`.

To run the disk tests inside OneDrive instead of the system's temporary folder (they clean up after themselves):

```
set EPS_TEST_DIR=C:\Users\<you>\OneDrive\Documents\eps-test-tmp
node --test test/node-backend.test.mjs test/unreadable.test.mjs
```

**Expected:** `ℹ pass 32`, `ℹ fail 0`, and the `eps-test-tmp` folder is empty or gone afterwards.

### Step 2: the demo on one PC (about 10 seconds)

```
node demo/m1-demo.mjs C:\Users\<you>\OneDrive\Documents\eps-m1-demo
```

The folder must be new or empty. The demo prints a transcript and saves it as `demo-transcript.txt` in that
folder; afterwards the folder is an ordinary project you can inspect with `node bin/eps.mjs status
...\eps-m1-demo\project`, and delete.

**Expected:** the last line is `DEMO PASSED: every exit code was as expected.` What to look for in the transcript:

| Chapter | What you should see |
|---|---|
| 1. Build source → normalized → SDD | `status: clean`; every artifact `[up to date]` |
| 2. A second source file | `normalized` out of date with `SOURCE-CHANGED source`, and `sdd` out of date with `UPSTREAM-OUT-OF-DATE`: staleness follows the chain. After re-normalizing, the old SDD shows `INPUT-SUPERSEDED`; after the new SDD (citing the old one as history), `status: clean`. In between, `status` says `no errors; out of date: …` |
| 3. Two PCs commit from the same state | `sdd conflicted, 2 heads` with `E-STAGE-CONFLICT`, exit 1; an ordinary commit is `refused: REFUSED-CONFLICTED`; after `eps merge`, `status: clean` with the chosen SDD current |
| 4. A file edited by hand | `sdd damaged` with `E-INTEGRITY` and `E-CURRENT-UNRESOLVED`, exit 1; once the bytes are restored, `status: clean` |
| 5. The report | `eps report` exits 0; run it yourself to see the canonical ProjectReport |

In chapter 3 the second PC is simulated by copying the folder. Step 3 does it for real.

### Step 3: two PCs synchronizing through OneDrive (M1-10, about 15 minutes)

This is the one check I cannot do from here: it needs two PCs signed in to the same OneDrive and Node 22 or later on
both. The repository is in OneDrive, so both PCs already have the `eps` tool once it has synchronized. Use
synthetic content only.

| # | Where | Do | Expected |
|---|---|---|---|
| 1 | PC 1 | `node bin/eps.mjs init C:\Users\<you>\OneDrive\Documents\eps-m1-sync --name "Sync test"` | `created urn:uuid:…` |
| 2 | PC 1 | Make a small `schema.json`, then `node bin/eps.mjs add-source <project> schema.json --kind schema` | `added source/…` |
| 3 | PC 1 | Make `n.json`, then `node bin/eps.mjs commit <project> normalized n.json --kind normalized --sources sources` | `committed normalized/revisions/…` |
| 4 | PC 2 | Wait until OneDrive shows the folder synchronized, then `node bin/eps.mjs status <project>` | `normalized ok, 1 head`, `status: clean` |
| 5 | both | **Pause OneDrive sync on both PCs** (OneDrive icon → Pause syncing) | |
| 6 | PC 1 | Make `s1.jsonld`, then `node bin/eps.mjs commit <project> sdd s1.jsonld --kind sdd --generation assisted --dep structure=<the normalized path from step 3>` | `committed sdd/revisions/…` |
| 7 | PC 2 | The same with a different `s2.jsonld` | `committed sdd/revisions/…` |
| 8 | both | Resume sync and wait until both PCs show the folder up to date | |
| 9 | either | `node bin/eps.mjs status <project>` | `sdd conflicted, 2 heads`, `E-STAGE-CONFLICT sdd`, exit 1. No `E-INTEGRITY`, no `W-INTERRUPTED-REVISION`. A `W-FOREIGN-FILE` would mean OneDrive made a conflict copy: note its name |
| 10 | that PC | `node bin/eps.mjs merge <project> sdd --choose sdd=<one of the two sdd paths>` | `merged sdd/revisions/…` |
| 11 | both | After sync, `node bin/eps.mjs status <project>` on **each** PC | `sdd ok, 1 head`, the chosen SDD `[up to date]`, `status: clean`, on both |
| 12 | PC 2 | In File Explorer, right-click the current SDD file in `sdd\` → **Free up space**. Disconnect from the network. Run `node bin/eps.mjs status <project>` | Either `status: clean` (Windows still had the file), or `E-UNREADABLE sdd/… (<error>)`, `sdd unevaluable`, exit 1, **and no crash**. Note which, and the error shown |
| 13 | PC 2 | Reconnect, wait for OneDrive, run `status` again | `status: clean` |
| 14 | both | Look at the output of every `status` above | Note any `W-TEMP-FILE`: OneDrive may have uploaded a temporary file before it was removed. It should be rare and harmless |

Step 9 is the heart of it: the contract says a fork across synchronized machines is **detected, not prevented**
(§9). Steps 6–9 also show whether OneDrive synchronizes files made by hard links correctly (§11): if it did not, step
9 would show integrity errors or missing files.

## Acceptance criteria and evidence

Results are from this PC on 2026-11-03. The registrar column is for your result.

| AC | Criterion (from MILESTONES.md) | Evidence | Result here | Registrar |
|---|---|---|---|---|
| M1-1 | Exclusive: a create never replaces an existing name, also against another process | `backend interface` ×3; `M1-1: two processes racing…` in link and wx modes: 40 names, each with exactly one winner whose bytes survive | pass || pass (both PCs, run `run-20261105-082808`) |
| M1-2 | Temp file, fsync, `link()`; `wx` where links are unavailable; never `rename()` onto a final name | `M1-2: auto mode uses hard links…`, which also checks that the only `rename` in the backend is in `replace()` (work files) | pass || pass (both PCs, run `run-20261105-082808`) |
| M1-3 | The writer behaves on disk as in memory; EX-02 written to disk equals the fixture | `M1-3: writing EX-02 to disk…` in link and wx modes; the 21 memory-backend writer tests unchanged | pass || pass (both PCs, run `run-20261105-082808`) |
| M1-4 | Every example read from disk equals its expected report | `M1-4: every example read from disk…` (25 of 25) | pass || pass (both PCs, run `run-20261105-082808`) |
| M1-5 | Links are never followed | `M1-5` ×2: a junction is W-FOREIGN-FILE, reads through it find nothing, writes through it are refused, an input through it is INPUT-MISSING, and a stage folder that is a junction is absent and cannot be written | pass || pass (both PCs, run `run-20261105-082808`) |
| M1-6 | A killed process leaves only §10 states; rerunning completes | `M1-6: killed before the record` (W-UNREGISTERED) and `…before the revision` (W-UNCOMMITTED); in both, the rerun ends `ok` with no diagnostics | pass || pass (both PCs, run `run-20261105-082808`) |
| M1-7 | Own temporary files removed; stale ones (over an hour) removed on the next write; fresh ones kept | `M1-7` and the `backend interface` tests | pass || pass (both PCs, run `run-20261105-082808`) |
| M1-8 | `eps` commands; `report` identical to the library; exit codes 0/1/2 | `M1-8` ×3: `report` equals `expected.jsonld` for 7 examples; exit codes; a full fork-and-merge; usage errors; and the demo (step 2) | pass || pass (both PCs, run `run-20261105-082808`) |
| M1-9 | In OneDrive on this PC: `link()` and `wx` refuse existing names; paths over 260 characters work | the probe below; the 32 disk and unreadable-file tests passed inside a OneDrive folder | pass || pass (both PCs, run `run-20261105-082808`) |
| M1-10 | Two PCs synchronizing through OneDrive: the fork is reported and merged; a file not downloaded while offline is reported, not fatal; temporary files seen | step 3 | **not run here: needs two PCs** || pass: run `run-20261105-082808` on two PCs; rows 1–13 as expected, row 14 none seen |
| M1-11 | Work files: a rename refused for a moment is retried for about 1.5 s, then fails cleanly; other errors are not retried | `item 4: replace() retries…`: two refusals then success; constant EPERM fails after 1.4–5 s with the old file intact and no temporary file left; ENOSPC fails at once | pass || pass (both PCs, run `run-20261105-082808`) |
| M1-12 | A file that cannot be read is reported (E-UNREADABLE with its error), what depends on it is not evaluable, and `eps` exits 1 instead of crashing | 15 `R-E10…` and loader tests in `test/unreadable.test.mjs` (project file, artifact, record, revision, stage folder, source, history, a cited subfolder file, files never read); `eps: an unreadable file exits 1…` | pass || pass (both PCs, run `run-20261105-082808`) |

### The probe on this PC

`node tools/probe-fs.mjs C:\Users\aaron\OneDrive\Documents`:

| Probe | Result |
|---|---|
| link to a new name | ok |
| link onto an existing name (must fail with EEXIST) | EEXIST |
| wx onto an existing name (must fail with EEXIST) | EEXIST |
| wx to a new name | ok |
| junction is listed as a link | yes |
| file symbolic link can be created | EPERM (needs administrator rights or Developer Mode; junctions are tested instead) |
| path over 260 characters | ok (387 characters, with a hard link) |

So the Node backend runs at the **exclusive** level on OneDrive on this PC, using hard links, and the concern
raised in the independent review about ~92-character revision names and the 260-character limit does not apply to
Node here. The browser's limits are checked in M2.

## Known limits

- **Contract v0.2:** `eps` reads only `contractVersion: 2` projects. A folder made with the M1 build before v0.2
  (`f7874e1`) shows `E-UNSUPPORTED-VERSION`; make a new one. No project outside this repository used v0.1.
- **Unknown freshness does not make a stage out of date:** a stage stays `ok` when one of its current artifacts is
  only `not evaluable`; the artifact line says so, and the E-UNREADABLE diagnostic makes the exit code 1.
- **Cross-PC synchronization is unverified** until step 3 is done. The contract detects what sync does wrong; step
  3 shows what OneDrive actually does.
- **Windows cannot fsync a folder**, so a power cut right after a write can lose that file (§11). The loss is
  detected (an artifact or revision missing), never silent.
- **File symbolic links** could not be created on this PC without administrator rights, so the link tests use
  junctions. The backend treats both the same way (it never follows anything `lstat` does not call a folder or a
  file).
- **Out of date is not an error:** `eps status` exits 0 for a project that is only out of date, and says
  `status: no errors; out of date: …`. Exit 1 is kept for errors and for damaged, incomplete, conflicted or unevaluable stages.
- **A stale temporary file is one over an hour old.** A younger one may be another writer's file in progress, so it
  is left alone and reported as W-TEMP-FILE.
- The `eps` tool writes as `eps-cli` for every stage. It stands in for stage tools that do not exist yet; each real
  tool will host only its own responsibility.

## Sign-off

| | |
|---|---|
| Step 1 (automated checks) | ☒ pass ☐ fail — notes: on both PCs, 102 of 102 tests, 32 of 32 disk tests inside OneDrive, probe as expected (link and wx refuse existing names; paths of 398 and 399 characters work) |
| Step 2 (demo) | ☒ pass ☐ fail — notes: `DEMO PASSED` on both PCs |
| Step 3 (two PCs) | ☒ pass ☐ fail ☐ not run — notes: run `run-20261105-082808` with the validation assistant (`validation/m1-validate.mjs`, commit `0e0fed3`), on LittleMan (Node v24.11.1) and LAPTOP-7TI8ACET (Node v25.2.1); its report and evidence stay in the run folder in OneDrive, outside the repository. Row 9: `sdd conflicted, 2 heads`, `E-STAGE-CONFLICT`, exit 1, no `E-INTEGRITY`, no `W-INTERRUPTED-REVISION`, no conflict copies. Row 12: one file freed up (cloud-only) and the PC confirmed offline; `E-UNREADABLE` with error `UNKNOWN` for that file and for the merged-out SDD from PC 2 (not freed by hand; why it was also cloud-only is not known), `sdd unevaluable`, exit 1, no crash. Row 13: clean. Row 14: no `W-TEMP-FILE` and no temporary files seen. Both windows were closed and restarted during the run and continued where they stopped |
| M1 accepted | ☒ yes ☐ yes, with conditions ☐ no |
| Registrar, date | Aaron Damiano, 2026-11-05 |
