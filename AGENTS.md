# AGENTS.md

## Solver optimization handoff

Before investigating or changing route solving, spatial generation, action discovery,
caching, or solver performance, read both canonical English records:

- [Current implementation and open work](docs/handoff/handoff.md).
- [Strategy history and testing standards](docs/handoff/history.md).

Check their version bindings against the current source and the user's latest scope.
Historical trials, research proposals, and passed checks are not evidence that a
feature is implemented or that a new change has passed. Consult the recorded failed
and reverted approaches before repeating an experiment. A retry should identify
what changed in its assumptions, implementation, or measured bottleneck.

Update both records when solver optimization work changes their contents. Keep
`handoff.md` accurate for the resulting implementation, including cache contracts,
model assumptions, remaining bottlenecks, and unresolved correctness or quality gaps.
Append implemented, rejected, reverted, and inconclusive strategies to `history.md`
with their code/input bindings, actual checks, measurements, and decision rationale.
Keep the testing standards current when a requirement changes. If one record needs
no substantive edit, explicitly verify that it still agrees with the completed work.

Keep these two records in English and use them instead of creating another numbered
handoff or a duplicate status document. Preserve historical results with their dates
and scope; do not silently replace an unsuccessful experiment with its successor.
Use the focused validation policy in `history.md`, retain required project checks,
and do not run broad repeated profiling without a concrete unresolved concern.

Algorithm changes belong in Ganglia. Atlos owns its noclip integration patches and
packaged dependency; generated `talos/.cache/noclip` source is not an editing target.
Do not include unrelated workspace changes or push without explicit authorization.

## Source ownership

Use the six subsystems under `src/` described in `docs/handoff/handoff.md`.
Keep the root package entry points stable. Before sharing search state or adding
pruning, consult that record's state ownership and composition contracts. Record
the cost units, evidence scope, invalidation dependencies and budget semantics of
the change. A candidate ranking score must never silently become a pruning bound.
