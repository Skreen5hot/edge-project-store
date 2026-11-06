# Communications

This record follows the communications protocol, version 1.1:
Skreen5hot/communications, PROTOCOL.md at 7f994a91f40d763aacfc53bd9fafa89ef89dac16, sha256 fb3a06309eb5ecd5920a7737789df524000e5447f86c008ec16fee6203d9d74d.

That file is the authority; the rules are not copied here. Team codes are in `correspondents.yaml` in the same
repository. This repository's code is **`EPS`** (Edge Project Store).

## Teams

One folder per team, named by its code in lowercase, each with a `README.md` saying who the team is.

| Folder | Code | Team | Repository |
|---|---|---|---|
| `sdd/` | `SDD` | Semantic Data Dictionary | `Skreen5hot/SemanticDataDictionary` |

## Rules of our own

These add to the protocol and do not contradict it.

1. **We communicate in public** (the registrar's decision, 2026-11-06, until further notice): this repository is
   public at `Skreen5hot/edge-project-store`, and every outgoing message is announced on the board. Synthetic data
   only, as always.
2. **Before this record:** exchanges went by files in `review/` and `proposals/`, while the repository was local
   (D10). Those files stay where they are; they are not messages under the protocol. A proposal may still be a file
   under `proposals/` that a message refers to.

## Here

- **Decisions (Rule 4):** in the decision sections of `proposals/` and in the sign-offs under `validation/`, citing
  the message by id.
- **Line endings:** `.gitattributes` already has `* -text`, which covers `communications/**` (Rule 7).
