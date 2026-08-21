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

## 1. Why I built it

Vibe Coding을 사용하면 구현 속도는 매우 빨라집니다. 하지만 여러 웹 서비스를 직접 만들고 배포하면서 반복해서 같은 문제를 겪었습니다.

```text
코드는 만들어졌다.
      ↓
빌드도 성공했다.
      ↓
배포도 됐다.
      ↓
그런데 실제 사용자가 눌러보면 깨진다.
```

코드를 생성한 LLM에게 다시 코드를 보여주며 **“문제 없어?”**라고 묻는 방식만으로는 충분하지 않았습니다. 코드만 보고 추론하는 것과 실제 브라우저에서 네트워크 요청, 콘솔 오류, 반응형 UI, 클릭 흐름을 확인하는 것은 다른 문제이기 때문입니다.

그래서 VibeCheck는 **코드를 평가하는 또 하나의 AI**가 아니라, 실제 브라우저에서 서비스를 사용하고 기계적으로 검증 가능한 증거를 수집하는 QA 시스템을 목표로 만들었습니다.

> **AI가 개발 속도를 높였다면, QA 역시 자동화되어야 한다.**

---

## 2. Problem definition

VibeCheck가 해결하려는 문제는 단순한 lint/build 실패가 아닙니다.

- 빌드는 성공했지만 실제 페이지에서 발생하는 JavaScript 오류
- API 요청 실패나 예상하지 못한 HTTP 상태
- 모바일/데스크톱에서만 재현되는 UI 문제
- 링크/버튼 이동 후 깨지는 사용자 흐름
- 한 번만 우연히 나타난 현상을 실제 버그로 잘못 판단하는 문제
- LLM이 근거 없이 severity나 원인을 확정하는 문제

따라서 설계 목표를 다음처럼 잡았습니다.

```text
Guess less.
Observe more.
Confirm only what reproduces.
```

---

## 3. Design principles

### Evidence first

버그 판단의 기준을 LLM의 설명이 아니라 실제 실행 증거에 둡니다.

수집 가능한 증거:

- `network`
- `console`
- `screenshot`
- `assertion`

### Reproducibility first

한 번 관찰된 현상은 곧바로 확정하지 않습니다. 독립 실행에서 반복 재현되는지 확인한 뒤 confirmed finding으로 승격합니다.

### AI is discovery-only

AI는 사람이 놓칠 수 있는 상호작용이나 테스트 후보를 제안할 수 있지만 다음 값들을 직접 확정할 수 없습니다.

- severity
- evidence
- actual result
- signature
- confirmed status

즉 역할을 분리했습니다.

```text
AI
└─ "여기를 확인해보자"          → candidate discovery

Browser / Evidence Engine
└─ "실제로 재현되는가?"        → authoritative verification
```

### Deterministic core survives AI failure

모델 quota, provider error, malformed JSON이 발생해도 deterministic Quick Scan 자체는 실패하지 않도록 AI 경로를 분리했습니다.

---

## 4. How it works

```text
URL Input
   ↓
Public HTTPS / SSRF Guard
   ↓
Bounded Same-Origin Explorer
   ↓
Desktop + Mobile Browser Scan
   ↓
Network · Console · Screenshot · Assertion
   ↓
Independent Repeat Runs
   ↓
Evidence Review / Reproducibility Check
   ↓
Optional AI Discovery Candidates
   ↓
Confirmed Findings
   ↓
Result / Share / HTML / JSON Report
```

### Architecture

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

## 5. What counts as a confirmed finding?

확정된 finding은 최소한 다음 정보를 포함해야 합니다.

1. 재현 가능한 단계
2. 기대 동작
3. 실제 동작
4. 기계 검증 가능한 증거
5. 독립 실행에서의 반복 확인

현재 품질 gate는 다음을 목표로 합니다.

| Metric | Gate |
| --- | ---: |
| Critical / Major recall | **≥ 90%** |
| False-positive rate | **≤ 10%** |
| Reproducibility | **≥ 95%** |

> 이 값은 제품 품질을 평가하기 위한 benchmark gate이며, 모든 웹 애플리케이션의 완전한 정확성을 보증한다는 의미는 아닙니다.

---

## 6. Key implementation decisions

### 6.1 Real browser instead of static inspection

정적 코드 분석만으로는 런타임 네트워크/콘솔/레이아웃 문제를 충분히 확인하기 어렵기 때문에 Playwright 기반 실제 브라우저 실행을 선택했습니다.

### 6.2 Same-origin bounded exploration

QA 자동화가 사이트 전체를 무제한 탐색하지 않도록 same-origin과 탐색 범위를 제한했습니다. 일반 explorer는 관찰 중심으로 동작하고 위험한 동작은 피합니다.

### 6.3 Repeat before confirm

일시적인 네트워크 지연이나 우연한 렌더링 문제를 버그로 확정하는 false positive를 줄이기 위해 독립 반복 실행을 설계에 포함했습니다.

### 6.4 Separate candidate from finding

AI가 제안한 항목과 실제 증거로 검증된 항목을 데이터 수준에서 분리해, 모델의 자신감이 QA 결과의 근거처럼 사용되지 않도록 했습니다.

### 6.5 Report as an artifact

QA 결과를 화면에만 보여주지 않고 share link와 HTML / JSON 형태로 내보낼 수 있게 해 재검토와 자동화 파이프라인에 활용할 수 있도록 했습니다.

---

## 7. Main features

- Playwright 실제 브라우저 기반 검사
- Desktop / Mobile 반복 실행
- same-origin bounded explorer
- network / console / screenshot / assertion 증거 수집
- 독립 실행 간 재현성 확인
- queued / running / completed / failed job 상태
- 완료 job 영속 저장
- 재시작 후 interrupted-job recovery
- 24시간 job TTL 기본값
- per-client scan rate limiting
- unguessable share link
- HTML / JSON report export
- optional AI Deep Scan discovery
- SSRF / private IP / risky navigation guard

---

## 8. Public deployment safety boundaries

공개 URL을 자동 탐색하는 도구이기 때문에 기능보다 먼저 실행 경계를 두었습니다.

- HTTPS target만 허용
- URL credential / custom port 거부
- private / loopback / link-local / 비공개 주소 범위 거부
- 브라우저 요청 재검증으로 DNS rebinding / SSRF 위험 완화
- same-origin bounded exploration
- logout / delete / checkout / payment 등 위험한 GET navigation 회피
- generic explorer에서 form/button 제출 제한
- scan concurrency 제한
- job TTL 및 scan 생성 rate limit
- AI는 명시적으로 설정하지 않으면 비활성

보안 관련 출력은 기본적인 launch-risk signal 범위로 제한됩니다.

**VibeCheck는 침투 테스트나 전문 보안 진단을 대체하지 않습니다.**

---

## 9. Tech stack

| Area | Stack |
| --- | --- |
| Runtime | Node.js 22+ |
| Browser automation | Playwright |
| QA evidence | Network · Console · Screenshot · Assertion |
| Job processing | Persistent local job state / recovery |
| Report | Web result · Share · HTML · JSON |
| AI discovery | Groq / Gemini / OpenAI-compatible — optional |
| Safety | URL validation · SSRF guard · bounded exploration |

---

## 10. Run locally

Requirements:

- Node.js 22+
- Playwright-compatible browser
- Windows QA lane에서는 설치된 Microsoft Edge 사용 가능

```bash
npm install
npm run web
```

기본 주소:

```text
http://127.0.0.1:8787
```

완료 job 저장 위치:

```text
artifacts/web/jobs.json
```

설정 가능한 제한값은 `.env.example`을 참고하세요.

---

## 11. Optional AI Deep Scan

Quick Scan은 기본적으로 모델 없이 동작합니다.

Groq discovery 경로:

```text
GROQ_API_KEY=...
```

기본 adaptive order:

1. `openai/gpt-oss-120b`
2. `llama-3.3-70b-versatile`
3. `qwen/qwen3.6-27b`

독립 provider fallback:

```text
GEMINI_API_KEY=...
```

모델 호출 전에는 public-site snapshot을 bounded / truncated 처리하고 secret-like field와 text를 redaction합니다. 여러 모델이 제안한 candidate는 overlap을 기준으로 중복 제거합니다.

Legacy OpenAI-compatible 설정도 지원합니다.

```text
VIBECHECK_AI_BASE_URL=https://provider.example/v1/
VIBECHECK_AI_API_KEY=...
VIBECHECK_AI_MODEL=...
```

---

## 12. Verification & benchmark

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

Generic real-site shadow QA:

```bash
node src/shadow/run-generic.js https://example.com https://www.wikipedia.org
```

benchmark ground truth는 scanner가 직접 import하지 않도록 분리되어 있습니다.

---

## 13. Limitations

- 모든 비즈니스 로직의 정확성을 자동으로 증명하는 도구가 아닙니다.
- 인증이 필요한 복잡한 사용자 여정은 별도 시나리오 정의가 필요할 수 있습니다.
- generic explorer는 안전을 위해 destructive interaction을 적극적으로 수행하지 않습니다.
- AI discovery는 후보 탐색을 확장할 뿐, deterministic evidence를 대체하지 않습니다.
- 전문적인 보안 취약점 진단 범위는 포함하지 않습니다.

---

## 14. What I learned

이 프로젝트에서 가장 크게 배운 점은 **AI를 더 많이 넣는 것이 항상 신뢰성을 높이지는 않는다는 것**이었습니다.

QA에서는 오히려 다음 분리가 중요했습니다.

```text
Discovery ≠ Verification
Observation ≠ Confirmation
One run ≠ Reproducibility
AI confidence ≠ Evidence
```

그래서 VibeCheck는 LLM을 중심에 두기보다 **실행 가능한 브라우저, 증거, 반복 재현성**을 중심에 두고 AI는 필요한 지점에만 제한적으로 사용하는 방향으로 설계했습니다.

---

<div align="center">

**Build fast. Verify with evidence.**

</div>
