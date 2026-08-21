<div align="center">

# 🧪 VibeCheck

### Evidence-first QA for AI / Vibe-Coded Web Apps

**AI가 코드를 빠르게 만들었다면, 누가 그 결과가 실제로 동작하는지 확인할까?**

![Node.js](https://img.shields.io/badge/Node.js-22+-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-Browser_QA-2EAD33?style=flat-square&logo=playwright&logoColor=white)
![QA](https://img.shields.io/badge/QA-Evidence_First-2563EB?style=flat-square)
![AI](https://img.shields.io/badge/AI-Discovery_Only-7C3AED?style=flat-square)

`Real Browser · Reproducibility · Network · Console · Screenshot · Assertion`

</div>

---

## Why I built it

Vibe Coding을 사용하면 구현 속도는 매우 빨라집니다.

하지만 실제 서비스를 만들면서 반복해서 이런 상황을 겪었습니다.

```text
코드는 만들어졌다.
      ↓
빌드도 성공했다.
      ↓
배포도 됐다.
      ↓
그런데 실제 사용자가 눌러보면 깨진다.
```

같은 LLM에게 다시 코드를 보여주고 **“문제 없어?”**라고 묻는 것만으로는 충분하지 않았습니다.

그래서 VibeCheck는 코드를 읽고 추측하는 QA가 아니라,
**실제 브라우저에서 서비스를 사용하고 기계적으로 검증 가능한 증거를 수집하는 QA**를 목표로 만들었습니다.

> **AI가 개발 속도를 높였다면, QA 역시 자동화되어야 한다.**

---

## Core idea

VibeCheck의 핵심은 **AI의 판단보다 재현 가능한 증거를 우선하는 것**입니다.

```text
URL 입력
   ↓
Public HTTPS / SSRF Guard
   ↓
Real Browser Exploration
   ↓
Desktop + Mobile Scan
   ↓
Network · Console · Screenshot · Assertion
   ↓
Independent Repeat Runs
   ↓
Reproducible Findings Only
   ↓
QA Report / Share / HTML / JSON
```

### Confirmed finding 조건

버그가 `confirmed`가 되려면 다음이 필요합니다.

1. 재현 가능한 단계
2. 기대 동작
3. 실제 동작
4. 기계 검증 가능한 증거
5. 독립 실행에서 반복 확인

AI가 발견한 후보는 바로 버그가 되지 않습니다.

---

## AI의 역할을 제한한 이유

VibeCheck에서 AI는 **discovery only**입니다.

AI는 사람이 놓칠 수 있는 테스트 후보나 상호작용 아이디어를 제안할 수 있지만,
다음 값들을 스스로 확정할 수 없습니다.

- severity
- evidence
- actual result
- signature
- confirmed status

즉,

```text
AI → "여기 한번 확인해봐"
Browser / Evidence Engine → "실제로 재현되는가?"
```

라는 역할 분리를 사용합니다.

모델 오류, quota, malformed JSON이 발생해도 deterministic Quick Scan 자체는 실패하지 않도록 분리했습니다.

---

## Trust contract

현재 benchmark gate:

| Metric | Gate |
| --- | ---: |
| Critical / Major recall | **≥ 90%** |
| False-positive rate | **≤ 10%** |
| Reproducibility | **≥ 95%** |

VibeCheck의 보안 관련 출력은 기본적인 launch-risk signal 범위로 제한됩니다.
**침투 테스트나 전문 보안 진단 도구를 대체하지 않습니다.**

---

## Main features

- 실제 Playwright 브라우저 기반 검사
- Desktop / Mobile 반복 실행
- same-origin bounded explorer
- network / console / screenshot / assertion 증거 수집
- 독립 실행 간 재현성 확인
- queued / running / completed / failed job 상태
- 완료 job 영속 저장 및 재시작 복구
- 결과 share link
- HTML / JSON report export
- scan rate limiting / TTL
- optional AI Deep Scan discovery
- SSRF / private IP / risky navigation guard

---

## Architecture

```text
┌──────────────┐
│   Web UI     │
│  URL Input   │
└──────┬───────┘
       │
       ▼
┌──────────────────┐
│ Target Validator │
│ HTTPS / SSRF     │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│ Browser Explorer │
│ Playwright       │
└──────┬───────────┘
       │
       ├── Network
       ├── Console
       ├── Screenshot
       └── Assertion
       │
       ▼
┌──────────────────┐
│ Evidence Review  │
│ Repeat / Compare │
└──────┬───────────┘
       │
       ├──── Optional AI Discovery
       │
       ▼
┌──────────────────┐
│ Confirmed Report │
└──────────────────┘
```

---

## Run locally

Requires:

- Node.js 22+
- Playwright-compatible browser
- Windows QA lane: installed Microsoft Edge supported

```bash
npm install
npm run web
```

Default address:

```text
http://127.0.0.1:8787
```

Completed jobs are stored in:

```text
artifacts/web/jobs.json
```

See `.env.example` for configurable limits.

---

## Optional AI Deep Scan

Quick Scan uses no model by default.

For the zero-cost discovery path:

```text
GROQ_API_KEY=...
```

Adaptive discovery order:

1. `openai/gpt-oss-120b`
2. `llama-3.3-70b-versatile`
3. `qwen/qwen3.6-27b`

Optional independent fallback:

```text
GEMINI_API_KEY=...
```

Before model calls, public-site snapshots are bounded and truncated, and secret-like fields/text are redacted.
Candidate overlap across models is deduplicated.

Legacy OpenAI-compatible configuration is also supported:

```text
VIBECHECK_AI_BASE_URL=https://provider.example/v1/
VIBECHECK_AI_API_KEY=...
VIBECHECK_AI_MODEL=...
```

---

## QA / Benchmark

```bash
npm test
npm run benchmark
npm run benchmark:hidden
npm run benchmark:browser
npm run benchmark:trust
npm run benchmark:flow
```

Flow trust evaluation:

```bash
node src/benchmark/run-flow-trust.js \
  --input artifacts/flow-browser \
  --ground-truth test/fixtures/flow-ground-truth.json \
  --output artifacts/flow-trust/report.json
```

The scanner never imports benchmark ground truth.

---

## Generic real-site shadow QA

```bash
node src/shadow/run-generic.js https://example.com https://www.wikipedia.org
```

Default shadow behavior:

- 2 independent runs
- up to 3 same-origin pages
- bounded read-only exploration

---

## Public deployment safety defaults

- HTTPS targets only
- URL credentials / custom ports rejected
- private / loopback / link-local / non-public IP ranges rejected
- browser requests reauthorized against DNS rebinding / SSRF risk
- same-origin bounded exploration
- logout / delete / checkout / payment style risky GET navigation skipped
- generic forms/buttons observed but not submitted
- scan concurrency capped
- job TTL and rate limiting
- AI disabled unless explicitly configured

---

## Product scope

VibeCheck는 현재 다음 용도에 초점을 맞춥니다.

**Evidence-first pre-launch QA**

- browser/runtime/network checks
- responsive checks
- bounded public-site exploration
- repeated verification
- evidence-backed reporting

완전한 application correctness certification이나 전문 보안 감사를 목표로 하지 않습니다.

---

<div align="center">

**Build fast. Verify with evidence.**

</div>
