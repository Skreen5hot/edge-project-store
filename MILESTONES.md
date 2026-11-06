# Milestones

**Status:** plan approved with the proposal (2026-11-03). Each milestone delivers something a person can use and
validate, ends with a validation document under [`validation/`](validation/), and is signed off by the registrar
before the next begins. Slices 1 and 2 of [`PROPOSAL.md`](PROPOSAL.md) are done. The contract is **v0.2**
(2026-11-04; v0.1 at the tag `eps-v0.1`), made before M2 by the registrar's decision so that M1 is validated once,
on v0.2.

| # | Milestone | Value delivered | Slice | Status |
|---|---|---|---|---|
| M1 | **Project folders on disk** | Any command-line or Node tool can create, write and inspect a project folder on a local disk or in OneDrive, with conflicts and damage reported; a person can check any project with one command | 3 (Node half) | **validated** on v0.2 by the registrar, 2026-11-05 ([`validation/M1-validation.md`](validation/M1-validation.md)) |
| M2 | **Project folders in the browser** | A single offline HTML page can open a project folder, keep its permission across restarts and show the project's state, so browser tools such as SDD can use the same folders | 3 (browser half) | **validated** on v0.2 by the registrar, 2026-11-06 ([`validation/M2-validation.md`](validation/M2-validation.md)) |
| M3 | **SDD project mode (SDD v1.2)** | The SDD tool opens a project, saves SDDs as committed artifacts, resumes unfinished work and reopens a mapping | 4 | needs the SDD-side proposal |
| M4 | **Packaging and publication** | A pinned single-file module that tools vendor, and the publication decision | — | registrar decision |
| later | Other stages | Normalizer, RML, RDF, graph loader and diagram exporter adopt the module as they are built | later | |

M2 depends on M1 only for shared tests. M3 depends on M2 (the SDD tool is a single HTML page). M4 can follow M2.

## M1: Project folders on disk

**Delivers:** a Node backend (`src/node-backend.mjs`) and an `eps` command-line tool (`bin/eps.mjs`).

| AC | Acceptance criterion | How it is shown |
|---|---|---|
| M1-1 | The Node backend is **exclusive** (R-W9): a create never replaces an existing name, including when two processes race for the same name | backend tests; a test with two child processes racing |
| M1-2 | Writes follow §11: temporary file, `fsync`, `link()` to the final name; where hard links are unavailable, exclusive create (`wx`); never `rename()` onto a final name | backend tests in both modes; code review |
| M1-3 | The writer behaves the same on disk as in memory: the writer scenarios pass on the Node backend in both write modes, and EX-02 written to disk equals the fixture | tests |
| M1-4 | Reading from disk conforms: every example evaluated from disk through the Node backend equals its expected report | tests |
| M1-5 | Links are never followed: a junction (or symbolic link) inside a project is reported as W-FOREIGN-FILE, and an input through it is INPUT-MISSING; the backend refuses to read or write through one | tests (junctions need no administrator rights on Windows) |
| M1-6 | A process killed mid-commit leaves only the recognized states of §10, and a rerun of the same command completes the commit | test with a killed child process |
| M1-7 | Temporary files: a write removes its own; stale ones (over an hour old) left by a crash are removed on the next successful write in that folder (R-W8) | tests |
| M1-8 | The `eps` tool: `init`, `status`, `report`, `add-source`, `commit`, `merge`; `report` is byte-identical to the library's evaluation; `status` exit codes are 0 (clean), 1 (needs attention) and 2 (not a project or bad usage) | CLI tests; the demo |
| M1-9 | §11 verification on this PC: in a OneDrive folder, `link()` and `wx` refuse existing names, and paths over 260 characters work | the probe in the validation document |
| M1-10 | **Registrar check:** the demo's two-machine conflict, run in a OneDrive folder synchronized between two PCs, is reported as `conflicted` and resolved with `eps merge`; also what OneDrive does with a file not downloaded while offline, and any temporary file seen on the other PC | the registrar, using the validation document |
| M1-11 | Work files: `replace()` retries a rename that Windows refuses for a moment (EPERM, EBUSY, EACCES), about 1.5 s, then fails cleanly; other errors are not retried | test with an injected lock |
| M1-12 | A file that cannot be read never stops `eps status` or `eps report`: it is reported as E-UNREADABLE with its error, what depends on it is not evaluable, and the exit code is 1 (R-E10) | tests with injected read and list failures |

**Out of scope for M1:** the browser backend, any SDD change, publication.

## M2: Project folders in the browser (criteria finalized 2026-11-05; for the registrar with the first delivery)

M2-a to M2-e come from SDD's feedback (item 3), because SDD is often run as a **saved copy opened from disk**.
M2-f to M2-j add what M2 needs to deliver its value, as the registrar asked on 2026-11-04. None of them changes
the contract (v0.2): the browser backend is at the **checked** level that R-W9 and §11 already define.

**The second origin.** The repository stays local and unpublished (D10), so "the published page" is stood in for by
the same page served from `http://localhost` by a small Node script in this repository (no dependency, listening
on 127.0.0.1 only). A page opened from `file:` and one from `http://localhost` are different origins, which is what
M2-a, M2-b and M2-d need. Nothing is published; publication stays the registrar's decision under M4.

| AC | Acceptance criterion | Evidence |
|---|---|---|
| M2-a | The folder picker works on a page opened from a `file:` URL, and on the same page served from `http://localhost` (the stand-in for the published page) | the registrar, in Chrome or Edge, using the validation document |
| M2-b | Whether a stored folder handle and its permission survive a browser restart, for both kinds of page, is **measured and documented** (the result is recorded, whatever it is) | the registrar's observation, recorded in the validation document |
| M2-c | When folder access is unavailable (managed browser policy, or a browser without the File System Access API), the page says so plainly, so a tool such as SDD can fall back to opening and saving single files | tests with the API missing or refusing; the registrar's check in a browser without it |
| M2-d | A `file:` page and a `localhost` page writing the same project share no lock (§9). The browser backend is **checked**, not exclusive (R-W9): across origins it **cannot prevent** one page from replacing a name the other created between its check and its `move()`, so M2-d does not claim that a write is never lost. Tests show: (1) two pages committing from the same head leave the stage `conflicted` with two heads (revision names carry the full SHA-256, so they never collide); (2) a forced race on an artifact name is reported (`E-INTEGRITY` or `E-CURRENT-UNRESOLVED`), never silent; (3) whether Chromium's `move()` replaces an existing name or refuses it is measured and documented; (4) the one case R-W9 says cannot be detected, a record replaced by one with identical bytes, is listed as a known limit | tests with the fake (forced race); the registrar, in a real browser, using two pages |
| M2-e | A file that cannot be read in the browser is reported (R-E10) with the browser's error name (for example `NotReadableError`) | tests with injected read failures; the real-browser test page |
| M2-f | **The browser backend** (`src/browser-backend.mjs`), adapted from the File System Access code in `Skreen5hot/mermaid` (CC0) as the README says: guarantee level **checked** (R-W9, §11): check the name is free, write `.eps-tmp-…` with `createWritable()`, close it, `move()` it to the final name, or write the final name directly where `move()` is missing; Web Locks serialize writes from one origin; paths are checked before use; no dependency | code review; tests |
| M2-g | **The same tests as the memory and Node backends**, run in `npm run check` on an in-memory fake of the File System Access API: every example read through the browser backend equals its expected report, and the writer scenarios pass | tests |
| M2-h | **The same tests in a real browser:** a test page runs the conformance and writer tests against a real folder through the real API and shows pass or fail for each, on a `file:` page and on the `localhost` page | the registrar, using the validation document |
| M2-i | **The project page:** a single offline HTML file, with no network access and nothing to install, opens a project folder and shows its state as `eps status` does (each stage, its current artifacts, every diagnostic). It reads only: it never writes to the project. The report it computes is byte-identical to `eps report` for the same folder | tests (the page's evaluation against `eps report`); the registrar, on both kinds of page |
| M2-j | Unchanged behaviour elsewhere: the memory and Node backends, `eps` and the 25 examples pass exactly as before, and nothing in `spec/`, `context/` or `schemas/` changes | `npm run check`; `git diff` |

**Out of scope for M2:** any SDD change (M3, SDD v1.2), packaging, publication (M4), and writing from the project
page (M2-i reads only; writing in the browser is exercised by the backend tests and the test page).
