# AGENTS.md

## Documentation standards

Create standalone documentation only when explicitly requested by a human.
Otherwise, place necessary explanations in code comments.

Apply these rules to both code comments and other documentation:

- **Stateless and self-contained:** text must be understandable without the agent
  session, PR discussion or other conversational context. Do not refer to local
  development documents or describe what the code used to do. References to
  external sources and GitHub issues or PRs are allowed.
- **Do not duplicate implementation:** explain decisions, constraints and reasons
  for surprising choices that the code cannot express. If a small implementation
  change elsewhere would make the text stale, remove the duplicated detail.
  Capture useful rationale directly; do not create formal ADRs by default.
- **How-to and handoff exception:** a human-requested explanation saved for another
  human or agent may repeat necessary implementation details. State its scope and
  freshness conditions, and update or remove it when it becomes outdated.

## Development

Historical measurements and passed checks do not verify changed code or inputs.
Run focused validation and broaden it only for a concrete unresolved concern.

Algorithm changes belong in Ganglia. Atlos owns its noclip integration patches and
packaged dependency; generated `talos/.cache/noclip` source is not an editing target.
Do not include unrelated workspace changes or push without explicit authorization.

## Local development resources

Keep dependency clones, downloaded data, generated datasets, caches and private
configuration under `.local/` in the Ganglia repository root. Resolve this location
from the repository root even when running commands inside a dependency checkout.
Keep `.local/` excluded from Git.

Inspect local files and repository instructions to determine available resources
and their current setup. Record dataset provenance alongside the data, including
its game build, exporter version and state/profile settings. Preserve verified
inputs when generating a new dataset version.
