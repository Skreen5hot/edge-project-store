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
| [`test/browser-backend.test.mjs`](../test/browser-backend.test.mjs), [`test/fake-fsa.mjs`](../test/fake-fsa.mjs) | 30 tests for M2, and an in-memory fake of the File System Access API; [`test/project.test.mjs`](../test/project.test.mjs) now runs its 24 writer tests on both backends |
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

## The registrar's first run, and what changed (2026-11-05)

Run `run-20261105-123113` on commit `01bf20c`, Chrome 156: everything passed except **M2-h conformance**, on both
pages, with `NotFoundError`. The cause is **path length on Windows**, not the evaluation: the test copied each example
deep inside the test folder, and EX-02's revision file landed at a 255-character path. Chrome created it empty, then
failed to write it, because Chrome writes through a temporary `<file>.crswap` beside the file and that path (262
characters) is over Windows' 260. The same examples all read correctly at shorter paths.

Agreed with the registrar and done since:

1. **The test page** copies the examples to short paths (`e/02`, …), so conformance tests reading; a failed copy now
   names the file and its depth. A new measured test finds **the longest path the browser can write** in the test
   folder, written directly and through the EPS backend; the assistant turns it into full paths and the deepest
   project folder that works on this PC.
2. **The browser backend** reports a file or folder that is listed but cannot be opened (what Chrome does for a path
   that is too long) as `E-UNREADABLE` with `NotFoundError`, never as missing; the project page then explains that the
   folder is probably too deep. A regression test fails on the earlier code.

The other results of that run: the project page's reports were byte-identical to `eps report` as a file and from
localhost (M2-a, M2-i); after a restart Chrome kept the folder **and** its permission, `granted`, on both kinds of
page (M2-b); without folder access the page said so (M2-c); unreadable files were `NotReadableError` (M2-e); on a real
folder `move()` **replaced** an existing file, and in the two-page race the replaced SDD was **reported**
(`E-INTEGRITY`, `E-CURRENT-UNRESOLVED`); the two-origin fork was `conflicted`, 2 heads (M2-d).

## The registrar's second run, and what changed (2026-11-06)

Run `run-20261105-161028` on commit `952df69`: the path-length measurement worked (Chrome wrote full paths up to 252
characters directly and 259 through the EPS backend; with a 113-character revision path, a project folder up to
**145 characters** deep works on this PC). Two new failures, neither in the evaluation:

1. **Conformance** stopped with `InvalidStateError` on a newly created file, left empty, at a different example on
   each page (EX-04, EX-09): the file changed on disk between its creation and the end of Chrome's write, most likely
   OneDrive picking the new file up to synchronize it (the test folder is in OneDrive). Each file Chrome wrote there
   took **about 5–7 seconds**.
2. **The two-page test** could not pass step 2 (`input path undefined`): step 1 was still writing its project (30–40
   seconds in OneDrive) and the page did not show it was busy.

A message in Chrome's developer tools about `/.well-known/appspecific/com.chrome.devtools.json` was Chrome's own
request, blocked by the pages' policy against any network access: harmless, and not from EPS.

Agreed with the registrar and done since:

1. **The browser backend retries an interrupted write** (`InvalidStateError`, `NoModificationAllowedError`) with a
   fresh temporary file, 50 ms doubling, about 1.5 s in all, like the Node backend's retry (M1-11); no final name is
   touched before the move, so a retry cannot replace anything. `replace()` retries the same way. Regression tests
   fail on the earlier code. The test page's own copying retries the same way, and the conformance and writer tests
   now report how many writes were retried and how long each took.
2. **The two-page steps** show "Working…" and wait for each other; steps 2, 3, 7 and 8 say plainly when the other
   page's project is not finished yet, instead of failing.

## The registrar's third run: accepted (2026-11-06)

Run `run-20261106-201535` on commit `2772f47`, LittleMan, Node v24.11.1, Chrome 156, no uncommitted changes; its
report and evidence stay in the run folder in OneDrive, outside the repository. Every step gave the expected result:

- **M2-a, M2-i:** the project page's report was byte-identical to `eps report`, as a file on `projects/conflicted`
  (`729fdee6…`) and from `localhost` on `projects/clean` (`6f6c905c…`).
- **M2-b:** after closing the browser, the stored folder and its permission were kept, **granted**, on both pages.
- **M2-c:** with folder access disabled, the plain notice, *Open* greyed out.
- **M2-h, on a picked folder in OneDrive, on both pages:** 8 of 8. Conformance 25 of 25; copying the examples took 298
  writes, about 0.45–0.5 s each (slowest 2.5 s); on the file page **4 interrupted writes were retried** and the test
  passed (the second run's failure). The EPS backend wrote EX-02 at about 0.8 s per file, none retried. Path length as
  in the second run: project folders up to **145 characters** on this PC.
- **M2-d, two origins on one picked folder:** the fork left `sdd` conflicted, 2 heads, `E-STAGE-CONFLICT`; in the
  check-to-move window, `move()` replaced page 1's SDD, and the loss was **reported** (`E-INTEGRITY`,
  `E-CURRENT-UNRESOLVED`), never silent: the checked level's limit, as R-W9 says.
- **M2-e:** `NotReadableError` reported as `E-UNREADABLE … (NotReadableError)`, `sdd unevaluable`, on both pages.
- **M2-f, M2-g, M2-j:** step 1, 156 of 156 tests; `spec/`, `context/`, `schemas/` unchanged since v0.2.
- No temporary file was left by the backend (the only `.eps-tmp-*` files are EX-10's own, in the copied examples).

## Results here (2026-11-05)

What I could check on this PC; the registrar column is for your run.

| AC | Evidence | Result here | Registrar |
|---|---|---|---|
| M2-a | Chrome 156: the project page opened as a file loads, has the folder picker, and can remember a folder; the same page from `http://localhost` likewise. Picking a folder needs a person | loads, picker present; **picking not tried** (needs a person) | pass (run `run-20261106-201535`): picked a folder on both pages |
| M2-b | — | **not measured here** (needs a person and a restart) | measured (run `run-20261106-201535`): kept, granted, on both pages |
| M2-c | `M2-c: the page says plainly…` (missing API, insecure page, `SecurityError`, `NotAllowedError`, cancelled); Chrome started with `--disable-blink-features=FileSystemAccessLocal` shows the notice and greys out *Open* | pass; policy-managed Chrome not tried | pass (run `run-20261106-201535`): notice shown, *Open* greyed out |
| M2-d | `M2-d (1)` (a fork across origins is `conflicted`, 2 heads); `M2-d (2)` ×3 (in the window, a replacing `move()` is reported as `E-INTEGRITY`, a refusing one loses nothing); `M2-d: across origins…` (the limit: both checks pass, the later move replaces); Chrome, private storage: **`move()` onto an existing name REPLACES it**; the two-page steps in one Chrome page: the fork is conflicted, and the race loses nothing (Web Locks) | pass in the fake and in one origin; **two origins on a picked folder not tried** | pass (run `run-20261106-201535`): two origins on a picked folder, fork conflicted and the replaced SDD reported |
| M2-e | `M2-e: …` (fake: `NotReadableError` on a file and on a folder; a listed file or folder that cannot be opened is `E-UNREADABLE (NotFoundError)`, never missing); Chrome: a stale `File` gives `NotReadableError`, reported as `E-UNREADABLE … (NotReadableError)`, `sdd unevaluable` | pass | pass (run `run-20261106-201535`), both pages |
| M2-f | the backend tests: interface in three `move()` modes, paths refused never altered, R-W8 stale temporary files, Web Locks in one origin | pass | pass (run `run-20261106-201535`), step 1 |
| M2-g | `M2-g` (25 of 25 examples; EX-02 written in every `move()` mode); `test/project.test.mjs`: 24 writer tests `[browser backend]` | pass | pass (run `run-20261106-201535`), step 1 |
| M2-h | Chrome 156 on `http://localhost`, the test page's automatic tests in the browser's private storage: 8 of 8 (the path-length measurement finds no limit there, over 950 characters; 298 copies at 15 ms each, none retried; 25 of 25 examples byte for byte, EX-02 written through the real API, 20 same-origin races, no temporary file left). As a file, Chrome gives pages no private storage, so there it needs a picked folder | pass on localhost; **file page on a picked folder not tried** | pass (run `run-20261106-201535`): 8 of 8 on both pages, on a picked folder in OneDrive |
| M2-i | `M2-i` ×5: every example's page view equals `eps status` and its report equals `eps report` byte for byte; the folder is unchanged; the bundled code computes the same reports; no network address in the pages | pass | pass (run `run-20261106-201535`): byte-identical to `eps report` on both pages |
| M2-j | `npm run check`: 4 schemas current, 25 examples / 324 files match, `src/schemas.mjs` current, 2 pages current, **156 of 156 tests**; `git diff 086b470 -- spec context schemas` is empty | pass | pass (run `run-20261106-201535`), step 1 |

The assistant itself was tested here with a stand-in for the person (answers and saved files), including stopping
and resuming; that found and fixed one bug (a saved file taken twice when two steps followed quickly).

## Known limits

- **Writing in a OneDrive folder from Chrome is slow** (about 5–7 seconds per file in the registrar's second run,
  about 0.5–0.9 s in the third, slowest 2.5 s) and can be interrupted for a moment (retried, as above: 4 of 298 writes
  in the third run). A commit writes three files or more, so a browser tool saving into OneDrive should show that it
  is working.

- **Path length in the browser on Windows.** Chrome cannot write a file whose full path is over about 252 characters
  directly, or, through the EPS backend's temporary file and `move()`, a little more (259 characters on the registrar's PC). A revision
  path inside a project is 113 characters, so **a project folder's own path must stay under about 140 characters** for
  browser tools; Node (`eps`) has no such limit (387 characters in M1). A file the browser lists but cannot open is
  reported as `E-UNREADABLE (NotFoundError)`, and the project page says the folder is probably too deep. The contract
  says nothing about full paths on disk: a proposal is the registrar's decision.

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
| Step 1 (automated checks) | ☒ pass ☐ fail — notes: 156 of 156 tests; schemas, examples, `src/schemas.mjs` and the pages current; `spec/`, `context/`, `schemas/` unchanged since v0.2 |
| Step 2 (in the browser) | ☒ pass ☐ fail — notes: run `run-20261106-201535` with the validation assistant (`validation/m2-validate.mjs`) on commit `2772f47`, LittleMan, Node v24.11.1, Chrome 156; every step gave the expected result (above). Earlier runs `run-20261105-…` found the path-length and OneDrive-write failures fixed in `952df69` and `2772f47` |
| M2-b (measured) | folder access kept and permission still granted after a browser restart, on the file page and the localhost page (Chrome 156) |
| M2 criteria (M2-a to M2-j) | ☒ accepted as written ☐ accepted with changes: |
| M2 accepted | ☒ yes ☐ yes, with conditions ☐ no |
| Registrar, date | Aaron Damiano, 2026-11-06 |
