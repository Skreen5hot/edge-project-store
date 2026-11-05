# M2 validation: project folders in the browser

| | |
|---|---|
| **Milestone** | M2 of [`../MILESTONES.md`](../MILESTONES.md) |
| **Delivered in** | The commit that adds this file (`git log -1 -- validation/M2-validation.md` names it). Contract **EPS v0.2**, unchanged |
| **Prepared** | 2026-11-05, on Windows 11 with Node v24.11.1 and Chrome 156, by Claude (an agent) at the registrar's direction |
| **For** | The registrar's validation and sign-off, and the finalized M2 criteria (below) |

## What M2 delivers

Before M2, only Node and command-line tools could use a project folder. After M2:

- **A browser tool can use the same project folders** through [`src/browser-backend.mjs`](../src/browser-backend.mjs),
  over the File System Access API. It is adapted from `Skreen5hot/mermaid` (CC0) and passes the same conformance
  and writer tests as the memory and Node backends. Its write guarantee is **checked**, as the contract already says
  for browsers (R-W9, §11).
- **A single offline page shows any project's state**: [`browser/eps-project.html`](../browser/eps-project.html).
  Open it as a file, choose a project folder, and it shows what `eps status` shows; its report is byte-identical
  to `eps report`. It only reads, needs no network and nothing installed, and remembers the folder for next time.
- **What a tool such as SDD needs** is in place: the folder picker on a page opened as a file, the browser's
  permission across restarts (measured in your run), plain words when folders cannot be opened, and unreadable files
  reported with the browser's error name.

## The delivery

| File | What |
|---|---|
| [`src/browser-backend.mjs`](../src/browser-backend.mjs) | The browser backend, guarantee level *checked* (R-W9, §11) |
| [`src/summary.mjs`](../src/summary.mjs) | The `eps status` text and exit code, moved unchanged from `bin/eps.mjs` so the page shares them |
| [`browser/eps-project.html`](../browser/eps-project.html) | The project page (generated; one file, open it directly) |
| [`browser/eps-browser-tests.html`](../browser/eps-browser-tests.html) | The browser test page, with the 25 examples inside it (generated) |
| [`browser/*.mjs`](../browser/), [`browser/templates/`](../browser/templates/) | The pages' sources: folder access and its messages, the remembered folder, the project view, the tests |
| [`tools/gen-pages.mjs`](../tools/gen-pages.mjs) | Bundles each page into one HTML file; `--check` is part of `npm run check` |
| [`tools/serve-local.mjs`](../tools/serve-local.mjs) | Serves the pages on `http://localhost`, on this computer only: the local stand-in for the published page |
| [`test/browser-backend.test.mjs`](../test/browser-backend.test.mjs), [`test/fake-fsa.mjs`](../test/fake-fsa.mjs) | 23 tests for M2, and an in-memory fake of the File System Access API; [`test/project.test.mjs`](../test/project.test.mjs) now runs its 24 writer tests on both backends |
| [`validation/m2-validate.mjs`](m2-validate.mjs), [`run-m2-validation.cmd`](run-m2-validation.cmd) | The validation assistant (also the demo): one double-click |
| [`../MILESTONES.md`](../MILESTONES.md), this file | The finalized criteria and this validation |

Nothing changed in `spec/`, `context/`, `schemas/` or `examples/`, and no dependency was added. `eps` behaves as
before: its summary code moved to `src/summary.mjs` unchanged, and its tests pass.

## The finalized M2 criteria

As you asked, the finished list comes with this first delivery. M2-a to M2-e are SDD's (feedback item 3), M2-f to
M2-j are added; none changes the contract. They are in [`../MILESTONES.md`](../MILESTONES.md) with their evidence:

| AC | Criterion, in short |
|---|---|
| M2-a | The folder picker works on a page opened as a file, and on the same page from `http://localhost` (the stand-in for the published page: nothing is published, D10) |
| M2-b | Whether a remembered folder and its permission survive a browser restart is measured and documented, for both kinds of page |
| M2-c | When folders cannot be opened (policy, or a browser without the API), the page says so plainly, pointing to single files |
| M2-d | Two origins writing one project share no lock. The backend is *checked*, so a write in the check-to-move window **cannot be prevented**: the tests show a fork is a conflict, a replaced artifact is reported, what `move()` does is measured, and the one undetectable case (a record replaced by identical bytes) is a known limit |
| M2-e | An unreadable file is reported (R-E10) with the browser's error name |
| M2-f | The browser backend, adapted from mermaid, at the checked level |
| M2-g | The same conformance and writer tests as the other backends, in `npm run check` |
| M2-h | The same tests in a real browser, on a file page and on the localhost page |
| M2-i | The project page: one offline HTML file, read-only, showing what `eps status` shows, with a report byte-identical to `eps report` |
| M2-j | Nothing else changes: the other backends, `eps`, the examples and the contract files |

## How to validate

**Double-click [`validation/run-m2-validation.cmd`](run-m2-validation.cmd)** (File Explorer → OneDrive → Documents →
edge-project-store → validation). One PC, Chrome or Edge, about 20 minutes. Keep the window open; if it closes,
double-click again and it continues where it stopped.

The assistant:

1. Runs the automated checks (`npm run check`'s commands) and confirms the contract files are unchanged since v0.2.
2. Makes a new run folder in OneDrive → Documents → `eps-m2-validation`, with two sample projects (copies of EX-08,
   *conflicted*, and EX-02, *clean*) and an empty `test-folder`.
3. Serves the pages on `http://localhost:8642` (this computer only) and opens them in your browser, one at a time,
   saying exactly what to click. You will:
   - open each sample project in the project page, once as a file and once from localhost, and save its report
     (M2-a, M2-i: the assistant compares it with `eps report`, byte for byte);
   - close the browser completely and say what the page shows when it reopens (M2-b);
   - run the browser tests on `test-folder`, as a file and from localhost, and save the results (M2-h, M2-e,
     M2-d's `move()` measurement);
   - with both test pages open, press the ten two-page steps in order (M2-d);
   - look at the page in a separate browser window started without folder access (M2-c).
4. Reads what the pages saved to your Downloads folder, and writes `M2-validation-report.md` in the run folder,
   with every result and its evidence. It opens the report in Notepad.

Nothing is installed, nothing is published, and nothing is sent anywhere: the pages forbid every network request
(their Content-Security-Policy), and the local server answers only this computer.

## Results here (2026-11-05)

What I could check on this PC; the registrar column is for your run.

| AC | Evidence | Result here | Registrar |
|---|---|---|---|
| M2-a | Chrome 156: the project page opened as a file loads, has the folder picker, and can remember a folder; the same page from `http://localhost` likewise. Picking a folder needs a person | loads, picker present; **picking not tried** (needs a person) | |
| M2-b | — | **not measured here** (needs a person and a restart) | |
| M2-c | `M2-c: the page says plainly…` (missing API, insecure page, `SecurityError`, `NotAllowedError`, cancelled); Chrome started with `--disable-blink-features=FileSystemAccessLocal` shows the notice and greys out *Open* | pass; policy-managed Chrome not tried | |
| M2-d | `M2-d (1)` (a fork across origins is `conflicted`, 2 heads); `M2-d (2)` ×3 (in the window, a replacing `move()` is reported as `E-INTEGRITY`, a refusing one loses nothing); `M2-d: across origins…` (the limit: both checks pass, the later move replaces); Chrome, private storage: **`move()` onto an existing name REPLACES it**; the two-page steps in one Chrome page: the fork is conflicted, and the race loses nothing (Web Locks) | pass in the fake and in one origin; **two origins on a picked folder not tried** | |
| M2-e | `M2-e: …` (fake: `NotReadableError` on a file and on a folder); Chrome: a stale `File` gives `NotReadableError`, reported as `E-UNREADABLE … (NotReadableError)`, `sdd unevaluable` | pass | |
| M2-f | the backend tests: interface in three `move()` modes, paths refused never altered, R-W8 stale temporary files, Web Locks in one origin | pass | |
| M2-g | `M2-g` (25 of 25 examples; EX-02 written in every `move()` mode); `test/project.test.mjs`: 24 writer tests `[browser backend]` | pass | |
| M2-h | Chrome 156 on `http://localhost`, the test page's automatic tests in the browser's private storage: 7 of 7 (25 of 25 examples byte for byte, EX-02 written through the real API, 20 same-origin races, no temporary file left). As a file, Chrome gives pages no private storage, so there it needs a picked folder | pass on localhost; **file page on a picked folder not tried** | |
| M2-i | `M2-i` ×5: every example's page view equals `eps status` and its report equals `eps report` byte for byte; the folder is unchanged; the bundled code computes the same reports; no network address in the pages | pass | |
| M2-j | `npm run check`: 4 schemas current, 25 examples / 324 files match, `src/schemas.mjs` current, 2 pages current, **149 of 149 tests**; `git diff 086b470 -- spec context schemas` is empty | pass | |

The assistant itself was tested here with a stand-in for the person (answers and saved files), including stopping
and resuming; that found and fixed one bug (a saved file taken twice when two steps followed quickly).

## Known limits

- **Checked, not exclusive (R-W9).** Across origins, programs or synchronizing clients, a name can be created between
  the backend's check and its `move()`. In Chrome's private storage `move()` replaces an existing file, so that
  write is lost; a lost artifact is **detected** (`E-INTEGRITY`), never silent. A record replaced by one with
  identical bytes is not detectable, and changes nothing. Pages of one origin (tabs of one tool) never race: Web
  Locks serialize them.
- **Two origins remember separately.** A page opened as a file and the same page on `localhost` are different
  origins: each remembers its own folder and permission.
- **Policy-blocked folder access** is shown by the page's words (tested in Node), but was not tried in a real browser
  with a managed policy, which needs a machine-wide setting.
- **Chrome and Edge only.** Firefox and Safari do not have the folder picker; the page says so (M2-c).
- **The project page only reads.** Writing in the browser is exercised by the tests and the two-page steps; a tool's
  own writing UI is SDD's (M3).
- **Flushing to disk** is the browser's: the API offers no `fsync` (§11).

## Sign-off

| | |
|---|---|
| Step 1 (automated checks) | ☐ pass ☐ fail — notes: |
| Step 2 (in the browser) | ☐ pass ☐ fail — notes: |
| M2-b (measured) | after a restart, as a file: … ; from localhost: … |
| M2 criteria (M2-a to M2-j) | ☐ accepted as written ☐ accepted with changes: |
| M2 accepted | ☐ yes ☐ yes, with conditions ☐ no |
| Registrar, date | |
