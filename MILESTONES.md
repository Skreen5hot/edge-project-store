# Milestones

**Status:** plan approved with the proposal (2026-11-03). Each milestone delivers something a person can use and
validate, ends with a validation document under [`validation/`](validation/), and is signed off by the registrar
before the next begins. Slices 1 and 2 of [`PROPOSAL.md`](PROPOSAL.md) are done (contract frozen at `7526a69`;
module at `bcad226`).

| # | Milestone | Value delivered | Slice | Status |
|---|---|---|---|---|
| M1 | **Project folders on disk** | Any command-line or Node tool can create, write and inspect a project folder on a local disk or in OneDrive, with conflicts and damage reported; a person can check any project with one command | 3 (Node half) | **built; awaiting validation** ([`validation/M1-validation.md`](validation/M1-validation.md)) |
| M2 | **Project folders in the browser** | A single offline HTML page can open a project folder, keep its permission across restarts and show the project's state, so browser tools such as SDD can use the same folders | 3 (browser half) | |
| M3 | **SDD project mode (SDD v1.1)** | The SDD tool opens a project, saves SDDs as committed artifacts, resumes unfinished work and reopens a mapping | 4 | needs the SDD-side proposal |
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
| M1-10 | **Registrar check:** the demo's two-machine conflict, run in a OneDrive folder synchronized between two PCs, is reported as `conflicted` and resolved with `eps merge` | the registrar, using the validation document |

**Out of scope for M1:** the browser backend, any SDD change, publication.
