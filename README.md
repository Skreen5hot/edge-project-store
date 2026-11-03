# edge-project-store

A shared project folder for offline, edge-canonical data pipelines, and one small module that every tool in the
pipeline reuses to read and write it.

**Status:** contract v0.1 **frozen** (slice 1): the contract, its JSON-LD context and JSON Schemas, and 25
synthetic example projects with their expected evaluation reports. The module (slice 2) is implemented, awaiting
final confirmation. See [`PROPOSAL.md`](PROPOSAL.md) for the plan and the decisions behind it.

## The idea

A pipeline such as *source schema or sample data → normalized schema → Semantic Data Dictionary → RML → RDF →
graph* is run by several separate tools. Instead of each tool inventing its own way to save and reopen work, they all
use one **project folder** with a fixed layout:

- the user picks the folder (it can live in OneDrive, a network share or a git repository);
- each stage has its own subfolder with one responsible writer; `source/` is a shared intake area;
- committed state is never overwritten: artifacts, their records and the stage's revisions are only ever added
  (work in progress is the one mutable exception);
- every artifact has a record of the exact inputs it was built from, so any tool can tell, recursively, what is
  out of date and why;
- the normalized schema is the structural source of truth: later artifacts are pipeline-ready only when they trace
  back to exactly one normalized schema.

The tools share a **contract**, not a server, a database or a lock service. One pure evaluation turns a folder into a
report of what is current, out of date, in conflict or damaged.

## Contents

| Path | What |
|---|---|
| [`spec/edge-project-contract.md`](spec/edge-project-contract.md) | The contract (EPS v0.1, frozen) |
| [`context/eps-v1.jsonld`](context/eps-v1.jsonld) | The JSON-LD context, bundled by every tool and never fetched |
| [`schemas/`](schemas/) | JSON Schemas for the project file, artifact records, stage revisions and the evaluation report |
| [`examples/`](examples/) | Synthetic project folders, each with the report a conforming reader must produce |
| [`tools/gen-examples.mjs`](tools/gen-examples.mjs) | Builds the examples; `--check` verifies them byte for byte |
| [`src/`](src/) | The module (slice 2): [`contract.mjs`](src/contract.mjs) (pure evaluation, names, canonical bytes), [`project.mjs`](src/project.mjs) (the writer rules over a backend), [`memory-backend.mjs`](src/memory-backend.mjs); entry point [`index.mjs`](src/index.mjs) |
| [`test/`](test/) | Conformance tests (the 25 examples) and independent unit tests |

Run everything with `npm run check` (Node 22 or later, no dependencies): the examples and the embedded schemas
are verified, then all tests run.

## Principles

- **Offline and local.** No network requests, no accounts, no server. The files belong to the user.
- **Edge JSON-LD.** Metadata is JSON-LD with one fixed, versioned, local context.
- **Deterministic.** The same folder always evaluates to the same report; hashes identify content.
- **Honest guarantees.** The contract detects conflicts and damage across synchronized machines; it does not claim
  to prevent them.
- **Manual fallback.** Every tool keeps a plain open-file / save-file path where folder access is unavailable.

## Origin

The planned browser storage layer is adapted from the File System Access implementation in
[Skreen5hot/mermaid](https://github.com/Skreen5hot/mermaid) (CC0): atomic writes, Web Locks, path sanitization and
the permission lifecycle.

## Licence

MIT.
