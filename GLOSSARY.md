# Ganglia routing

## Language

**Scene snapshot**: Physical support, collision, scene state and movement rules
that describe one fixed routing environment.

**New query**: A route request with fresh search state within a prepared scene
snapshot. Previously completed routes do not answer it.

**Same-scene batch**: A collection of independent route requests against one scene
snapshot. The collection does not prescribe execution order or parallelism.
