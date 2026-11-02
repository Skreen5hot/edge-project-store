# edge-project-store: proposal

**Status:** direction approved by the registrar (2026-11-02). Contract v0.1 is a **draft, not frozen**. This
revision answers the registrar's review of the first draft. Nothing is published.

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
3. **Nothing is overwritten.** Artifacts, their records and the stage's revisions are only ever created.
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
| Recursive out-of-date detection, including source membership | Staleness follows inputs recursively (UPSTREAM-OUT-OF-DATE). A normalizer cites the **source collection** with its member hashes, so adding, removing or editing a source file is detected (SOURCE-CHANGED with `added` and `removed`). | EPS R-E4, R-E6; EX-03, EX-04, EX-05 |
| The concurrency claim | Corrected. Rereading before writing only narrows the window on one machine. Across synchronized machines nothing is prevented. Instead, because no file is ever modified and names are content-derived, sync never has to merge a file, and a fork shows up as two heads (**conflicted**), never as a silently lost update. | EPS §9, R-W5; EX-08, EX-14 |
| Recovery from interrupted writes and conflicting revisions | Defined commit order (artifact, record, then revision as the commit point), a table of every interrupted state with its diagnostic and recovery, merge revisions for conflicts, repair revisions for damaged heads, and a refusal to write on damage. | EPS R-W2–R-W4, §10; EX-09–EX-12, EX-15 |
| Integrity vs provenance vs deterministic generation | Separated: integrity and input consistency are **checked**; provenance completeness and deterministic generation are **declared** (`generation`: `received`, `deterministic`, `assisted`); authenticity is not provided. | EPS §12 |
| Actual atomic-write guarantees | Documented per backend (Node: temp file, `fsync`, `link()` as an atomic create-if-absent, with a `rename()` fallback; browser: temp file and `move()`, with a direct-write fallback that relies on Chromium behaviour). Correctness never depends on atomicity, because every file is checked against a hash. Cloud-folder behaviour is to be verified in slice 3. | EPS §11 |
| Normalized schema as the structural source of truth | **Pipeline readiness** requires every artifact after `normalized/` to trace back to exactly one normalized schema. An SDD built straight from a source schema is allowed and recorded honestly, but it is never pipeline-ready, and nothing may mix two normalized schemas. | EPS R-E7; EX-07, EX-17 |

One more rule came out of checking the examples: an artifact may cite an earlier artifact **of its own stage**, for
example the previous SDD that a rerun builds on. That input is history, not a dependency: it is checked for presence
only, so superseding the old SDD does not mark the new one out of date (EPS R-E6; EX-19).

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
| 1 | Contract v0.1 | Contract text, context, JSON Schemas, 19 example projects with expected reports | **draft, for review** |
| 2 | Contract module + memory backend | The pure evaluation and project API, judged against the examples | after review of slice 1 |
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
| D3 | Nothing is overwritten: artifacts, records and revisions are only created; a stage's state is its revision graph. | proposed (replaces the mutable `stage.json` of the first draft) |
| D4 | Work in progress lives in `<stage>/work/` and is never an input. | approved (direction) |
| D5 | `source/` is a shared intake area, exempt from the single-writer rule: any tool may add a file; files are immutable and identified by content hash; membership changes are detected. | **approved with conditions** (EPS R-W7, R-E4) |
| D6 | Session restore brings back proposals, rejections and unsaved acceptances, marked as unsaved; nothing is committed on resume; changed inputs require revalidation. | **revised by the registrar** (SDD-side, §5) |
| D7 | `diagrams/` is owned by the `diagram-exporter` responsibility, which may run inside another tool. | **approved** (EPS §3) |
| D8 | MIT licence; the adapted mermaid code is CC0. | proposed |
| D9 | Same-stage inputs are history only (checked for presence, no staleness or structural-root effect). | proposed (EPS R-E6) |
| D10 | The repository stays local until the revised contract and slice 1 are reviewed. | **registrar** |
