# Security model

- Browser code never receives Gemini or HexStellar credentials.
- Production secrets are injected from Secret Manager into the private worker.
- Worker endpoints require authenticated Cloud Tasks or Pub/Sub identity tokens.
- Input models reject unknown fields and impose length and numeric bounds.
- Telemetry text is treated as data; no shell, URL fetch, filesystem, or credential tool is available to the agent.
- The Cortex adapter refuses unsupported command names.
- Mutation is restricted to the simulated sandbox and requires an independent verification pass.
- External mission patches are review-only artifacts.
- Security headers, restrictive CORS, redacted structured logs, dependency pinning, and secret scanning are CI requirements.

Report vulnerabilities privately to the repository owner rather than opening a public issue containing sensitive details.

See [THREAT_MODEL.md](THREAT_MODEL.md) for assets, actors, abuse cases, controls, and residual risk.

> **BRAYON PIESKE** — *"Engineering earns trust when every claim is testable and every release is verified."*
