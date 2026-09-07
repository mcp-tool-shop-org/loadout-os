# Flat Store — FT-MR11 regression fixture

MEMORY.md lives INSIDE the store directory, and its pointers carry a
`memory/` prefix that is a NAMESPACE LABEL for the store, not a subdirectory
of it. This is the canonical store's real shape, and the shape the original
`fixtures/MEMORY.md` never exercised — which is why the doubled-prefix bug
survived to production.

## Flat — resolves via the PARENT base

Flat Topic — file lives at `<store>/flat-topic.md` → `memory/flat-topic.md`

## Nested — resolves via the STORE base (the store's second, drifted layout)

Nested Topic — file lives at `<store>/memory/nested-topic.md` → `memory/nested-topic.md`
