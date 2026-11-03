# edge-project-store: proposal

**Status:** architecture approved by the registrar. Contract v0.1 is **frozen** (2026-11-03) and slice 2 is
authorized. Nothing is published; publication is a separate decision.

## 1. Problem

A semantic data pipeline runs as several separate tools:

```
sample data ─┐
             ├→ normalized schema → SDD → RML → RDF → graph
source schema┘                       └→ Mermaid diagrams (a derived view of the model)
```

Each tool is offline and runs at the edge (a single HTML page or a command-line tool). Today each saves and reopens
its own files in its own way, so work does not flow from one tool to the next, and every tool would have to rebuild
durable storage, change detection and resumable work by itself.

## 2. The approach

The tools share a **folder contract**, not a server, a database or a common application. The contract is
[`spec/edge-project-contract.md`](spec/edge-project-contract.md). In short:

1. A **project** is a folder the user picks. `edge-project.jsonld` gives it a permanent `urn:uuid:` identity.
2. Each **stage** has a subfolder and one **responsibility** that writes it. `source/` is a shared intake area that
   any tool may add to, and nothing in it is ever changed.
3. **Committed state is never overwritten.** Artifacts, their records and the stage's revisions are only ever
   created. Work in progress (point 6) is the one mutable exception.
4. Each artifact has a **record** naming its exact inputs by path and SHA-256. A stage's state is a chain of
   **revisions**, each naming its parent revisions, much like commits.
5. One pure **evaluation** turns a folder into a report: what is current, what is out of date and why (recursively,
   including changes to the set of source files), what is in conflict, what is damaged, and what is
   **pipeline-ready**.
6. Work in progress lives in `<stage>/work/`, belongs to the stage's responsibility, and is never an input to
   anything.

## 3. Answers to the registrar's review

| Review point | Resolution | Where |
|---|---|---|
| Edge JSON-LD with a versioned local context | All metadata files and the evaluation report are JSON-LD with `@context` = the bundled `eps-v1.jsonld` IRI, never dereferenced; any other context is refused (E-CTX-EXTERNAL); a new context version is a new IRI. JSON Schemas give the shapes. | EPS R-P1; `context/`, `schemas/`; EX-13 |
| Recursive out-of-date detection, including source membership | Staleness follows inputs recursively (UPSTREAM-OUT-OF-DATE). A normalizer cites the **source collection** as `{path, sha256}` member pairs, so adding, removing, renaming or editing a source file is detected (SOURCE-CHANGED with `added` and `removed`). | EPS R-E4, R-E6; EX-03, EX-04, EX-05 |
| The concurrency claim | Corrected. Rereading before writing only narrows the window on one machine. Across synchronized machines nothing is prevented. Instead, no committed file is ever modified, and revision names carry the full SHA-256, so two different revisions never share a name and a fork shows up as two heads (**conflicted**), never as a silently lost update. Artifact names use a short prefix, so two machines can give different artifacts the same name; sync then keeps one and makes a conflict copy, and this is detected (both revisions arrive and conflict) and recoverable, not prevented. | EPS §9, R-B4, R-W5; EX-08, EX-14, EX-25 |
| Recovery from interrupted writes and conflicting revisions | Defined commit order (artifact, record, then revision as the commit point), a table of every interrupted state with its diagnostic and recovery, merge revisions for conflicts, repair revisions for damaged heads, and a refusal to write on damage. | EPS R-W2–R-W4, §10; EX-09–EX-12, EX-15 |
| Integrity vs provenance vs deterministic generation | Separated: integrity and input consistency are **checked**; provenance completeness and deterministic generation are **declared** (`generation`: `received`, `deterministic`, `assisted`); authenticity is not provided. | EPS §12 |
| Actual atomic-write guarantees | Documented per backend, each with a declared guarantee level (R-W9). Node is **exclusive**: temp file, `fsync`, `link()` as an atomic create-if-absent, with an exclusive-create (`wx`) fallback; `rename()` onto a final name is forbidden. The browser is **checked**: check the name, temp file, `move()`, with a direct-write fallback that relies on Chromium behaviour. Correctness never depends on atomicity, because every file is checked against a hash. Cloud-folder behaviour is to be verified in slice 3. | EPS §11 |
| Normalized schema as the structural source of truth | **Pipeline readiness** requires every artifact after `normalized/` to trace back to exactly one normalized schema. An SDD built straight from a source schema is allowed and recorded honestly, but it is never pipeline-ready, and nothing may mix two normalized schemas. | EPS R-E7; EX-07, EX-17 |

### Second review (2026-11-02)

| Review point | Resolution | Where |
|---|---|---|
| D3: committed vs working state | The "never overwritten" guarantee is stated for committed state only (artifacts, records, revisions). `work/` files are mutable and can meet sync conflicts; a tool detects that itself, for example by recording the revision a work file was based on. | EPS §1, §9 |
| D3: filename collisions | Names carry a hash **prefix** of 8, 16, 32 or 64 characters. A writer tries 8 first and extends the prefix whenever the name holds different bytes; it never overwrites. Readers always compare the full SHA-256 in the record. | EPS R-B2–R-B4, R-W1; EX-22 |
| D9: dependency vs history | Every artifact input now declares `relation`: `dependency` (freshness and structural roots follow it) or `history` (provenance: verified for identity and integrity, no effect on freshness or roots). Nothing is implied by the input's stage. A same-stage dependency is exempt only from "superseded", because the artifact that uses it normally supersedes it; its own staleness still propagates. | EPS R-P4, R-E6, R-E7, R-E9; EX-19, EX-20, EX-21 |
| Relative paths: safety | The schema accepts any string. The contract then defines a **safe path** (stage-rooted, `/`-separated, restricted characters, no `.`/`..`, no drive letters, backslashes, trailing dots or Windows device names, exact case) and refuses others with E-PATH-UNSAFE **before** the work-folder rule and before any file is opened. Readers never follow links or junctions. | EPS R-B6, R-P4.8–9, R-E2; EX-16, EX-23 |
| Source members lose file identity | Collection members are `{path, sha256}` pairs, compared as pairs, so a rename registers as well as additions, removals and edits. | EPS R-P4, R-E6; EX-03–EX-05 |
| Canonical serialization | R-B1 now states the full form (key order from the schemas, layout, string escaping, numbers) so a writer in any language can reproduce it. Readers never re-serialize; identity is the hash of the bytes. | EPS R-B1 |

### Independent contract review (2026-11-02)

The registrar's independent evaluator agreed with all 23 expected reports. The review found contradictions and
untested cases outside them, resolved as follows:

| Finding | Resolution | Where |
|---|---|---|
| 1. Source deletion contradicted append-only | Conforming writers never delete, rename or modify any committed file, source included, and uncommitted ones neither (they may be another writer's commit in progress). People can still change their own folders; that is an **external mutation** the evaluation reports. No retirement operation exists in v0.1. Recovery is by retrying, never by deleting. | EPS R-W1, R-W7, R-W10, §10, §14; EX-04, EX-05, EX-11 |
| 2. Fallback writes could overwrite | Two declared **guarantee levels**: *exclusive* (atomic create-if-absent; nothing is overwritten) and *checked* (check, then create; a racing program can be overwritten, and this is stated with what is and is not detected). A writer must use exclusive wherever available and never `rename()` onto a name that may exist. Node is exclusive in both its paths (`link()`, else `open(…, 'wx')`); the browser API has no exclusive create, so it is checked. | EPS R-W9, §11 |
| 3. 8-character prefixes vs the cross-machine claim | Revision names now carry the **full** SHA-256, so two different revisions can never share a name and sync can never hide a branch. Artifact names keep the short prefix; a cross-machine artifact collision is detected (both full-hash revisions arrive and conflict; the copy is reported), and the recovery is defined. EX-25 uses a real 8-character collision. | EPS R-B3, R-B4, §9, §10; EX-25 |
| 4. R-W6 vs the work-folder exclusion | R-W6 now requires disclosure of every **committed** project artifact that materially contributed. What a tool takes from `work/` becomes part of the artifact's own content, like a person's decisions. | EPS R-W6, R-P6 |
| 5. Cycles were untested and order-dependent | Cycles are defined on the dependency graph (mutual reachability), not on a traversal: inputs on a common cycle get `CYCLE`, artifacts outside it that depend on it get `UPSTREAM-OUT-OF-DATE`, and structural roots visit each artifact once. | EPS R-E6, R-E7; EX-24 |
| Same bytes, different provenance | An identical artifact is reused only if its record is also byte-identical; otherwise the writer takes a later `createdAt`, giving a new name and its own record. | EPS R-W1 |
| Negative `bytes` | `minimum: 0` in the record schema. | `schemas/artifact-record-v1.schema.json` |
| Rule references | The work-folder rule is R-P4.9 everywhere. | EPS R-P6; examples index |
| D11 terminology | `pipelineReady` is defined as structural readiness for downstream processing only, not completeness of provenance, verified history or authenticity. | EPS R-E7 |

### Final confirmation review (2026-11-03)

The registrar independently verified EX-24 and EX-25 and checked all 25 reports for consistency (88 reported
artifacts, 50 revision heads, no discrepancies). Architecture, D13–D15 and the slice 1 fixtures were approved, and
the contract approved for freezing after three wording corrections, which do not change any expected report:

| Correction | Resolution | Where |
|---|---|---|
| 1. Outdated descriptions in this proposal | The first review's table now describes `{path, sha256}` source members, the artifact-name collision across machines (EX-25) and the Node `wx` fallback in place of `rename()`. | §3 above |
| 2. Damaged-record retry | A record's name follows from its artifact's, so a new record needs the artifact written again under a later `createdAt`; the damaged files stay untouched. When all four prefixes at one time are taken (for example by a partial artifact under the 64-character name), the writer takes a later `createdAt`; E-NAME-TAKEN is left for a writer whose time is fixed. | EPS R-W1, §10 |
| 3. Writer conformance | A writer conforms when no commit it completes introduces an evaluation error; interrupted operations are covered by §10, and external mutations by R-W10. | EPS conformance |

### Slice 2: readings of the frozen text (2026-11-03)

Implementing §7 and §8 needed a reading of a few places the frozen text leaves open. None changes an expected
report, and each is implemented as stated here and covered by a unit test. The registrar **approved S1–S8** as valid
interpretations of the frozen v0.1 contract; no contract change was needed.

| # | Where | Reading implemented |
|---|---|---|
| S1 | R-E5.1 "whose sha256" | The hash an unparseable revision's **name** carries (R-B4), since that is what parents cite; the hash of a truncated file's bytes is never cited. So a cited but unparseable revision is E-REVISION-INVALID (damaged), and its citer also gets E-MISSING-PARENT. |
| S2 | R-P1, R-P3, R-E1 | A missing `@context` or `contractVersion` is a schema failure (E-RECORD-INVALID, E-PROJECT-INVALID, E-REVISION-INVALID), not E-CTX-EXTERNAL or E-UNSUPPORTED-VERSION, which need a value that differs. |
| S3 | R-P4.1 "parses as JSON" | Strict UTF-8: a byte-order mark or invalid UTF-8 fails to parse. |
| S4 | R-P4.10, R-P5 "sorted" | Read literally: inputs and a revision's `current` may repeat a key (non-decreasing order); `parents` and `members` are strictly increasing, as their rules say "without duplicates". |
| S5 | R-E6 UPSTREAM-UNSETTLED | Applies to same-stage dependencies too: an artifact depending on another in a stage with no revision yet (`empty`) is unsettled. Uncommitted chains and self-citations therefore also carry UPSTREAM-UNSETTLED. |
| S6 | §2, R-E2 | A regular **file** at the root named like a stage is ignored (§2: other root entries are ignored); only a link or special entry there is W-FOREIGN-FILE. A `work` entry that is a file, not a folder, is W-FOREIGN-FILE. |
| S7 | R-E5.5 | E-CURRENT-UNRESOLVED is checked whenever there is exactly one head, also in a stage that is incomplete. |
| S8 | R-W4 | "Damaged because of E-REVISION-INVALID" includes the other first-failure codes of an invalid revision (E-CTX-EXTERNAL, E-FOREIGN-PROJECT, E-WRONG-RESPONSIBILITY): only damage from E-CURRENT-UNRESOLVED alone allows a repair revision. |

The project API also has refusals of its own that the contract does not name (for example `STAGE-CHANGED` for
R-W5, `NOT-RESPONSIBLE` for a stage the tool does not host); they are writer errors, never evaluation
diagnostics, and they carry no `E-` prefix except the contract's E-NAME-TAKEN.

The registrar's implementation review asked for two corrections, both made with regression tests that fail on the
earlier code:

| Correction | Resolution |
|---|---|
| R-W5: a revision appearing between the evaluation and the snapshot of revision names escaped detection | `commit()` and `merge()` take the revision names **before** evaluating, so any revision that appears afterwards stops the write with STAGE-CHANGED |
| R-W1: an artifact with matching bytes whose record name held a folder or another non-file looped forever | Such a record name is unusable, so the writer takes a later `createdAt` (R-W1, same bytes with a different record), and each candidate name is retried at most four times; nothing is overwritten |

## 4. The module (slices 2 and 3)

| Layer | Contents | I/O |
|---|---|---|
| **Contract** (pure) | Parse and validate the three metadata files; artifact naming; the evaluation (EPS §7); canonical JSON and hashing | none |
| **Backends** | One small interface (`list`, `readBytes`, `writeBytes` that only creates, `mkdir`) with three implementations: **browser** (File System Access, adapted from mermaid), **Node** (`node:fs`) and **memory** (tests) | yes |
| **Project API** | `openProject`, `evaluate`, `addSource`, and per stage `commit(artifacts)` (creates artifacts, records, then the revision), `merge(heads, chosen)`, `work.read` and `work.write` | through a backend |
| **Browser session** | Pick a project folder, remember its handle in IndexedDB by project id, reconnect after a restart, permission events | browser only |

The module has no user interface; each tool draws its own. It is one dependency-free ES module that each tool
**vendors** at a pinned commit and SHA-256 and bundles into its own build, so single-file pages stay self-contained.

**Adapted from mermaid:** atomic writes, Web Locks, the sanitization rules and their test cases, the permission
lifecycle, handle persistence and the in-memory file-system fake. **Left out:** browser-only storage of the work
itself, the single shared app folder, dialogs, mermaid's identifiers and the audit log (records and revisions cover
lineage).

## 5. How the SDD tool would use it (proposed separately in the SDD repository)

- **Open project folder:** the tool reads the current normalized schema. If there is none yet, it may work from a
  schema in `source/`, and its SDD is then recorded honestly as not pipeline-ready (EX-07).
- **Save SDD:** a new SDD file, its record and a new `sdd/` revision. As today, an SDD is never overwritten.
- **Resume from `sdd/work/`** (decision D6, revised by the registrar):
  - restored: the LLM's proposals, the pasted replies with their check results, rejections, and **acceptances
    made but not yet saved**;
  - restored acceptances are shown as *accepted earlier, not saved*, distinct from mappings in the saved SDD, and
    nothing is committed automatically on resume: a restored acceptance enters an SDD only when the person saves
    again;
  - when the structural input (the normalized schema, or the source schema it stands in for), the term list or an
    item has changed since the session was saved, the affected proposals and decisions must be revalidated before
    they can be accepted or saved;
  - the session records the stage revision it was based on, so a session from another machine or an older state is
    recognized rather than trusted.
- **Reopen:** an accepted mapping can be reopened and sent to the LLM again. Its old mapping is kept until a new one
  is accepted or the item is rejected.
- **Manual mode stays:** opening files and saving downloads keeps working wherever folder access is unavailable.

The SDD file format does not change. The exact operator rules (for example, who may confirm a restored acceptance
and which time it records) are settled in the SDD tool's own proposal.

## 6. Slices

| # | Slice | Delivers | Status |
|---|---|---|---|
| 1 | Contract v0.1 | Contract text, context, JSON Schemas, 25 example projects with expected reports | **frozen** (2026-11-03) |
| 2 | Contract module + memory backend | The pure evaluation and project API. The 25 expected reports are its conformance tests, and independent unit tests cover operations and edge cases the fixtures do not; passing the examples is not taken as exhaustive correctness | **implemented**; readings S1–S8 approved; awaiting the registrar's final confirmation |
| 3 | Node and browser backends | `node:fs` and File System Access backends, browser session handling, cloud-folder verification (§11) | |
| 4 | SDD project mode (SDD v1.1) | The SDD tool vendors the module: project folder, resume, Reopen; CLI `--project <dir>` | |
| later | Other stages | Normalizer, RML generator, RDF, graph loader and diagram exporter adopt the module as they are built | |

## 7. Non-goals

Synchronising, merging or locking across machines (file sync is the user's choice; the contract detects and reports);
a server, an account or any network request; storing artifacts in browser storage; signing or chaining artifacts;
renaming a project (v0.1).

## 8. Decisions

| # | Decision | Status |
|---|---|---|
| D1 | The project folder is the integration contract; tools share no runtime. | approved (direction) |
| D2 | One responsibility writes each stage folder; any tool may read every folder. | approved (direction) |
| D3 | Committed state is never overwritten: artifacts, records and revisions are only created; a stage's state is its revision graph; names extend their hash prefix on collision. | **approved** (second review), with the two qualifications applied |
| D4 | Work in progress lives in `<stage>/work/` and is never an input. | approved (direction) |
| D5 | `source/` is a shared intake area, exempt from the single-writer rule: any tool may add a file; files are immutable and identified by content hash; membership changes are detected. | **approved with conditions** (EPS R-W7, R-E4) |
| D6 | Session restore brings back proposals, rejections and unsaved acceptances, marked as unsaved; nothing is committed on resume; changed inputs require revalidation. | **revised by the registrar** (SDD-side, §5) |
| D7 | `diagrams/` is owned by the `diagram-exporter` responsibility, which may run inside another tool. | **approved** (EPS §3) |
| D8 | MIT licence; the adapted mermaid code is CC0. | proposed |
| D9 | Every input declares `dependency` or `history`; history is verified for identity and integrity but does not affect freshness or structural roots; same-stage inputs are not automatically history; a same-stage dependency is exempt only from "superseded". | **approved** (independent review) |
| D10 | The repository stays local and unpublished until a separate publication decision. | **registrar** |
| D11 | Unverified history (`historyVerified: false`) is reported but does not block `pipelineReady`, which means structural readiness only. | **approved** (independent review) |
| D12 | Input paths: the schema accepts any string; the contract's safe-path rule refuses unsafe ones (E-PATH-UNSAFE) before the work-folder rule. | **approved with constraints** (second review), constraints applied |
| D13 | Writers never delete or modify committed files; people's changes are external mutations that the evaluation reports; no retirement operation in v0.1. | **approved** (final review) |
| D14 | Backends declare a write guarantee level, *exclusive* or *checked*; exclusive is mandatory where available. | **approved** (final review) |
| D15 | Revision names carry the full SHA-256; artifact names keep the short prefix, with cross-machine collisions detected and recoverable. | **approved** (final review) |
