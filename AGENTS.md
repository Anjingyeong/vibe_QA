# VibeCheck project rules

- Treat QA claims as evidence-backed assertions, not model opinions.
- A confirmed bug must include reproduction steps, expected result, actual result, and machine-verifiable evidence.
- Do not call the product a penetration test or professional security audit.
- Keep benchmark ground truth isolated from scanner execution. The scanner must never import the ground-truth file.
- Changes are not complete until `npm test` and `npm run benchmark` pass.
- Prefer deterministic checks first; LLM reasoning is an optional discovery layer, never the sole confirmation source.
