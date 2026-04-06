# Architecture Principles

1. **API-first** — all features are accessible via API before any UI is built
2. **Fail fast** — validate inputs at system boundaries; never silently swallow errors
3. **Stateless services** — application state lives in the database, not in-process
4. **Explicit contracts** — API schemas are versioned and documented before implementation
5. **Observable by default** — every service emits structured logs and traces
