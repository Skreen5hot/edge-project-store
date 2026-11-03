# Edge project contract (EPS)

| | |
|---|---|
| **Status** | v0.1 **frozen** (2026-11-03), after the registrar's final confirmation review. Slice 1 of [`../PROPOSAL.md`](../PROPOSAL.md). Any change to the rules, schemas or expected reports is a new contract version. |
| **Registrar** | Aaron Damiano. |
| **Normative language** | BCP 14 keywords (MUST, MUST NOT, SHOULD, MAY) per RFC 2119 / RFC 8174, uppercase only. |
| **Identifiers** | Rules R-B\* (bytes and names), R-P\* (project files), R-E\* (evaluation), R-W\* (writers); diagnostics E-\* (errors) and W-\* (warnings); examples EX-\*. Minted, never renumbered. |
| **Conformance** | A **reader** conforms when its evaluation (§7) of every example under [`../examples/`](../examples/) equals that example's `expected.jsonld` byte for byte. A **writer** conforms when it follows §8 and no commit it completes introduces an evaluation error. Interrupted operations leave the recognized states of §10 and are recovered under those rules; external mutations (R-W10) are not writer operations. |

**What this is, in one paragraph.** A pipeline of offline tools (source schema or sample data → normalized schema
→ Semantic Data Dictionary → RML → RDF → graph, with Mermaid diagrams as a derived view) shares work through one
folder the user picks. This contract fixes that folder's layout and its three kinds of metadata file, and defines
one pure evaluation that any tool can run to learn, from the files alone: which artifacts are current, which are out
of date and why, whether anything is damaged or in conflict, and which artifacts are ready for the next stage of the
pipeline. Nothing here needs a server, a database, a lock service or a network.

---

## 1. Principles

1. **The folder is the contract.** Tools share files, never a runtime.
2. **Committed state is never overwritten.** Artifacts, records and revisions are created once and never modified
   or replaced (R-W1). This applies to committed state only: work in progress in `work/` (§6) is mutable, outside
   these guarantees, and can meet sync conflicts like any other changing file.
3. **Edge JSON-LD.** Metadata files are JSON-LD with one fixed, versioned, local context, never fetched (R-P1).
4. **Pure evaluation.** Everything in §7 is a function of the folder's bytes: no clock, no network, no randomness.
5. **Honest guarantees.** The contract detects conflicts and damage; it does not claim to prevent them (§9, §10).

## 2. Layout

```
<project folder>/
  edge-project.jsonld                         R-P2
  <stage>/                                    one folder per stage in the registry (§3)
    <kind>-<YYYYMMDDTHHMMSSZ>-<hash>.<ext>    artifact (R-B3)
    <artifact file name>.record.jsonld        artifact record (R-P4)
    revisions/rev-<YYYYMMDDTHHMMSSZ>-<hash>.jsonld   stage revision (R-P5), not in source/
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

- **R-B1: Canonical metadata bytes.** Writers serialize metadata files (R-P2, R-P4, R-P5) and reports (§7) in
  exactly this form, which is what ECMAScript's `JSON.stringify(value, null, 2)` followed by `"\n"` produces for
  the values this contract allows. The rule is stated in full so that a writer in any language can reproduce it:
  - **Key order** is fixed by the schemas, never by the writer: every object's keys appear in the order of its
    schema's `required` list, followed by any optional keys in the order of the schema's `properties`. This applies
    at every level (for example `producedBy`, inputs, reasons). Array order is fixed by the sorting rules in R-P4,
    R-P5 and R-E8.
  - **Layout:** two spaces of indentation per level; `"key": value` with one space after the colon; one element per
    line; `[]` and `{}` for empty arrays and objects; LF line ends; one LF after the closing brace; UTF-8 without a
    BOM.
  - **Values:** strings escape `"` as `\"`, `\` as `\\`, U+0008, U+0009, U+000A, U+000C and U+000D as `\b`, `\t`,
    `\n`, `\f`, `\r`, other code points below U+0020 as `\u00xx` (lowercase hex), and lone surrogates as `\udxxx`;
    every other character is written as itself in UTF-8. Numbers are non-negative integers in plain decimal.
    `true`, `false` and `null` as usual.

  Readers never re-serialize: identity is the hash of the bytes as they are (R-B2). Canonical form exists so that
  the same writer input always gives the same bytes. Artifacts are opaque bytes, and this contract never parses
  them.
- **R-B2: Hashes.** `sha256` is the SHA-256 of a file's exact bytes, as 64 lowercase hex characters. A **hash
  prefix** is its first 8, 16, 32 or 64 characters.
- **R-B3: Artifact names.** An artifact's file name is `<kind>-<time>-<hash>.<ext>`, where `kind` matches
  `[a-z0-9][a-z0-9-]{0,39}`, `time` is its record's `createdAt` as `YYYYMMDDTHHMMSSZ` (UTC), `hash` is a hash
  prefix of the artifact's own SHA-256, and `ext` matches `[a-z0-9]{1,10}`. Writers use the shortest prefix whose
  name is free (R-W1), so names are normally 8 characters long and are extended only after a collision. Readers
  compare the full `sha256` in the record, never the name (R-P4.5). Every character is portable across Windows,
  macOS, Linux, OneDrive and git. Two machines that cannot see each other can still pick the same artifact name
  for different content (same kind, same second, same 8-character prefix); that collision is always **detected**
  after synchronization, never silent, because revisions cite artifacts by full SHA-256 (§9, EX-25).
- **R-B4: Revision names.** `rev-<time>-<sha256>.jsonld`, where `time` is the revision's `createdAt` and `sha256`
  is the revision file's **full** SHA-256. Two revision files can share a name only if their bytes are identical,
  so synchronization can never hide one branch of a stage's history behind another (§9).
- **R-B5: Temporary names.** Writers name temporary files `.eps-tmp-<anything>`, in the folder of the final file.
- **R-B6: Safe paths.** A path in metadata is **safe** when all of the following hold. Anything else is unsafe.
  - It is one or more segments joined by single `/` characters, at most 512 characters long.
  - Its first segment is a stage name from §3, written exactly (paths are case-sensitive).
  - Every segment matches `[A-Za-z0-9_-][A-Za-z0-9._-]*`, does not end with `.`, and is not a Windows device
    name (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, in any case, with or without an extension).

  This excludes absolute paths, drive letters (`C:`), UNC paths, backslashes, empty, `.` and `..` segments, hidden
  names, and names that Windows would silently change. A reader resolves a safe path one segment at a time,
  matching each directory entry's name **exactly**, so a case-insensitive file system cannot alias `SDD/` to
  `sdd/`. It never follows a symbolic link, junction or shortcut (R-E2), so a safe path cannot leave the project
  folder.

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
     artifact's name (R-B3), and `sha256` begins with the name's hash prefix (else **E-RECORD-INVALID**);
  6. `producedBy.responsibility` is the stage's responsibility (§3) (else **E-WRONG-RESPONSIBILITY**);
  7. in `source/`: `generation` is `received` and `inputs` is empty; elsewhere: `generation` is `deterministic` or
     `assisted` (else **E-RECORD-INVALID**);
  8. every artifact input's `path` is safe (R-B6) (else **E-PATH-UNSAFE**);
  9. no artifact input's `path` lies in any stage's `work/` folder (else **E-WORK-INPUT**);
  10. `inputs` is sorted by `role`, then by `path` (a collection input sorts as `path` = `source`); every `members`
      list is sorted by `path` and has no duplicate paths; every member path lies in `source/` (else
      **E-RECORD-INVALID**).

  These checks read only the record. The evaluation never opens a file named by an unsafe path or by a path in a
  `work/` folder.

  Each **artifact input** `{role, relation, path, sha256}` declares its **relation** explicitly:
  - `dependency`: the artifact was produced using the input's content. Freshness and structural roots follow it
    (R-E6, R-E7).
  - `history`: the input is an earlier artifact that this one supersedes or continues, cited as provenance. It is
    verified for identity and integrity, but it does not take part in freshness or structural roots (R-E9).

  No relation is implied by where the input lies. A same-stage input is a dependency unless its record says
  `history`. The **collection input** `{role, relation: "dependency", collection: "source", members}` lists the
  source files used, as `{path, sha256}` pairs, so a record names the exact file behind each hash.
- **R-P5: Stage revisions.** A stage's state is a set of revision files in `<stage>/revisions/`, never one mutable
  file. Shape: [`../schemas/stage-revision-v1.schema.json`](../schemas/stage-revision-v1.schema.json). A revision's
  identity is its own `sha256`. `parents` lists the identities of the revisions it follows, sorted ascending; `[]`
  for a stage's first revision. `current` lists the artifacts this revision makes current. A revision is
  **well-formed** if, in this order: it parses as JSON; R-P1 holds; it matches its schema; `project` matches;
  `stage` is its folder; its name agrees with its `createdAt` and with its own full SHA-256 (R-B4); `parents` is
  sorted ascending without duplicates; every `current` entry lies in the revision's own stage and the entries are
  sorted by `path`; and `producedBy.responsibility` is the stage's. `source/` has no revisions.

## 6. Work in progress

- **R-P6:** `<stage>/work/` belongs to the stage's responsibility. Its contents are tool-defined, mutable, not
  covered by this contract and never evaluated. No record may cite a file in any `work/` folder as an input
  (R-P4.9). What a tool takes from its work in progress (for example a person's restored decisions) becomes part
  of the finished artifact's own content, like any other decision made outside the project (R-W6). Deleting `work/`
  loses unfinished work only, never an artifact.

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
  - an entry that is a symbolic link, junction, shortcut or anything other than a regular file or folder →
    **W-FOREIGN-FILE**, never followed or read (a stage folder that is itself a link is treated as absent and
    reported the same way);
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

- **R-E6: Up to date (recursive).** A registered artifact is **up to date** when `staleBecause` is empty. Only
  **dependency** inputs count (history inputs are R-E9). For each one:
  - an **artifact input** `{role, relation: "dependency", path, sha256}`:
    - the file at `path` exists but its bytes do not have that `sha256` → `INPUT-ALTERED`;
    - otherwise, no registered artifact at `path` with that `sha256` → `INPUT-MISSING`;
    - otherwise, if the input lies outside `source/`: when the input's stage status is `damaged`, `incomplete`,
      `conflicted` or `empty` → `UPSTREAM-UNSETTLED`; else, when the input is not in that stage's `current` and
      lies in a **different** stage from the artifact → `INPUT-SUPERSEDED`. (A same-stage dependency is normally
      superseded by the very artifact that uses it, so supersession alone does not make it stale; its own
      freshness still propagates through the next point.)
    - and: if the input is on a common cycle with the artifact (below) → `CYCLE`; otherwise, if the input artifact
      itself is not up to date → `UPSTREAM-OUT-OF-DATE`;
  - a **collection input**: when `members` differs from the current source membership (R-E4), compared as sets of
    `{path, sha256}` pairs → `SOURCE-CHANGED`, with `added` (current members not in `members`) and `removed`
    (`members` not current), each sorted by `path`. Renaming, adding, removing or editing a source file therefore
    all register.

  **Cycles.** The dependency inputs that resolve to registered artifacts form a directed graph. Two artifacts are
  on a **common cycle** when each can be reached from the other along dependency inputs; an artifact that cites
  itself is on a cycle with itself. An input on a common cycle with the citing artifact gets `CYCLE` in place of
  `UPSTREAM-OUT-OF-DATE`; the other checks for that input still apply. So every artifact on a cycle carries at least
  one `CYCLE` reason and is not up to date, and an artifact outside the cycle that depends on a member of it gets
  `UPSTREAM-OUT-OF-DATE`. The rule is defined on the graph, not on a traversal, so the report does not depend on the
  order in which a reader visits artifacts (EX-24).

  Each reason is `{code, input}`, where `input` is the input's `path` (or `source` for a collection input). A
  `SOURCE-CHANGED` reason also carries `added` and `removed`. Reasons are sorted by `input`, then by `code`.
  Artifacts in `source/` have no inputs and are always up to date.

- **R-E7: Pipeline readiness.** For an artifact in `source/`, `pipelineReady` is `null` and `notReadyBecause` is
  `[]`. For any other registered artifact, `notReadyBecause` collects, in this order:
  - `OUT-OF-DATE` if it is not up to date;
  - `NOT-CURRENT` if it is not `inStageCurrent`;
  - outside `normalized/`, from its **structural roots**: the set of `normalized/` artifacts reached by following
    dependency inputs recursively (never history inputs; each artifact visited once, so cycles terminate), stopping
    at each `normalized/` artifact. `NO-STRUCTURAL-ROOT` if there are none; `STRUCTURAL-ROOT-MISMATCH` if there is
    more than one.

  `pipelineReady` is `true` exactly when `notReadyBecause` is empty. It means **structural readiness for downstream
  processing** and nothing more: it does not imply that provenance is complete (R-W6), that history is verified
  (R-E9), or that the author is authenticated (§12). This makes the **normalized schema the structural source of
  truth**: an SDD (or any later artifact) built without a normalized schema is recorded honestly and may be up to
  date, but is never pipeline-ready, and nothing downstream may mix two normalized schemas.

- **R-E8: Report order.** `stages` lists every registry stage in §3 order. `artifacts` is sorted by `path`.
  `diagnostics` is `{code, path}` objects, sorted by `path`, then `code`. All sorting is by UTF-16 code unit, as
  JavaScript's default sort.

- **R-E9: Historical provenance.** For each **history** input `{role, relation: "history", path, sha256}` of a
  registered artifact:
  - the file at `path` exists but its bytes do not have that `sha256` → `HISTORY-ALTERED`;
  - otherwise, no registered artifact at `path` with that `sha256` → `HISTORY-MISSING`.

  Reasons are `{code, input}` in `historyBecause`, sorted by `input`, then `code`, and `historyVerified` is `true`
  exactly when `historyBecause` is empty (an artifact with no history inputs is verified). History never affects
  `upToDate`, `staleBecause`, structural roots or `pipelineReady` (decision D11 in [`../PROPOSAL.md`](../PROPOSAL.md)).

## 8. Writers

- **R-W1: Create, never replace.** Artifacts, records and revisions are **committed files** from the moment they
  are created, whether or not a revision lists them yet. A conforming writer creates them only under names that
  do not exist yet, and MUST NOT overwrite, truncate, rename or delete any of them, including uncommitted ones,
  which may belong to another writer's commit in progress. How strictly a backend can enforce this is its
  guarantee level (R-W9).
  - **Artifact names.** The writer tries the 8-character hash prefix first. If the name holds **different** bytes
    (a prefix collision, a stray file or a partial write), it tries the 16-, 32- and 64-character prefixes in turn
    (R-B3, EX-22).
  - **Same bytes already present.** If the name holds identical bytes and the record beside it is byte-identical to
    the record the writer would write, the write already happened (a retry) and succeeds. If the record is absent,
    the writer creates it, completing an interrupted write.
  - **Same bytes, different record.** If the name holds identical bytes but the existing record differs from the
    one the writer would write (another tool or configuration produced the same content in the same second, or the
    record is damaged), the writer MUST NOT reuse that artifact or touch its record. A record's name follows from
    its artifact's name (R-P4), so a new record needs a new artifact: the writer takes a later `createdAt` and
    writes the artifact again under the resulting name, with its own record.
  - **Prefixes exhausted.** If all four names at one `createdAt` hold different bytes (for example, a partial
    artifact under the 64-character name after the shorter names were taken), the writer takes a later `createdAt`
    and starts again at the 8-character prefix.
  - **Revisions** carry their full SHA-256 in the name (R-B4). If the name holds identical bytes, the write
    succeeds. If it holds different bytes, which only an interrupted or damaged write can leave, the writer uses a
    later `createdAt`, giving a new name.
  - A later `createdAt` is at least one second after the one tried, so that it changes the name. A writer that
    cannot use a later `createdAt` (for example, because its caller fixed the time) stops with **E-NAME-TAKEN** and
    changes nothing. In every case the files already present are left untouched.
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
- **R-W6: Disclosed inputs.** A record lists, as dependencies, every **committed** project artifact that
  materially contributed to the output, and MAY list earlier artifacts as history. Work-in-progress files are never
  listed (R-P6). What the writer took from them, like everything else from outside the committed project (tool
  version, bundled vocabularies, a person's decisions, an LLM's output), is not a project input: it belongs in
  `producedBy` and in the artifact's own content.
- **R-W7: Source intake is shared and append-only.** Any tool MAY add a file to `source/` by creating the artifact
  and then its record (`generation: received`, `responsibility: intake`). Like every committed file, a source file
  is never modified or deleted by a conforming writer. Replacing a source means adding the new file; the old one
  stays a member until a person removes it (R-W10).
- **R-W8: Temporary files.** A writer that leaves a `.eps-tmp-` file behind after a failure SHOULD delete it on its
  next successful write in that folder. Temporary files are not committed files.
- **R-W9: Write guarantee levels.** Every backend declares one level, and a tool states the level it runs with:
  - **exclusive**: every create is an atomic create-if-absent in the file system, which fails if the name exists.
    R-W1 is enforced: nothing is overwritten, even by a racing writer on the same file system.
  - **checked**: the backend can only check that a name is free, then create it. Web Locks close that window
    between tabs of one tool. Another program, or a synchronizing client, that creates the same name in between can
    be overwritten. For revisions this is harmless, because equal names mean equal bytes (R-B4). For an artifact or
    a record it is a breach of R-W1 that the backend cannot prevent. A replaced artifact is detected by its hash
    (E-INTEGRITY, E-CURRENT-UNRESOLVED); a replaced record of byte-identical content is not detectable in v0.1.

  A writer MUST use the exclusive level wherever its backend offers it, and MUST NOT use a primitive that can
  replace an existing name (such as `rename()` onto a name that may exist) when an exclusive one is available.
  §11 states each backend's level.
- **R-W10: External mutations.** People own their folders and can still edit, delete or rename any file outside a
  tool. That is an **external mutation**, not a writer operation, and the evaluation reports its effect: a removed
  or renamed source shows as `SOURCE-CHANGED` (EX-04), an edited file as `E-INTEGRITY` (EX-05, EX-11), a removed
  revision as `E-MISSING-PARENT` (EX-12). This contract defines no operation for retiring a committed file.

## 9. Concurrency: what is and is not guaranteed

- **On one machine, in one browser:** writes from tabs of the same tool are serialized with Web Locks. Different
  tools (different origins or programs) share no lock.
- **Across machines** that synchronize the folder (OneDrive, a network share, git): **nothing is prevented.**
  Two machines can each write a new revision from the same head before either sees the other's. Revision names
  carry the full SHA-256 (R-B4), so two different revisions never share a name and synchronization never has to
  choose between them: both arrive, and the evaluation reports the stage as **conflicted** with two heads (EX-08).
  A conflict is visible only once both files have synchronized; an unsynchronized revision is invisible to this
  contract.
- **Artifact name collisions across machines.** Two disconnected machines can give different artifacts the same
  name (same kind, same second, same 8-character prefix), because neither sees the other's file. After
  synchronization one file holds the name and the other becomes a sync-conflict copy. This is **detected, not
  prevented**: each machine's revision cites its artifact by full SHA-256, both revisions arrive, and the stage is
  conflicted; the copy is reported (W-FOREIGN-FILE) (EX-25). Recovery: the machine whose artifact lost the name
  writes it again under a longer prefix (R-W1), and a person resolves the conflict with a merge revision (R-W3).
- **Sync-conflict copies** (for example a file renamed with a machine name) do not match R-B3 or R-B4. They are
  reported (W-FOREIGN-FILE) and never used (EX-14, EX-25).
- **Work in progress** in `work/` is outside these guarantees. Its files are mutable, so a sync client can
  overwrite one with another machine's copy or create a conflict copy beside it. A tool that uses `work/` on
  several machines must detect this itself, for example by recording in the work file the stage revision it was
  based on and treating a mismatch as a reason to revalidate.

## 10. Interrupted writes and recovery

Every write creates a new name, and every artifact and revision is checked against a hash recorded elsewhere, so an
interrupted write never silently changes what is current. Writers recover by **retrying**, never by deleting
committed files (R-W1). Removing leftovers is something a person may choose to do, as an external mutation
(R-W10).

| Interrupted after | What remains | Evaluation | Writer's recovery | A person may also |
|---|---|---|---|---|
| temporary file only | `.eps-tmp-…` | W-TEMP-FILE | delete it on its next write (R-W8) | delete it |
| artifact, before record | artifact without record | W-UNREGISTERED | retry: the same bytes are found and the record is created (R-W1) | delete the artifact |
| record, before revision | registered, uncommitted artifact | W-UNCOMMITTED; stage unchanged | retry the commit: artifact and record are found, then the revision is written | delete both files |
| partial revision | unparseable revision | W-INTERRUPTED-REVISION; stage unchanged | retry: the name holds different bytes, so R-W1 gives the revision a later `createdAt` and it is written beside the partial one | delete the partial file |
| partial artifact or record under its final name (only where content writes are not atomic, §11) | bytes that do not match | E-INTEGRITY or E-RECORD-INVALID | write again, leaving the damaged files untouched. A partial artifact: R-W1 tries the longer prefixes, then a later `createdAt` if all four are taken. A damaged record: its name is fixed by its artifact's, so R-W1 writes the artifact again under a later `createdAt`, with a new record. If the damaged artifact is in a head, write a repair revision (R-W4) | delete the damaged files |
| revision cites a parent not (yet) present | stage `incomplete` | E-MISSING-PARENT | none: writes are refused (R-W4) | wait for synchronization, or restore the parent |
| artifact name taken on another machine (found after synchronization) | a sync-conflict copy; stage conflicted | W-FOREIGN-FILE, E-STAGE-CONFLICT (EX-25) | write the artifact again under a longer prefix and its own record; then a merge revision once a person has chosen (R-W3) | delete the conflict copy |

## 11. Write guarantees by backend

Two properties are separate. **No overwrite** (R-W1) is what the guarantee level (R-W9) is about. **Atomic
content** (a file never appears under its final name half-written) only reduces how often damage happens; partial
content is always detected by its hash, so correctness never depends on it.

| Backend | Level (R-W9) | Primary path | When the primary path is unavailable | Remaining risks |
|---|---|---|---|---|
| **Node** (`node:fs`) | **exclusive** | write `.eps-tmp-…`, `fsync` it, `link()` it to the final name (fails if the name exists), remove the temporary file: no overwrite and atomic content | where hard links are not supported (some network and cloud-backed folders): open the final name with the exclusive-create flag (`wx`), write and `fsync`. Still no overwrite, but content is not atomic. Never `rename()` onto the final name | a crash during the fallback can leave a partial file (detected); power loss can lose a just-written file, because Windows cannot `fsync` a directory |
| **Browser** (File System Access, adapted from mermaid) | **checked** (the API has no exclusive create) | check the name is free, write `.eps-tmp-…` with `createWritable()`, close it, `move()` it to the final name | without `move()`: check, then write the final name directly. Chromium stages writes in a swap file and applies them on `close()`, which in practice avoids partial files, but that is browser behaviour, not a standard guarantee | the check-then-create window (R-W9); no control over flushing to disk |
| **Synchronized folders** | not a backend: the sync client sits under either one | the sync client uploads files after they are closed | | a remote file can arrive later than files that cite it (E-MISSING-PARENT, INPUT-MISSING until it arrives); artifact name collisions between machines (§9, EX-25) |

Exact behaviour on cloud-backed folders (OneDrive Files On-Demand, network shares), including whether `link()`
and `wx` are honoured there, is verified in slice 3, with results recorded here.

## 12. Integrity, provenance and determinism are different claims

| Property | Meaning | Who establishes it |
|---|---|---|
| **Integrity** | The artifact's bytes are the bytes its record names. | **Checked** by every evaluation (R-E3). |
| **Input consistency** | Every dependency the record cites exists with the cited bytes, and is still current upstream. | **Checked**, recursively (R-E6). |
| **Historical provenance** | Every earlier artifact the record cites as history still exists with the cited bytes. | **Checked**, not recursively and without effect on freshness (R-E9). |
| **Provenance completeness** | The record lists every committed project artifact that materially contributed. | **Declared** by the writer (R-W6). An omitted input cannot be detected. |
| **Deterministic generation** | Running the named tool version on the cited inputs reproduces the same bytes. | **Declared** by `generation`: `deterministic` claims it, and it can be verified only by rerunning the tool; `assisted` (for example an SDD, which depends on an LLM's proposals and a person's decisions) claims no reproducibility; `received` marks source intake. |
| **Authenticity** | Who really wrote a file. | **Not provided.** Anyone who can write the folder can write consistent hashes. Signing is a non-goal. |

## 13. Examples

[`../examples/`](../examples/) holds synthetic project folders, each with the report a conforming reader must
produce (`expected.jsonld`). They are generated by [`../tools/gen-examples.mjs`](../tools/gen-examples.mjs), which
builds each folder by construction and states each expected report by hand from this contract. The generator never
evaluates a folder, so it is not an implementation of §7, and slice 2's implementation is judged against these
reports. The index is [`../examples/README.md`](../examples/README.md).

Symbolic links and junctions (R-B6, R-E2) cannot be stored portably in git, so they have no example folder. They
are tested in slice 3 against each backend, on a real file system.

## 14. Non-goals (v0.1)

Any writer operation that deletes, retires or withdraws a committed file (a new revision is the only way to change
what is current; people may still remove files themselves, R-W10); renaming a project; merging work in progress;
locks across tools or machines; signing; any network access; storing artifacts in browser storage.
