# Edge project contract (EPS)

| | |
|---|---|
| **Status** | v0.1 **draft**, not frozen (2026-11-02). Slice 1 of [`../PROPOSAL.md`](../PROPOSAL.md). |
| **Registrar** | Aaron Damiano. |
| **Normative language** | BCP 14 keywords (MUST, MUST NOT, SHOULD, MAY) per RFC 2119 / RFC 8174, uppercase only. |
| **Identifiers** | Rules R-B\* (bytes and names), R-P\* (project files), R-E\* (evaluation), R-W\* (writers); diagnostics E-\* (errors) and W-\* (warnings); examples EX-\*. Minted, never renumbered. |
| **Conformance** | A **reader** conforms when its evaluation (§7) of every example under [`../examples/`](../examples/) equals that example's `expected.jsonld` byte for byte. A **writer** conforms when it follows §8 and every project it writes evaluates without errors. |

**What this is, in one paragraph.** A pipeline of offline tools (source schema or sample data → normalized schema
→ Semantic Data Dictionary → RML → RDF → graph, with Mermaid diagrams as a derived view) shares work through one
folder the user picks. This contract fixes that folder's layout and its three kinds of metadata file, and defines
one pure evaluation that any tool can run to learn, from the files alone: which artifacts are current, which are out
of date and why, whether anything is damaged or in conflict, and which artifacts are ready for the next stage of the
pipeline. Nothing here needs a server, a database, a lock service or a network.

---

## 1. Principles

1. **The folder is the contract.** Tools share files, never a runtime.
2. **Nothing is overwritten.** Every contract file and every artifact is created once and never modified or
   replaced (R-W1). The only mutable files are a tool's own work in progress (§6).
3. **Edge JSON-LD.** Metadata files are JSON-LD with one fixed, versioned, local context, never fetched (R-P1).
4. **Pure evaluation.** Everything in §7 is a function of the folder's bytes: no clock, no network, no randomness.
5. **Honest guarantees.** The contract detects conflicts and damage; it does not claim to prevent them (§9, §10).

## 2. Layout

```
<project folder>/
  edge-project.jsonld                         R-P2
  <stage>/                                    one folder per stage in the registry (§3)
    <kind>-<YYYYMMDDTHHMMSSZ>-<sha8>.<ext>    artifact (R-B3)
    <artifact file name>.record.jsonld        artifact record (R-P4)
    revisions/rev-<YYYYMMDDTHHMMSSZ>-<sha8>.jsonld   stage revision (R-P5), not in source/
    work/                                     owning tool's work in progress (§6)
```

A stage folder that does not exist is an empty stage. Folders and files at the project root other than
`edge-project.jsonld` and the registry's stage folders are ignored without a diagnostic, so later contract versions
can add stages and users can keep their own notes beside the project.

## 3. Stage registry (v0.1)

| Stage (folder) | Responsibility (single writer) | Structural root required for pipeline readiness (R-E7) |
|---|---|---|
| `source` | `intake`: **shared**, any tool (R-W7) | not applicable |
| `normalized` | `normalizer` | not applicable (it is the structural root) |
| `sdd` | `sdd-author` | yes |
| `rml` | `rml-generator` | yes |
| `rdf` | `rdf-generator` | yes |
| `graph` | `graph-loader` | yes |
| `diagrams` | `diagram-exporter` | yes |

A **responsibility** is a role, not a program: one tool MAY host several responsibilities (for example, an SDD tool
that also exports diagrams writes `diagrams/` as `diagram-exporter`). Every record and revision names its
responsibility, the tool and the tool version (R-P4, R-P5).

## 4. Bytes and names

- **R-B1: Canonical metadata bytes.** Metadata files (R-P2, R-P4, R-P5) and reports (§7) are serialized as
  `JSON.stringify(value, null, 2)` + `"\n"`: UTF-8 without a BOM, LF line ends, keys in the order of their JSON
  Schema's `required` list. Artifacts are opaque bytes; this contract never parses them.
- **R-B2: Hashes.** `sha256` is the SHA-256 of a file's exact bytes, as 64 lowercase hex characters. `sha8` is its
  first 8 characters.
- **R-B3: Artifact names.** An artifact's file name is `<kind>-<time>-<sha8>.<ext>`, where `kind` matches
  `[a-z0-9][a-z0-9-]{0,39}`, `time` is its record's `createdAt` as `YYYYMMDDTHHMMSSZ` (UTC), `sha8` is the
  artifact's own, and `ext` matches `[a-z0-9]{1,10}`. Every character is portable across Windows, macOS, Linux,
  OneDrive and git, and two different artifacts can share a name only if they were created in the same second and
  their SHA-256 values share 8 hex characters.
- **R-B4: Revision names.** `rev-<time>-<sha8>.jsonld`, where `time` is the revision's `createdAt` and `sha8` is the
  revision file's own hash.
- **R-B5: Temporary names.** Writers name temporary files `.eps-tmp-<anything>`, in the folder of the final file.
- **R-B6: Paths.** Paths in metadata are relative to the project folder, use `/`, and never contain `.` or `..`
  segments.

## 5. Project files

- **R-P1: Context.** Every metadata file has `"@context":
  "https://skreen5hot.github.io/edge-project-store/context/eps-v1.jsonld"`, exactly that string. Readers resolve it
  from their bundled copy of [`../context/eps-v1.jsonld`](../context/eps-v1.jsonld) and MUST NOT dereference it. Any
  other `@context` makes the file invalid with **E-CTX-EXTERNAL**. A new context version is a new IRI.
- **R-P2: `edge-project.jsonld`.** Shape:
  [`../schemas/edge-project-v1.schema.json`](../schemas/edge-project-v1.schema.json). `@id` is the project's
  identity, a `urn:uuid:` IRI created once; `name` is a label. The file is never modified (R-W1); renaming a project
  is out of scope in v0.1. A folder without this file is not a project (**E-NOT-A-PROJECT**).
- **R-P3: Contract version.** Every metadata file carries `contractVersion: 1`. A file with any other value is
  invalid; for `edge-project.jsonld` the diagnostic is **E-UNSUPPORTED-VERSION**.
- **R-P4: Artifact records.** Each artifact has one record, `<artifact file name>.record.jsonld`, beside it. Shape:
  [`../schemas/artifact-record-v1.schema.json`](../schemas/artifact-record-v1.schema.json). A record is valid only
  if, in this order (the first failure is the one reported):
  1. it parses as JSON (else **E-RECORD-INVALID**);
  2. R-P1 holds (else **E-CTX-EXTERNAL**);
  3. it matches its schema, including `contractVersion` (else **E-RECORD-INVALID**);
  4. `project` equals the project's `@id` (else **E-FOREIGN-PROJECT**);
  5. `stage` is the folder it lies in, `path` is its artifact's path, `kind` and `createdAt` agree with the
     artifact's name (R-B3), and `sha256` begins with the name's `sha8` (else **E-RECORD-INVALID**);
  6. `producedBy.responsibility` is the stage's responsibility (§3) (else **E-WRONG-RESPONSIBILITY**);
  7. in `source/`: `generation` is `received` and `inputs` is empty; elsewhere: `generation` is `deterministic` or
     `assisted` (else **E-RECORD-INVALID**);
  8. no input `path` lies in any stage's `work/` folder (else **E-WORK-INPUT**);
  9. `inputs` is sorted by `role`, then by `path` (collection inputs sort with `path` = `source`), and every
     `members` list is sorted ascending and has no duplicates (else **E-RECORD-INVALID**).
- **R-P5: Stage revisions.** A stage's state is a set of revision files in `<stage>/revisions/`, never one mutable
  file. Shape: [`../schemas/stage-revision-v1.schema.json`](../schemas/stage-revision-v1.schema.json). A revision's
  identity is its own `sha256`. `parents` lists the identities of the revisions it follows, sorted ascending; `[]`
  for a stage's first revision. `current` lists the artifacts this revision makes current. A revision is
  **well-formed** if, in this order: it parses as JSON; R-P1 holds; it matches its schema; `project` matches;
  `stage` is its folder; its name agrees with its `createdAt` and its own `sha8` (R-B4); `parents` is sorted
  ascending without duplicates; every `current` entry lies in the revision's own stage and the entries are sorted by
  `path`; and `producedBy.responsibility` is the stage's. `source/` has no revisions.

## 6. Work in progress

- **R-P6:** `<stage>/work/` belongs to the stage's responsibility. Its contents are tool-defined, mutable, not
  covered by this contract and never evaluated. No record may cite a file in any `work/` folder as an input
  (R-P4.8). Deleting `work/` loses unfinished work only, never an artifact.

## 7. Evaluation

The evaluation reads a project folder and produces a **ProjectReport**
([`../schemas/project-report-v1.schema.json`](../schemas/project-report-v1.schema.json), canonical per R-B1). It is
pure: identical folders give identical reports.

- **R-E1: Project.** If `edge-project.jsonld` is missing, unparseable, has a foreign context, an unsupported version
  or fails its schema, the report has `valid: false`, `project: null`, `stages: {}`, `artifacts: []`, and exactly one
  diagnostic (E-NOT-A-PROJECT, E-PROJECT-INVALID, E-CTX-EXTERNAL or E-UNSUPPORTED-VERSION, path
  `edge-project.jsonld`), and evaluation stops.

- **R-E2: Classifying stage-folder files.** In each stage folder, directly (not recursively, except `revisions/`):
  - a name starting with `.eps-tmp-` → **W-TEMP-FILE**, otherwise ignored;
  - any other name starting with `.` → ignored without a diagnostic;
  - `work/` → ignored without a diagnostic;
  - a name matching R-B3 → an artifact file;
  - a name equal to an artifact file name plus `.record.jsonld` → that artifact's record; a record whose artifact
    file is absent → **W-ORPHAN-RECORD**;
  - in `revisions/` (not in `source/`), a name matching R-B4 → a revision file;
  - anything else, including sync-conflict copies such as `rev-…-DESKTOP-1.jsonld` → **W-FOREIGN-FILE**, ignored.

- **R-E3: Registered artifacts.** An artifact is **registered** when its record is valid (R-P4) and the artifact's
  bytes have the record's `sha256` and `bytes`. An artifact file without a record → **W-UNREGISTERED**. A valid
  record whose artifact's bytes differ → **E-INTEGRITY** (path: the artifact). An invalid record → its code from
  R-P4 (path: the record). Only registered artifacts appear in the report's `artifacts`.

- **R-E4: Source membership.** The members of `source/` are its registered artifacts. The source stage's `status`
  is `ok` with at least one member and `empty` otherwise; its `heads` is `[]` and its `current` is the member paths.
  Any registered artifact in `source/` is `inStageCurrent: true`.

- **R-E5: Revision graph, heads and stage status** (every stage except `source`):
  1. A revision file that does not parse as JSON and whose `sha256` no well-formed revision cites as a parent is an
     **interrupted commit**: **W-INTERRUPTED-REVISION**, ignored.
  2. Any other revision file that is not well-formed → **E-REVISION-INVALID** (or E-CTX-EXTERNAL,
     E-FOREIGN-PROJECT or E-WRONG-RESPONSIBILITY when that is the first failure), and the stage is **damaged**.
  3. A well-formed revision citing a parent that is not the `sha256` of a well-formed revision file in the same
     folder → **E-MISSING-PARENT** (path: the citing revision), and the stage is **incomplete**.
  4. **Heads** are the well-formed revisions that no well-formed revision cites as a parent.
  5. With exactly one head, each of its `current` entries must name a registered artifact at that path with that
     `sha256`; otherwise **E-CURRENT-UNRESOLVED** (path: the head), and the stage is **damaged**.
  6. More than one head → **E-STAGE-CONFLICT** (path: the stage folder name), and the stage is **conflicted**.
  7. Status is the first that applies: `damaged`, `incomplete`, `conflicted`, `empty` (no well-formed revision),
     `out-of-date` (some artifact in the head's `current` is not up to date, R-E6), `ok`.
  8. The report's `heads` lists head revision paths, sorted. Its `current` lists the head's `current` paths only
     when the status is `ok` or `out-of-date`, and is `[]` otherwise. An artifact is `inStageCurrent` exactly when
     its path is in that list.
  9. A registered artifact, outside `source/`, that no well-formed revision of its stage lists in `current` →
     **W-UNCOMMITTED** (an interrupted or abandoned commit).

- **R-E6: Up to date (recursive).** A registered artifact is **up to date** when `staleBecause` is empty. For each
  input of its record:
  - an **artifact input** `{role, path, sha256}`:
    - no registered artifact at `path` with that `sha256` → `INPUT-MISSING`;
    - otherwise, if the input lies outside `source/`: when the input's stage status is `damaged`, `incomplete`,
      `conflicted` or `empty` → `UPSTREAM-UNSETTLED`; else, when the input is not in that stage's `current` →
      `INPUT-SUPERSEDED`;
    - and, if the input artifact itself is not up to date → `UPSTREAM-OUT-OF-DATE`;
  - a **collection input** `{role, collection: "source", members}`: when `members` differs from the current
    source membership (as sets of `sha256`) → `SOURCE-CHANGED`, with `added` (current members not in `members`)
    and `removed` (`members` not current), each sorted;
  - an input chain that returns to an artifact already being evaluated → `CYCLE`.

  A **same-stage input** (an artifact input in the artifact's own stage, such as the previous SDD a rerun builds
  on) is history, not a dependency: it is checked for `INPUT-MISSING` only, and it neither propagates staleness nor
  counts towards structural roots (R-E7). Superseding it is the normal result of building on it.

  Each reason is `{code, input}`, where `input` is the input's `path` (or `source` for a collection input). A
  `SOURCE-CHANGED` reason also carries `added` and `removed`. Reasons are sorted by `input`, then by `code`.
  Artifacts in `source/` have no inputs and are always up to date.

- **R-E7: Pipeline readiness.** For an artifact in `source/`, `pipelineReady` is `null` and `notReadyBecause` is
  `[]`. For any other registered artifact, `notReadyBecause` collects, in this order:
  - `OUT-OF-DATE` if it is not up to date;
  - `NOT-CURRENT` if it is not `inStageCurrent`;
  - outside `normalized/`, from its **structural roots**: the `normalized/` artifacts reached by following
    artifact inputs recursively, skipping same-stage inputs (R-E6), stopping at each `normalized/` artifact. `NO-STRUCTURAL-ROOT` if there are none;
    `STRUCTURAL-ROOT-MISMATCH` if there is more than one.

  `pipelineReady` is `true` exactly when `notReadyBecause` is empty. This makes the **normalized schema the
  structural source of truth**: an SDD (or any later artifact) built without a normalized schema is recorded
  honestly and may be up to date, but is never pipeline-ready, and nothing downstream may mix two normalized schemas.

- **R-E8: Report order.** `stages` lists every registry stage in §3 order. `artifacts` is sorted by `path`.
  `diagnostics` is `{code, path}` objects, sorted by `path`, then `code`. All sorting is by UTF-16 code unit, as
  JavaScript's default sort.

## 8. Writers

- **R-W1: Create, never replace.** A writer creates contract files and artifacts only under names that do not
  exist yet. If the name exists with identical bytes, the write has already happened and succeeds. If it exists
  with different bytes, the writer MUST stop with **E-NAME-TAKEN** and change nothing.
- **R-W2: Commit order.** To publish artifacts in a stage it owns, a writer creates (1) each artifact, (2) its
  record, then (3) one revision listing them. The revision is the **commit point**: until it exists, the new
  artifacts are uncommitted (W-UNCOMMITTED) and the stage is unchanged.
- **R-W3: Parents.** A new revision's `parents` is exactly the stage's current head. In a `conflicted` stage, the
  writer MUST NOT pick a side on its own. After a person chooses, it writes a **merge revision** whose `parents`
  are all the heads and whose `current` is the chosen content.
- **R-W4: Refuse on damage.** A writer MUST NOT write a revision in a stage whose status is `damaged` because of
  E-REVISION-INVALID, or `incomplete`. In a stage `damaged` only by E-CURRENT-UNRESOLVED, it MAY write a repair
  revision whose parent is the damaged head and whose `current` lists only registered artifacts.
- **R-W5: Before writing,** a writer evaluates the stage, and checks that no new revision appeared since it
  evaluated, immediately before creating its revision. This narrows the window for a fork on one machine. It does
  **not** prevent forks across machines (§9).
- **R-W6: Inputs are complete for the project.** A record lists every project file the writer read to produce the
  artifact. Inputs from outside the project (tool version, bundled vocabularies, a person's decisions, an LLM's
  output) are not project inputs; they belong in `producedBy` and in the artifact itself.
- **R-W7: Source intake is shared.** Any tool MAY add a file to `source/` by creating the artifact and then its
  record (`generation: received`, `responsibility: intake`). Source files are never modified; replacing a source
  means adding the new file and, if wanted, deleting the old file and its record, which every dependent artifact
  then reports as `SOURCE-CHANGED` or `INPUT-MISSING`.
- **R-W8: Temporary files.** A writer that leaves a `.eps-tmp-` file behind after a failure SHOULD delete it on its
  next successful write in that folder.

## 9. Concurrency: what is and is not guaranteed

- **On one machine, in one browser:** writes from tabs of the same tool are serialized with Web Locks. Different
  tools (different origins or programs) share no lock.
- **Across machines** that synchronize the folder (OneDrive, a network share, git): **nothing is prevented.**
  Two machines can each write a new revision from the same head before either sees the other's. Because no file is
  ever modified and file names are content-derived (R-B3, R-B4), synchronization never has to merge a file: both
  revisions arrive, and the evaluation reports the stage as **conflicted** with two heads (EX-08). A conflict is
  visible only once both files have synchronized; an unsynchronized revision is invisible to this contract.
- **Sync-conflict copies** (for example a file renamed with a machine name) do not match R-B3 or R-B4. They are
  reported (W-FOREIGN-FILE) and never used (EX-14).
- **Work in progress** in `work/` is outside these guarantees. A tool that uses `work/` on several machines must
  detect its own conflicts.

## 10. Interrupted writes and recovery

Every write creates a new name, and every artifact and revision is checked against a hash recorded elsewhere, so an
interrupted write never silently changes what is current:

| Interrupted after | What remains | Evaluation | Recovery |
|---|---|---|---|
| temporary file only | `.eps-tmp-…` | W-TEMP-FILE | delete it (R-W8) |
| artifact, before record | artifact without record | W-UNREGISTERED | retry the write; the file may be deleted |
| record, before revision | registered, uncommitted artifact | W-UNCOMMITTED; stage unchanged | retry the commit, or delete both files |
| partial revision | unparseable revision | W-INTERRUPTED-REVISION; stage unchanged | delete it, then retry |
| partial artifact or record under its final name (only on the non-atomic fallbacks, §11) | bytes that do not match | E-INTEGRITY or E-RECORD-INVALID | delete and rewrite; if the artifact is in a head, write a repair revision (R-W4) |
| revision cites a parent not (yet) present | stage `incomplete` | E-MISSING-PARENT | wait for synchronization, or restore the parent |

## 11. Atomic-write behaviour by backend (informative)

This contract relies only on R-W1 and on hashes. Atomic writes reduce how often damage happens, but correctness never
depends on them.

| Backend | Primary path | When the primary path is unavailable | What can go wrong |
|---|---|---|---|
| **Node** (`node:fs`) | write `.eps-tmp-…`, `fsync` it, then `link()` it to the final name (fails if the name exists: an atomic create-if-absent on local NTFS, APFS and ext4), then remove the temporary file | where hard links are not supported (some network and cloud-backed folders): check the name is free, then `rename()`, which is atomic within one volume but can replace a file created between the check and the rename | power loss can lose a just-written file, because Windows cannot `fsync` a directory; the check-then-rename race can only meet a file with the same content-derived name |
| **Browser** (File System Access, adapted from mermaid) | write `.eps-tmp-…` with `createWritable()`, close it, then `move()` it to the final name after checking the name is free | without `move()`: write the final name directly. Chromium stages writes in a swap file and applies them on `close()`, which in practice avoids partial files, but that is browser behaviour, not a standard guarantee | the check-then-move race as above; no control over flushing to disk |
| **Synchronized folders** | the sync client uploads complete files after they are closed | | a remote copy can arrive later than files that reference it (E-MISSING-PARENT, INPUT-MISSING until it arrives) |

Exact behaviour on cloud-backed folders (OneDrive Files On-Demand, network shares) is verified in slice 3, with
results recorded here.

## 12. Integrity, provenance and determinism are different claims

| Property | Meaning | Who establishes it |
|---|---|---|
| **Integrity** | The artifact's bytes are the bytes its record names. | **Checked** by every evaluation (R-E3). |
| **Input consistency** | Every input the record cites exists with the cited bytes, and is still current upstream. | **Checked**, recursively (R-E6). |
| **Provenance completeness** | The record lists every project file that was used. | **Declared** by the writer (R-W6). An omitted input cannot be detected. |
| **Deterministic generation** | Running the named tool version on the cited inputs reproduces the same bytes. | **Declared** by `generation`: `deterministic` claims it, and it can be verified only by rerunning the tool; `assisted` (for example an SDD, which depends on an LLM's proposals and a person's decisions) claims no reproducibility; `received` marks source intake. |
| **Authenticity** | Who really wrote a file. | **Not provided.** Anyone who can write the folder can write consistent hashes. Signing is a non-goal. |

## 13. Examples

[`../examples/`](../examples/) holds synthetic project folders, each with the report a conforming reader must
produce (`expected.jsonld`). They are generated by [`../tools/gen-examples.mjs`](../tools/gen-examples.mjs), which
builds each folder by construction and states each expected report by hand from this contract. The generator never
evaluates a folder, so it is not an implementation of §7, and slice 2's implementation is judged against these
reports. The index is [`../examples/README.md`](../examples/README.md).

## 14. Non-goals (v0.1)

Renaming a project; deleting or withdrawing a committed artifact other than by writing a new revision; merging work
in progress; locks across tools or machines; signing; any network access; storing artifacts in browser storage.
