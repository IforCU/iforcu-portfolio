# AutoQA 프로젝트 포트폴리오

> **AI 기반 웹 QA 자동화 SaaS** | 2026.04 ~ 2026.05 | 팀 6인

---

## 프로젝트 개요

**AutoQA**는 사용자가 테스트 대상 URL과 자연어 요구사항을 입력하면 웹 페이지를 자동으로 탐색·분석하고, AI가 생성한 QA 시나리오를 실제 브라우저에서 실행하여 결과 리포트까지 제공하는 웹 QA 자동화 서비스입니다.

기존 E2E 테스트는 테스트 코드 작성과 유지보수 비용이 크고, UI가 바뀌면 selector가 쉽게 깨지는 문제가 있습니다. AutoQA는 Playwright 분석 엔진이 페이지 구조와 사용자 행동 후보를 수집하고, AI가 이를 시나리오 JSON으로 변환하며, 실행 엔진이 실제 Chromium에서 검증하는 파이프라인으로 이 과정을 자동화했습니다.

분석·AI 추론·실행·결과 처리는 비동기 워커로 분리했고, 분석 진행 상태와 실행 증적은 WebSocket 이벤트와 S3 presigned URL을 통해 실시간으로 확인할 수 있도록 구성했습니다.

| 항목 | 내용 |
|---|---|
| 플랫폼 | Web SaaS (React + Spring Boot + Node.js/Playwright + FastAPI/vLLM) |
| 담당 영역 | Playwright 웹 분석 엔진 · QA 실행 엔진 · AWS 인프라 · CI/CD |
| 핵심 기술 | Playwright, Node.js, AWS ECS/SQS/S3, Terraform, Jenkins, Redis, WebSocket |
| AI 연동 | 분석 데이터를 구조화하여 Qwen3 기반 QA 시나리오 생성 파이프라인에 전달 |

---

## 담당 역할 요약

```
사용자 URL 입력
      ↓
Playwright 웹 분석 크롤 엔진
  - 페이지 그래프 탐색
  - DOM/action candidate 추출
  - 인증 페이지 분석
      ↓
AI 입력 JSON / functionalPaths / Codegen 학습 데이터 구성
      ↓
AI QA 시나리오 생성
      ↓
Playwright QA 실행 엔진
  - step 실행 및 assertion
  - self-healing locator
  - 스크린샷/동영상 증적
      ↓
S3 Artifact + Redis/WebSocket 실시간 이벤트 + 결과 리포트

인프라 전반: Terraform 기반 AWS 구성 + Jenkins CI/CD + 운영 Shell Script
```

| 영역 | 주요 내용 |
|---|---|
| **웹 분석 엔진** | URL 기반 크롤, DOM 구조 분석, 기능 후보 및 기능 경로 추출, 익명/인증 모드 분석 |
| **QA 실행 엔진** | JSON 시나리오 실행, action/assertion 처리, locator 복구, 실행 결과 리포트 |
| **실시간 증적** | 분석 페이지 스크린샷 즉시 업로드, 실행 스크린샷/동영상 산출물, 상태 이벤트 연계 |
| **AI 데이터 연계** | 분석 결과 규격화, `functionalPaths`, Raw DSL, Codegen 학습 샘플 구성 |
| **AWS 인프라** | ECS Worker, SQS, S3, ECR, RDS, IAM, CloudWatch 등 Terraform 구성 |
| **배포 자동화** | Jenkins 배포 파이프라인, Docker/ECR/ECS 배포, 운영 자동화 스크립트 |

---

## 1. 전체 서비스 아키텍처

### 1-1. 비동기 QA 파이프라인

웹 분석, AI 시나리오 생성, QA 실행은 각각 처리 시간과 실행 환경이 다릅니다. 특히 브라우저 자동화와 GPU 추론은 API 요청 안에서 동기적으로 처리하기 어렵기 때문에, 작업 단계를 메시지 기반으로 분리했습니다.

```
[Frontend]
  URL / 자연어 요구사항 입력
        ↓ REST API
[Spring Boot Backend]
  작업 생성 및 상태 관리
        ↓ SQS analyze queue
[Playwright Worker - ECS Fargate]
  페이지 탐색 / DOM 분석 / S3 산출물 저장
        ↓ SQS AI queue
[AI Worker - GPU 환경]
  QA 시나리오 JSON 생성
        ↓ SQS execute queue
[Playwright Worker - ECS Fargate]
  브라우저 E2E 실행 / 리포트 생성
        ↓
[S3 Artifact + Backend 결과 반영]

진행 이벤트: Worker → Redis Pub/Sub → Backend WebSocket → Frontend
```

### 1-2. 설계 의도

| 설계 포인트 | 적용 내용 | 목적 |
|---|---|---|
| 단계별 Worker 분리 | 분석·AI·실행 작업을 큐 기반으로 전달 | 브라우저 작업과 GPU 작업의 독립 확장 |
| Artifact 중심 전달 | JSON, 스크린샷, 동영상을 S3에 저장 | 대용량 산출물의 안정적인 전달 |
| 실시간 이벤트 분리 | 진행 상태는 Redis/WebSocket으로 전달 | 장시간 작업 중 사용자 가시성 확보 |
| Zero-idle 운영 | 유휴 시 Worker를 축소하고 필요 시 예열 | 운영 비용과 첫 응답 시간의 균형 |

---

## 2. Playwright 웹 분석 크롤 엔진

### 2-1. 페이지 탐색 및 분석 산출물 생성

**주요 코드 영역**: `playwright/src/core/qa-analysis/`

Home URL을 기준으로 페이지를 탐색하고, 각 페이지에서 시나리오 생성에 필요한 정보를 수집하는 분석 엔진을 개발했습니다. 단순 HTML 저장이 아니라 AI와 실행 엔진이 재사용할 수 있는 구조화된 산출물을 만드는 데 집중했습니다.

| 기능 | 내용 |
|---|---|
| 페이지 탐색 | 사이트 내부 경로를 중심으로 페이지 그래프를 구성하고 분석 대상 확장 |
| 페이지 제한 | 크롤 최대 페이지 수를 200페이지까지 설정 가능하도록 확장 |
| 화면 증적 | 분석 페이지별 어노테이션 스크린샷 생성 |
| 산출물 | 페이지 summary, action candidate, assertion target, 기능 경로 데이터 생성 |
| 안전성 | 범위 밖 URL, 자동화 차단 화면, 렌더 불안정 상태를 별도 결과로 반환 |

### 2-2. AI 시나리오 생성을 위한 기능 경로 구조화

단순히 클릭 가능한 요소 목록만 제공하면 AI가 사용자 흐름을 이해하기 어렵습니다. 이를 해결하기 위해 분석 대상 요소를 기능 실행 관점으로 정리하는 `functionalPaths` 구조를 추가했습니다.

```
DOM 요소 분석
  → actionCandidates: 클릭/입력/선택 가능한 후보
  → assertionTargets: 결과 확인 대상
  → observed trigger: 실제 클릭 후 URL/화면 변화
  → functionalPaths: "어떤 기능을 어떤 대상에서 수행할 수 있는가" 구조화
  → AI 시나리오 생성 입력
```

`button`, `a`, `input`뿐 아니라 SPA에서 자주 사용되는 카드형 클릭 컨테이너와 커스텀 UI 요소도 탐색 후보로 다루도록 개선했습니다. 이를 통해 정적 링크만으로는 발견하기 어려운 사용자 행동 흐름까지 시나리오 생성 데이터에 반영할 수 있었습니다.

### 2-3. 렌더링 안정성 및 분석 실패 대응

SPA 페이지는 `networkidle`만으로 분석 시작 시점을 판정하면 skeleton UI 또는 전환 중인 DOM을 수집할 수 있습니다. 페이지 준비 상태를 여러 신호로 판단하는 `renderReadinessChecker`를 추가하고, 인증 리다이렉트 뒤 `page.evaluate()`가 연속 실패하는 경우 CDP 기반 스냅샷으로 조기에 전환하는 경로를 보강했습니다.

| 발생 가능 문제 | 처리 방식 |
|---|---|
| 페이지 콘텐츠 렌더 전 분석 시작 | readiness 검사 후 분석 수행 |
| SPA/SSR 네비게이션 중 JS context 변경 | 분석 안정화 및 CDP snapshot fallback |
| 도메인 범위 밖으로 이동 | `stopped_out_of_scope` / `stopped_redirect_out_of_scope` 상태 반환 |
| CAPTCHA 또는 자동화 차단 | `manual_verification_required` 상태와 증적 반환 |

---

## 3. 인증 페이지 분석과 세션 재사용

### 3-1. 익명/인증 이중 크롤

로그인 이전 화면만 분석해서는 마이페이지, 리포트 상세, 설정 화면 등 인증 후 기능에 대한 QA 시나리오를 만들 수 없습니다. 이를 위해 분석 엔진에 익명 모드와 인증 모드를 분리하여 지원했습니다.

```
익명 크롤
  → 로그인 필요 영역 또는 인증 힌트 확인
  → authFlow를 통한 로그인 자동화
  → storageState 생성
  → 인증 컨텍스트에서 추가 페이지 분석
  → authMode가 포함된 분석 산출물 생성
```

### 3-2. 분석 세션을 QA 실행에 재사용

분석 단계에서 로그인에 성공했더라도 실행 단계에서 다시 로그인을 반복하면 CAPTCHA, 세션 불일치, 인증 흐름 차이로 인해 테스트가 불안정해질 수 있습니다. Playwright의 `storageState`를 분석 결과와 함께 보관하고, `authMode=authenticated` 시나리오 실행 시에만 동일 세션을 적용하도록 구현했습니다.

| 항목 | 처리 |
|---|---|
| 저장 대상 | 로그인 후 세션 상태(`storageState`) |
| 재사용 위치 | 인증 분석 컨텍스트 및 인증 QA 시나리오 실행 컨텍스트 |
| 보안 고려 | 실제 credential 값은 분석 로그·산출물에 기록하지 않음 |
| 실행 효과 | 분석 시점과 실행 시점의 인증 조건 일치 |

---

## 4. Playwright QA 실행 엔진

### 4-1. JSON 시나리오 기반 실제 브라우저 실행

**주요 코드 영역**: `playwright/src/core/qa-execution/`

AI가 생성한 QA 시나리오 JSON을 Playwright action으로 변환해 실제 Chromium 브라우저에서 실행하는 엔진을 구현했습니다. 시나리오별로 독립 context를 사용하면서, 같은 시나리오 안의 step은 동일 페이지 흐름을 이어가도록 구성했습니다.

| Step 분류 | 예시 |
|---|---|
| 이동 | `goto`, URL 이동 검증 |
| 입력 | `fill`, `select`, `check`, 키 입력 |
| 행동 | `click`, scroll, popup 처리 |
| 검증 | text/value/attribute/URL/상태 assertion |
| 증적 | screenshot, video, cookie/localStorage/sessionStorage capture |

### 4-2. 오류 검증용 커스텀 Matcher

화면 상에서 동작이 완료되어도 내부적으로 JavaScript 오류 또는 API 실패가 발생하면 품질 문제로 이어집니다. 실행 telemetry에 축적된 오류를 assertion에서 검증할 수 있도록 matcher를 추가했습니다.

| Matcher | 검증 내용 |
|---|---|
| `toHaveNoConsoleErrors` | 실행 중 발생한 `console.error` 검증 |
| `toHaveNoNetworkErrors` | 실행 중 발생한 네트워크 오류 응답 검증 |

이를 통해 단순 UI 성공 여부만 확인하는 테스트에서 벗어나, 화면과 내부 오류를 함께 검증하는 QA 실행 흐름을 만들었습니다.

### 4-3. Self-Healing Locator

분석 당시 수집한 selector는 배포 후 CSS 클래스나 UI 구조가 변경되면 무효화될 수 있습니다. 기존 locator 해석이 실패하면 현재 DOM을 다시 확인하고 요소 특징을 기반으로 대안을 선택하는 self-healing 경로를 추가했습니다.

```
analysisRef 기반 대상 탐색
  → locator fallback
  → iframe 내부 탐색
  → 실패 시 self-healing
       - text
       - aria-label
       - placeholder
       - role
       - tag 정보
     를 비교하여 대체 locator 선택
```

이 구조를 통해 UI가 일부 변경되어도 시나리오 의도에 맞는 대상을 다시 찾을 수 있는 복구 경로를 마련했습니다.

### 4-4. URL 비교 및 클릭 네비게이션 안정화

한글 또는 비ASCII 경로가 포함된 URL은 브라우저 반환값에서 percent-encoding 형태로 표현될 수 있어, 문자열 단순 비교 시 정상 이동을 실패로 판정할 수 있었습니다. URL 비교 유틸을 추가해 `href` assertion의 encoding 차이를 처리했습니다.

또한 클릭 이후 페이지 이동 검사에는 지수 backoff 재시도를 적용하여 SPA 방식의 비동기 URL 변화에 대응했습니다.

---

## 5. 실시간 증적 및 결과 리포트

### 5-1. 페이지 분석 스크린샷 즉시 제공

초기 방식에서는 전체 분석이 끝난 후에야 산출물을 확인할 수 있어, 여러 페이지를 분석하는 동안 사용자가 진행 상황을 판단하기 어려웠습니다.

페이지 분석이 완료될 때마다 스크린샷을 즉시 S3에 업로드하고 `screenshotPresignedUrl`을 실시간 이벤트에 포함하도록 변경했습니다.

```
페이지 분석 완료
  → 어노테이션 스크린샷 생성
  → S3 즉시 업로드
  → presigned URL 생성
  → 분석 페이지 업데이트 이벤트 발행
  → Frontend에서 진행 중 화면 표시
```

### 5-2. QA 실행 증적과 리포트

QA 실행에서는 성공/실패와 무관하게 step별 증적을 확보할 수 있도록 스크린샷 및 동영상 저장 흐름을 구현하고, 이후 업로드 처리를 비동기화하여 실행 과정과 artifact 전송을 분리했습니다.

| 산출물 | 활용 |
|---|---|
| 페이지 스크린샷 | 분석 중 현재 페이지 확인 |
| Step 스크린샷 | 실패 지점 디버깅 및 결과 리포트 |
| 실행 동영상 | 전체 사용자 흐름 검토 |
| Metrics 리포트 | 통과율, flaky 분석, step 소요 시간 확인 |

### 5-3. 크롤 중단 상태의 디버깅 정보

분석이 중단될 때 상태 코드만 반환하면 운영자가 원인을 파악하기 어렵습니다. 중단 케이스별로 한국어 사유와 이탈 URL, 가능한 경우 중단 화면 스크린샷 URL을 반환하도록 개선했습니다.

| 중단 상태 | 의미 | 제공 정보 |
|---|---|---|
| `stopped_out_of_scope` | 최초 요청이 분석 범위를 벗어남 | 사유, `offendingUrl`, 스크린샷 |
| `stopped_redirect_out_of_scope` | 렌더 후 외부 도메인으로 이동 | 사유, `offendingUrl`, 스크린샷 |
| `manual_verification_required` | CAPTCHA 등 자동화 차단 | 사유, 차단 화면 스크린샷 |

---

## 6. AI 입력 데이터 및 Codegen 학습 데이터 연계

AI가 브라우저 원본 DOM 전체를 그대로 처리하도록 하면 데이터가 크고 시나리오 생성에 불필요한 정보가 섞입니다. 분석 엔진에서 실행에 필요한 정보를 선별하고 규격화하여 AI 파이프라인에 전달하도록 구성했습니다.

| 데이터 | 목적 |
|---|---|
| 페이지 Summary | 페이지 기본 정보와 분석 결과 요약 |
| Action Candidates | 실행 가능한 사용자 행동 후보 |
| Assertion Targets | 결과 검증에 활용할 대상 |
| `functionalPaths` | 기능 단위 사용자 흐름 표현 |
| Raw DSL 산출물 | 학습 및 검증을 위한 실행 표현 |
| Codegen 학습 샘플 | 브라우저 동작 기반 시나리오 학습 자료 |

특히 `functionalPaths`를 AI 시나리오 생성에서 우선 활용하도록 계약을 보완하고, Codegen suite 페이지 전환 검증과 학습 샘플 빌더를 추가하여 분석 데이터가 실제 실행 가능한 시나리오로 연결되도록 개선했습니다.

---

## 7. AWS 인프라 및 DevOps

### 7-1. Terraform 기반 AWS 아키텍처

Playwright 브라우저 작업과 AI GPU 추론은 자원 요구량이 다르므로 서로 다른 실행 환경으로 구성했습니다. AWS 리소스는 Terraform으로 정의하여 환경 변경과 재구축을 코드 기반으로 관리했습니다.

```
AWS
├── VPC / Subnet / Security Group
├── RDS PostgreSQL
├── S3 Artifact Bucket
├── SQS Queues (분석 / AI / 실행 / 결과)
├── ECR Repositories
├── ECS Fargate - Playwright Worker
├── GPU Compute - AI Worker
├── IAM / Secrets Manager
└── CloudWatch Log / Dashboard
```

| 리소스 | 역할 |
|---|---|
| ECS Fargate | Playwright 분석·실행 Worker 구동 |
| GPU Worker 환경 | AI 시나리오 생성 모델 추론 |
| SQS | 단계별 비동기 작업 전달 |
| S3 | 분석·실행 결과와 이미지/동영상 Artifact 저장 |
| ECR | 서비스별 Docker 이미지 저장 |
| CloudWatch | 로그 및 운영 상태 확인 |
| IAM / Secrets Manager | 접근 권한과 임시 인증 정보 관리 |

### 7-2. 모델 사양 변경에 대응하는 IaC 운영

AI 모델 실행 환경은 모델 크기와 추론 구성에 따라 GPU instance, task resource, 환경 변수가 변경될 수 있습니다. 실제 개발 과정에서도 AI GPU 사양과 모델 환경 변수가 변경되었습니다.

수동 콘솔 변경 대신 Terraform 변수 및 리소스 정의를 수정하는 방식으로 관리해 다음 효과를 얻었습니다.

- 인스턴스 타입 및 worker 설정 변경 이력을 Git에서 추적
- 신규 환경 생성 시 동일 구성 재현
- Playwright Worker와 AI Worker 설정을 분리하여 변경 영향 범위 제한
- 운영 문서와 코드 설정의 불일치 감소

### 7-3. Playwright Worker 수동 예열

비용 절감을 위해 Worker가 유휴 상태에서 축소되면 첫 요청 시 컨테이너 기동 시간이 사용자 대기 시간에 포함됩니다. 이에 운영자가 데모 또는 집중 사용 시간대에 Worker를 미리 켤 수 있도록 pinned ECS 서비스와 운영 Shell Script를 구현했습니다.

**파일**: `infra/scripts/autoqa-worker-pinned.sh`

| 명령 | 역할 |
|---|---|
| `start` | pinned worker를 활성화하고 예열 모드로 전환 |
| `stop` | pinned worker를 종료하고 자동 확장 모드로 복귀 |
| `status` | 현재 서비스 및 autoscaling 상태 확인 |
| `logs` | 운영 로그 확인 |
| `restart` | 최신 task definition으로 예열 worker 재시작 |

이 방식은 상시 비용을 무조건 지불하는 것이 아니라, 응답 속도가 중요한 시점에만 예열을 선택할 수 있는 운영 장치입니다.

### 7-4. Jenkins CI/CD

서비스별 Docker 이미지를 빌드하고 배포 대상에 맞게 반영하는 Jenkins 파이프라인을 구성했습니다.

```
Git 변경 감지
  → Docker 이미지 빌드
  → Playwright Worker 이미지 ECR Push
  → ECS Task Definition 갱신
  → ECS 서비스 재배포
  → CloudWatch / 실행 상태 점검
```

배포 과정에서 Jenkins 변경 감지 기준, ECR 이미지 정리, 환경 변수 주입, 재배포 절차를 지속적으로 보완하여 브라우저 Worker와 인프라 설정이 함께 배포될 수 있도록 관리했습니다.

---

## 8. 기술적 도전과 해결 과정

### 도전 1. 동적 UI에서 의미 있는 DOM 요소를 찾기 어려운 문제

**문제**  
SPA 기반 서비스는 `button`이나 `a`뿐 아니라 카드 컴포넌트, `div onClick`, 커스텀 드롭다운 등 다양한 방식으로 상호작용을 구현합니다. 단순 태그 기반 분석은 실제 기능 경로를 놓쳐 AI 시나리오의 범위를 제한합니다.

**해결**  
DOM 분석 과정에서 클릭·입력·검증 가능성이 있는 요소를 action candidate로 분류하고, 실제 기능 흐름을 나타내는 `functionalPaths`를 생성했습니다. 이후 텍스트 존재만으로 탐색 대상을 고르는 방식에서 클릭 가능한 대상 판단 중심으로 분석 로직을 보완했습니다.

**결과**  
링크 형태가 아닌 SPA 사용자 동작도 AI 시나리오 입력 데이터에 포함할 수 있게 되었고, 분석 데이터가 실제 QA 실행 흐름으로 이어지는 범위를 넓혔습니다.

---

### 도전 2. 인증 후 기능을 분석·실행할 때 세션이 달라지는 문제

**문제**  
분석과 실행이 각각 로그인을 수행하면 동일 시나리오라도 인증 상태가 달라질 수 있으며, 반복 로그인으로 CAPTCHA나 세션 오류가 발생할 수 있습니다.

**해결**  
로그인 자동화 이후 Playwright `storageState`를 생성하고, 인증 모드의 분석 페이지와 QA 실행 시나리오에서 동일 세션을 재사용하도록 구현했습니다.

**결과**  
로그인 이후 전용 영역을 분석할 수 있게 되었으며, 실행 단계에서도 분석 당시의 인증 조건을 이어받을 수 있는 구조를 마련했습니다.

---

### 도전 3. UI 변경 후 기존 selector가 무효화되는 문제

**문제**  
분석 시점의 CSS selector 또는 속성값이 배포 이후 변경되면, 시나리오 의도는 유효하지만 대상 요소를 찾지 못해 실행이 실패합니다.

**해결**  
기존 locator가 실패했을 때 text, aria-label, placeholder, role 등의 특징을 비교하여 현재 DOM에서 대체 요소를 탐색하는 self-healing locator를 추가했습니다.

**결과**  
화면 구조가 일부 달라진 경우에도 실행이 복구될 수 있는 fallback 경로를 확보했고, 시나리오 유지보수 비용을 낮출 수 있는 기반을 만들었습니다.

---

### 도전 4. 긴 분석·실행 작업의 사용자 가시성 부족

**문제**  
전체 작업이 끝난 뒤 결과를 보여주는 방식에서는 사용자가 진행 상황과 실패 지점을 즉시 알 수 없습니다.

**해결**  
페이지 분석 직후 스크린샷을 S3에 업로드하고 presigned URL을 실시간 이벤트로 전달했습니다. 또한 크롤 중단 이벤트에는 한국어 사유, 이탈 URL, 중단 화면 증적을 포함하도록 개선했습니다.

**결과**  
사용자는 QA 파이프라인 진행 상태와 문제 화면을 실시간으로 확인할 수 있게 되었고, 운영 중 디버깅에 필요한 단서를 결과와 함께 확보할 수 있게 되었습니다.

---

### 도전 5. GPU 모델 요구사항 변경과 Worker 콜드 스타트

**문제**  
AI 추론 모델의 실행 사양이 변경될 때마다 GPU 환경 설정이 바뀌었고, 비용 절감을 위한 유휴 축소 정책은 첫 요청 시 Worker 기동 지연을 유발할 수 있었습니다.

**해결**  
Terraform으로 GPU/Playwright Worker 구성을 코드화하고, Playwright Worker에는 수동 예열용 pinned ECS 서비스와 운영 스크립트를 추가했습니다.

**결과**  
인프라 변경을 반복 가능한 코드 변경으로 관리할 수 있게 되었고, 비용을 고려하면서도 데모나 집중 사용 시점에는 첫 요청 대기 시간을 줄일 수 있는 운영 수단을 확보했습니다.

---

## 9. 대표 구현 이력

| 날짜 | 구현 내용 |
|---|---|
| 2026-04-27 | AWS 인프라 Terraform, Jenkins CI/CD, EC2 Setup 구성 |
| 2026-04-29 | Playwright 분석 산출물 규격화 및 분석 크롤 안정성 강화 |
| 2026-05-06 | S3 크롤 그래프 artifact 및 실시간 이벤트 퍼블리셔 연계 |
| 2026-05-08 | Playwright Worker pinned ECS 서비스 및 운영 스크립트 추가 |
| 2026-05-11 | 분석 페이지 스크린샷 즉시 업로드, console/network matcher 추가 |
| 2026-05-12 | 데이터드리븐 실행 및 flow 재사용, adaptive locator 개선 |
| 2026-05-14 | self-healing locator, 품질 지표 리포트, 인증 크롤 및 `storageState` 재사용 |
| 2026-05-17 | 크롤 중단 이벤트에 스크린샷·이탈 URL·한국어 사유 추가 |
| 2026-05-19 | 실시간 업로드와 동적 탐색 로직 보완 |
| 2026-05-22 | Raw DSL, Codegen 학습 샘플, 실행 호환성 개선 |

---

## 10. 기술 스택 요약

| 분류 | 기술 |
|---|---|
| **웹 분석 / QA 실행** | Node.js 20, Express, Playwright (Chromium) |
| **Backend 연동** | Java 21, Spring Boot 3.4, Redis, WebSocket |
| **AI Pipeline 연동** | Python, FastAPI, vLLM, Qwen3-8B |
| **Frontend** | React, TypeScript, Vite, TailwindCSS, Zustand |
| **데이터베이스** | PostgreSQL (AWS RDS), Redis |
| **AWS** | ECS Fargate, EC2 GPU, SQS, S3, ECR, RDS, IAM, Secrets Manager, CloudWatch, VPC |
| **IaC / 배포** | Terraform, Jenkins, Docker, Nginx |

---

## 11. 성과 및 배운 점

- Playwright를 단순 테스트 도구가 아니라 **웹 분석 → AI 입력 생성 → 실제 실행 → 결과 증적**을 연결하는 자동화 엔진으로 확장했습니다.
- 동적 DOM 탐색, 인증 세션 재사용, self-healing locator를 구현하며 실제 서비스 UI를 안정적으로 자동화하기 위한 설계 경험을 쌓았습니다.
- SQS 기반 비동기 처리와 S3/WebSocket 기반 실시간 증적 전달을 연결하며 장시간 작업의 상태 가시성과 디버깅 가능성을 고려한 시스템을 설계했습니다.
- Terraform과 Jenkins로 AWS 인프라와 배포 흐름을 관리하며, 모델·브라우저 실행 환경이 바뀌어도 재현 가능한 운영 기반을 구축했습니다.
- 비용 절감을 위한 scale-down 구조와 첫 응답 지연을 줄이기 위한 pinned worker 예열을 함께 설계하며 운영 비용과 사용자 경험 사이의 trade-off를 다뤘습니다.

---

## 12. 자기소개서 활용 문구

### Playwright 자동화 엔진 개발 경험

> AI 기반 웹 QA 자동화 서비스에서 Playwright 웹 분석 및 실행 엔진을 담당했습니다. 사용자 URL을 기반으로 페이지를 탐색하고 DOM에서 실제 사용자 행동에 연결되는 요소를 추출하여 AI 입력용 `functionalPaths`로 구조화했으며, AI가 생성한 JSON 시나리오를 실제 Chromium 환경에서 실행하는 엔진을 구현했습니다. 로그인 이후 기능까지 분석할 수 있도록 `storageState` 기반 인증 세션 재사용 구조를 적용하고, UI 변경으로 locator가 무효화되는 문제에는 self-healing locator를 도입하여 실행 복원력을 높였습니다.

### 실시간 결과 및 운영 가시성 개선 경험

> 웹 분석과 QA 실행이 장시간 진행될 때 사용자가 결과를 기다리기만 해야 하는 문제를 해결하기 위해, 페이지 분석 직후 스크린샷을 S3에 즉시 업로드하고 presigned URL을 실시간 이벤트로 제공하는 구조를 구현했습니다. 또한 크롤 중단 시 한국어 사유, 이탈 URL, 문제 화면 증적을 함께 반환하여 운영 환경에서 실패 원인을 빠르게 파악할 수 있도록 개선했습니다.

### AWS 인프라 및 DevOps 경험

> Playwright Worker와 AI GPU Worker가 함께 동작하는 AWS 아키텍처를 설계하고, ECS, SQS, S3, ECR, RDS, IAM, CloudWatch 등의 리소스를 Terraform으로 코드화했습니다. Jenkins를 활용해 Docker 이미지 빌드부터 ECR 배포, ECS 서비스 갱신까지 자동화했으며, 비용 절감을 위한 유휴 축소 구조에서 첫 요청 지연을 완화하기 위해 pinned ECS worker와 운영 Shell Script를 구현했습니다. 이를 통해 변경이 잦은 실행 환경에서도 재현 가능하고 운영 가능한 배포 체계를 구축하는 경험을 쌓았습니다.

