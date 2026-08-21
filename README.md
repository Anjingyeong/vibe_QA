# VibeCheck

Evidence-first launch QA for AI/vibe-coded web apps.

VibeCheck opens a real browser, collects machine-verifiable evidence, repeats observations across independent runs, and promotes only reproducible observations to confirmed findings. AI is optional and discovery-only; it cannot confirm a bug by itself.

## Trust contract

A confirmed finding must include:

1. reproducible steps,
2. expected behavior,
3. actual behavior,
4. machine-verifiable evidence (`network`, `console`, `screenshot`, or `assertion`),
5. repeat confirmation across independent runs.

Current benchmark gates:

- Critical/Major recall >= **90%**
- false-positive rate <= **10%**
- reproducibility >= **95%**

Security-related output is limited to basic launch-risk signals. VibeCheck is **not** a penetration test or professional vulnerability assessment.

## Customer flow

```text
URL input
  -> public HTTPS / SSRF guard
  -> bounded same-origin read-only explorer
  -> desktop + mobile browser scan x N independent runs
  -> evidence reviewer
  -> optional AI discovery candidates
  -> customer report
  -> result / share / HTML export / JSON export
```

AI discovery candidates remain `candidate` status and are forbidden from supplying severity, evidence, actual result, signature, or confirmation fields.

## Run the web app

Requires Node.js 22+ and a Playwright-compatible browser. The current Windows QA lane uses installed Microsoft Edge.

```bash
npm install
npm run web
```

Default local address:

```text
http://127.0.0.1:8787
```

The web service provides:

- URL input and queued/running/completed/failed progress states
- persistent completed jobs in `artifacts/web/jobs.json`
- interrupted-job recovery after restart
- 24-hour job TTL by default
- per-client scan rate limiting
- unguessable result share links
- HTML and JSON report downloads

See `.env.example` for configurable limits.

## Optional AI Deep Scan discovery

Quick Scan uses no model by default. For the zero-cost Deep Scan discovery path, set a Groq API key:

```text
GROQ_API_KEY=...
```

The default adaptive order is:

1. `openai/gpt-oss-120b`
2. `llama-3.3-70b-versatile` only when the first pass has insufficient interaction coverage
3. `qwen/qwen3.6-27b` only when coverage is still insufficient

Add `GEMINI_API_KEY` to enable `gemini-3.7-flash` as an independent provider fallback when the Groq lane is unavailable or still insufficient. Provider errors, quota failures, malformed JSON, and attempts by a model to self-confirm a bug are isolated to AI discovery and do not fail deterministic Quick Scan.

Before model calls, the public-site snapshot is bounded, truncated, and secret-like fields/text are redacted. Candidate overlap across models is deduplicated.

The legacy generic OpenAI-compatible configuration remains supported when neither Groq nor Gemini is configured:

```text
VIBECHECK_AI_BASE_URL=https://provider.example/v1/
VIBECHECK_AI_API_KEY=...
VIBECHECK_AI_MODEL=...
```

AI proposes test candidates only; deterministic browser/evidence/reproducibility checks remain authoritative.

## QA and benchmarks

```bash
npm test
npm run benchmark
npm run benchmark:hidden
npm run benchmark:browser
npm run benchmark:trust
npm run benchmark:flow
node src/benchmark/run-flow-trust.js --input artifacts/flow-browser --ground-truth test/fixtures/flow-ground-truth.json --output artifacts/flow-trust/report.json
```

The scanner never imports benchmark ground truth.

## Generic real-site shadow QA

For bounded read-only checks against public HTTPS sites:

```bash
node src/shadow/run-generic.js https://example.com https://www.wikipedia.org
```

Defaults are two independent runs and up to three same-origin pages for this shadow runner. Customer Quick Scan defaults remain configurable separately.

## Public deployment safety defaults

- HTTPS targets only; URL credentials and custom ports rejected
- private, loopback, link-local, documentation, and other non-public IP ranges rejected
- browser requests are reauthorized to reduce DNS-rebinding/SSRF risk
- generic explorer remains same-origin and bounded
- risky GET navigation such as logout/delete/checkout/payment is skipped
- forms and buttons are observed but not submitted by the generic explorer
- scan concurrency is capped
- jobs expire by TTL and scan creation is rate limited
- AI is disabled unless explicitly configured

## Current product scope

VibeCheck is suitable for evidence-first pre-launch QA and limited paid-beta use: browser/runtime/network/responsive checks, bounded public-site exploration, repeat verification, and evidence-backed reporting. It should not be marketed as exhaustive application correctness certification or professional security auditing.
