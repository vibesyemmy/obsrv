# Pre-registered decision rules — written before reading any release diff

Derived from `docs/compatibility.md` alone, 2026-09-15, before looking at
0.56.0–0.60.0. If a rule below has to be bent to decide a release, that is the
policy having a hole and it gets recorded as one rather than resolved quietly.

## Needs a register entry

| # | Surface | What makes it breaking |
| --- | --- | --- |
| M1 | MCP reply | a field ADDED to an output schema (`additionalProperties: false`) |
| M2 | MCP reply | an enum VALUE added |
| M3 | MCP reply | a field removed or renamed |
| M4 | MCP reply | a field's MEANING changed, name kept — "the worst of them" |
| C1 | CLI stdout | the JSON key set changed at all ("the shape of a reply, silently" is listed under what will not change without being named) |
| S2 | control server | an existing command's behaviour changed |
| S3 | control server | an existing command's reply changed |
| E1 | exit codes | an exit code's meaning changed |
| T1 | thresholds | a documented threshold moved without `thresholds.md` moving with it |

Plus: **any MCP schema change at all needs a restart note**, stated per release
rather than assumed.

## Explicitly NOT breaking

- the wording of any warning or note — prose is not a parsing target
- a new control-server command (additive and safe, says the policy in terms)
- stderr text
- removing a field that was never documented and never emitted
- a threshold/default/measured constant where the number is a judgement, so
  long as `thresholds.md` moves with it

## Ambiguities I can already see, recorded before they can be resolved by convenience

- **A1. A CLI stdout key ADDITION.** The policy says additive is "not breaking
  for a caller reading named fields, but they are breaking for one comparing
  key sets — and this project's own tests do that, so assume someone else's do
  too." It does not then say whether that earns a register entry. C1 above is
  my reading; the policy does not state it outright.
- **A2. A NEW MCP TOOL.** Listed under what a minor may do, marked "(breaking
  on MCP, see above)". But the reason adding a *field* breaks is a client
  holding an old schema rejecting an unknown key in a reply. A new tool does
  not appear in an old client's replies at all. Whether a new tool is breaking
  under this policy's own reasoning is undecided by the text.
- **A3. A changed DEFAULT that changes values rather than shape.** e.g. a
  default preset or threshold that makes the same call return different
  numbers. M4 ("meaning changed") arguably covers it; the minor-release list
  arguably permits it. The text does not resolve which.
- **A4. A new ENUM value on the CLI rather than MCP.** M2 is written about the
  MCP surface. The CLI section says nothing about enums.

## Method, in order

1. CLI stdout key set per release, from `tests/e2e/cli.spec.ts` — asserted
   exactly, so a retroactive claim about it can be *verified* rather than
   argued. READ ONLY; this card does not change that file.
2. MCP output schemas per release.
3. Control server commands and replies.
4. Exit codes.
5. Thresholds against `thresholds.md`.

Releases with no existing entry get read hardest: an absent entry fits
"nothing broke" and "nobody looked" equally, which is this card's whole reason
for existing. A clean result is suspect until the check is shown to have had
something to look at.
