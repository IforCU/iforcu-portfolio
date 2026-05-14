# Re:Flow 프로젝트 포트폴리오

> **블록체인 기반 투명 기부 플랫폼** | 2026.02.19 ~ 2026.04.03 | 팀 6인

---

## 프로젝트 개요

**Re:Flow**는 이더리움 호환 블록체인을 활용해 기부금 흐름 전체를 온체인에 기록하는 투명 기부 플랫폼입니다.
기부자(Donor)가 원화로 기부 토큰(DNT)을 구매하면, 수혜자(Beneficiary)는 해당 토큰으로 제휴 상점에서 물품을 구매할 수 있습니다.
모든 기부·결제·정산 내역이 스마트 컨트랙트에 투명하게 기록되어 기부금 유용을 구조적으로 방지합니다.

| 항목 | 내용 |
|---|---|
| 플랫폼 | Web (React + Spring Boot + Hardhat + FastAPI) |
| 담당 영역 | 블록체인 스마트 컨트랙트 · 블록체인 백엔드 API · 서버 인프라 |
| 사용 기술 | Solidity, Hardhat, Web3j, Spring Boot, Docker, Traefik, Jenkins |

---

## 담당 역할 요약

```
블록체인 스마트 컨트랙트 설계 & 구현
      ↕ (Web3j RPC 연동)
Spring Boot 블록체인 내부 API 개발 (22개 엔드포인트)
      ↕
EC2 서버 인프라 구축 (Docker Compose + Traefik + Jenkins CI/CD)
```

---

## 1. 블록체인 스마트 컨트랙트

### 1-1. DonationToken (ERC-20)

**파일**: `blockchain/contracts/DonationToken.sol`

기부 생태계 전용 ERC-20 토큰을 설계했습니다.

| 설계 포인트 | 내용 |
|---|---|
| decimals = 3 | 1,000원 = 1.000 DNT로 원화와 1:1 매핑. 500원 결제 시 0.500 DNT로 소수점 분할 지원 |
| mint / burn | 플랫폼 컨트랙트(owner)만 발행·소각 가능 — 무제한 발행 방지 |
| transferByAdmin | 수탁형(custodial) 지갑 환경에서 플랫폼이 사용자 대신 토큰을 이동 |
| Ownable | DonationToken 소유권을 배포 즉시 DonationPlatform 컨트랙트로 이전 → 권한 집중 방지 |

```solidity
// 1 토큰 = 1,000원. 소수점 3자리로 원화 단위 1:1 표현
function decimals() public pure override returns (uint8) { return 3; }
```

---

### 1-2. DonationPlatform (핵심 플랫폼 컨트랙트)

**파일**: `blockchain/contracts/DonationPlatform.sol`

기부·배분·결제·정산의 전체 비즈니스 로직을 온체인에서 실행하는 핵심 컨트랙트입니다.

#### 역할 기반 접근 제어

사용자를 `DONOR / BENEFICIARY / STORE / PLATFORM` 4가지 역할로 구분하고 `onlyPlatform`, `onlyRole` 수정자로 함수 호출 권한을 제한했습니다.

```solidity
enum Role { NONE, DONOR, BENEFICIARY, STORE, PLATFORM }
modifier onlyPlatform() {
    require(msg.sender == platformAdmin || roles[msg.sender] == Role.PLATFORM, "Unauthorized");
    _;
}
```

#### 지역 풀(Region Pool) 메커니즘

법정동 코드 기반 지역 ID로 기부금을 분리 관리합니다.
`minThreshold`(최소 모집액) 미달 시 해당 금액을 이월(carryOver)하여 다음 회차에 합산하는 방식으로 소액 분산 기부도 실질적으로 집행되도록 설계했습니다.

```
기부 확정(CONFIRMED) → 지역 풀 누적 → 임계치 달성 확인
→ collectRegionFunds (잠금)
→ distributeChunk (청크 단위 수혜자 분배) × N회
→ finalizeDistribution (완료 처리)
```

#### 3단계 청크 분배 설계

수혜자 수가 많을 때 단일 트랜잭션 gas limit 초과 문제를 방지하기 위해 분배를 3단계로 나눴습니다.

| 단계 | 함수 | 역할 |
|---|---|---|
| 1단계 | `collectRegionFunds` | 지역 풀 잔액을 잠금(locked) 처리 |
| 2단계 | `distributeChunk` | 수혜자 배열을 청크로 분할해 반복 호출 |
| 3단계 | `finalizeDistribution` | 분배 완료 상태로 전환, 잔여금 환원 |

#### 보안 설계

- `ReentrancyGuard` 상속으로 재진입(reentrancy) 공격 방어
- `PENDING → CONFIRMED → (지역 풀 누적)` 상태 머신으로 이중 확정 방지
- 결제(Spend), 정산(Settlement), 기부(Donation)별 독립 ID 카운터 + 상태 enum

#### 이벤트(Event) 기반 감사 추적

```solidity
event DonatedToRegion(uint256 indexed donationId, address indexed donor, uint256 indexed regionId, uint256 amount);
event RegionDistributed(uint256 indexed regionId, uint256 totalAmount, uint256 perPerson, uint256 leftoverAmount);
event SettlementPaid(uint256 indexed settlementId, address indexed store, uint256 totalAmount);
// ... 총 15개 이벤트
```

모든 주요 상태 변경에 이벤트를 발행하여 오프체인 모니터링 및 감사가 가능하도록 했습니다.

---

### 1-3. 컨트랙트 배포 자동화

**파일**: `blockchain/scripts/deploy.js`, `blockchain/start.sh`

1. `DonationToken` 배포 → `DonationPlatform` 배포 (Token 주소 주입) → Token 소유권 Platform으로 이전
2. 배포 완료 즉시 `backend/.env`, `frontend/.env`에 컨트랙트 주소 자동 기록
3. Docker 컨테이너 기동 시 `start.sh`가 Hardhat 노드 실행 → 컨트랙트 자동 배포를 순서 보장하며 실행

```sh
# start.sh: 노드 준비 확인 후 배포 실행
until wget -qO- --post-data='{"jsonrpc":"2.0","method":"eth_blockNumber"...}' http://localhost:8545; do
  sleep 1
done
npx hardhat run scripts/deploy.js --network localhost
```

Ethereum Sepolia 테스트넷 배포도 지원하며, `hardhat verify`로 Etherscan 소스 검증까지 자동화했습니다.

---

## 2. 백엔드 블록체인 API (Spring Boot + Web3j)

**패키지**: `backend/src/main/java/.../blockchain/`

스마트 컨트랙트의 모든 기능을 REST API로 노출하는 블록체인 내부 API 레이어를 개발했습니다.
총 **22개 엔드포인트**, base URL `/blockchain`.

### 2-1. Web3j 연동 구조

```
BlockchainController (REST)
        ↓ 의존성 주입
BlockchainManagerService (비즈니스 로직)
        ↓ RPC 호출
Web3j → Hardhat 노드 or Sepolia RPC
```

**Web3jConfig.java**: RPC URL과 관리자 개인키로 `Web3j` 빈과 `Credentials` 빈을 구성했습니다.

```java
@Bean
public Web3j web3j() {
    return Web3j.build(new HttpService(rpcUrl));
}
@Bean
public Credentials credentials() {
    return Credentials.create(adminPrivateKey);
}
```

### 2-2. 트랜잭션 전송 공통 유틸

ABI 인코딩 → `RawTransactionManager` 서명 → 브로드캐스트 → 영수증 폴링의 공통 흐름을 `sendAdminTransaction` 메서드로 추상화했습니다.

```java
private String sendAdminTransaction(String contractAddress, Function function) throws Exception {
    String encodedFunction = FunctionEncoder.encode(function);
    EthSendTransaction response = txManager.sendTransaction(gasPrice, gasLimit, contractAddress, encodedFunction, BigInteger.ZERO);
    if (response.hasError()) throw new RuntimeException(response.getError().getMessage());
    return response.getTransactionHash();
}
```

`ethCall`을 통한 무료 읽기와 서명 트랜잭션 쓰기를 분리하여 불필요한 가스 낭비를 방지했습니다.

### 2-3. 수탁형(Custodial) 지갑 관리

사용자가 개인키를 직접 관리하지 않아도 되도록, 서버가 EC 키 쌍을 생성해 DB에 보관하는 수탁형 지갑 모델을 구현했습니다.

```java
public String[] createCustodialWallet() throws Exception {
    ECKeyPair keyPair = Keys.createEcKeyPair();
    String privateKey = "0x" + keyPair.getPrivateKey().toString(16);
    String address    = "0x" + Keys.getAddress(keyPair);
    return new String[]{address, privateKey};
}
```

### 2-4. 주요 API 엔드포인트

| 분류 | Method | Endpoint | 컨트랙트 함수 |
|---|---|---|---|
| 지갑 | POST | `/wallet/create` | 서버 생성 (온체인 X) |
| 지갑 | POST | `/wallet/role` | `setRole` |
| 토큰 | POST | `/mint` | `buyDonationToken` |
| 토큰 | POST | `/refund` | `refundDonorToken` |
| 기부 | POST | `/donate/region` | `donateToRegion` |
| 기부 | POST | `/donate/region/cancel` | `cancelRegionDonation` |
| 기부 | POST | `/donate/region/confirm/batch` | `confirmRegionDonationBatch` |
| 분배 | POST | `/region/collect` | `collectRegionFunds` |
| 분배 | POST | `/region/distribute/chunk` | `distributeChunk` |
| 분배 | POST | `/region/distribute/finalize` | `finalizeDistribution` |
| 결제 | POST | `/spend` | `spendAtStore` |
| 결제 | POST | `/spend/cancel` | `cancelSpend` |
| 정산 | POST | `/settlement/request` | `requestSettlement` |
| 정산 | POST | `/settlement/approve` | `approveSettlement` |
| 정산 | POST | `/settlement` | `paySettlement` |
| 조회 | GET | `/balance/{address}` | `balanceOf` |
| 조회 | GET | `/stats` | 이벤트 로그 집계 |

모든 API에 Swagger(`@Operation`, `@Tag`) 어노테이션을 적용해 자동 문서화했습니다.

---

## 3. 서버 인프라 구축

### 3-1. Docker Compose 멀티 환경 분리

용도별로 Compose 파일을 분리하여 인프라 변경 없이 앱만 재배포하는 전략을 적용했습니다.

| 파일 | 용도 |
|---|---|
| `docker-compose.yml` | 로컬 개발용 (PostgreSQL, Redis, Hardhat, Dozzle) |
| `docker-compose.prod.yml` | 인프라 레이어 (Traefik, DB, Redis, Jenkins, Hardhat) |
| `docker-compose.app.yml` | 앱 레이어 (Backend, Frontend, FDS) — CI/CD가 이 파일만 재배포 |

### 3-2. Traefik v2 리버스 프록시

컨테이너 라벨 기반 동적 라우팅으로 단일 도메인에서 서비스별 경로를 분리했습니다.

```
https://j14a103.p.ssafy.io/        → Frontend (React/Nginx)
https://j14a103.p.ssafy.io/api/*   → Backend (Spring Boot, /api prefix strip)
https://j14a103.p.ssafy.io/ai/*    → FDS (FastAPI, /ai prefix strip)
https://j14a103.p.ssafy.io/rpc     → Hardhat 노드 (블록체인 RPC)
```

추가로 다음 옵저빌리티 기능을 구성했습니다.
- **Prometheus 메트릭**: `--metrics.prometheus=true`, 라우터 레이블 수집 활성화
- **Jaeger 분산 트레이싱**: `--tracing.jaeger` 연동
- **액세스 로그**: JSON 포맷으로 영구 저장 (`/var/log/traefik/access.log`)
- **HTTP → HTTPS 자동 리다이렉트**: `entrypoints.web.http.redirections`
- **TLS**: Let's Encrypt 인증서 파일을 `tls.yml`로 동적 로드

### 3-3. Jenkins CI/CD 파이프라인

**파일**: `Jenkinsfile`

4단계 파이프라인으로 커밋 → 프로덕션 자동 반영 구조를 구현했습니다.

```
Stage 1: Checkout
Stage 2: Build Frontend   (.env.production 환경변수 주입)
Stage 3: Build Backend    (Gradle bootJar -x test)
Stage 4: Deploy           (docker-compose.app.yml up -d --build)
Stage 5: Health Check     (컨테이너 상태 확인)
```

**보안 설계**: 모든 시크릿(DB 비밀번호, JWT, 블록체인 관리자 키 등)은 Jenkins Credentials로 관리하며 파이프라인 실행 시 `.env`로만 주입됩니다. Git에 민감 정보가 노출되지 않습니다.

```groovy
environment {
    BLOCKCHAIN_ADMIN_PRIVATE_KEY = credentials('BLOCKCHAIN_ADMIN_PRIVATE_KEY')
    JWT_SECRET = credentials('JWT_SECRET')
    // ...
}
```

### 3-4. EC2 인프라 구성

AWS EC2 Ubuntu 서버 위에서 다음 스택을 직접 구축했습니다.

```
EC2 Ubuntu
├── Docker Network: s14p21a103_network (컴포즈 간 통신)
├── Traefik (Edge Router, 443/80)
├── PostgreSQL 15 (데이터 영속성 볼륨)
├── Redis 7 (세션 캐시 + appendonly 내구성)
├── Jenkins (Docker-in-Docker, docker.sock 마운트)
├── Hardhat Node (컨트랙트 자동 배포 포함)
├── Dozzle (컨테이너 로그 실시간 뷰어, :8088)
└── Redis Commander (Redis GUI, :8081)
```

---

## 4. 기술적 도전 & 해결 과정

### 도전 1: 대규모 수혜자 분배 시 Gas Limit 초과 문제

**문제**: 수혜자 수가 늘어날수록 단일 `distributeAll` 트랜잭션의 가스 비용이 블록 gas limit을 초과할 수 있었습니다.

**해결**: 분배를 `collectRegionFunds` → `distributeChunk` (반복) → `finalizeDistribution` 3단계로 분리하고, 백엔드가 청크 크기를 조절하며 반복 호출하는 방식으로 임의의 수혜자 수를 처리할 수 있도록 설계했습니다.

---

### 도전 2: Docker 컨테이너 기동 순서 문제

**문제**: Hardhat 노드 컨테이너가 준비되기 전에 컨트랙트 배포 스크립트가 실행되면 배포가 실패했습니다.

**해결**: `start.sh`에서 `wget`으로 `eth_blockNumber` JSON-RPC를 폴링하여 노드가 응답을 반환할 때까지 배포 스크립트 실행을 지연시켰습니다.

---

### 도전 3: 배포 후 컨트랙트 주소 수동 복붙 문제

**문제**: 컨트랙트를 새로 배포할 때마다 백엔드와 프론트엔드의 환경 변수를 수동으로 수정해야 했습니다.

**해결**: `deploy.js`가 배포 완료 즉시 `backend/.env`와 `frontend/.env`를 파싱하여 컨트랙트 주소를 자동으로 업데이트하도록 구현했습니다. Sepolia 테스트넷과 로컬 Hardhat 모두 동일한 스크립트로 처리됩니다.

---

### 도전 4: 수탁형 지갑 보안

**문제**: 일반 사용자가 MetaMask 없이 블록체인 기능을 사용할 수 있어야 했습니다.

**해결**: 서버가 EC 키 쌍을 생성해 개인키를 서버 DB에 보관하는 수탁형 지갑 모델을 도입했습니다. 사용자는 지갑 주소만 알면 되고, 모든 트랜잭션 서명은 백엔드 관리자 Credentials를 통해 처리됩니다.

---

## 5. 기술 스택 요약

| 분류 | 기술 |
|---|---|
| 스마트 컨트랙트 | Solidity 0.8.20, OpenZeppelin (ERC20, ReentrancyGuard, Ownable) |
| 블록체인 개발 도구 | Hardhat, hardhat-ethers, hardhat-etherscan |
| 블록체인 API | Spring Boot 3, Web3j, Java 17 |
| 인프라 | Docker, Docker Compose, Traefik v2 |
| CI/CD | Jenkins (Declarative Pipeline), Docker-in-Docker |
| 데이터베이스 | PostgreSQL 15, Redis 7 |
| 모니터링 | Prometheus, Jaeger, Dozzle |
| 클라우드 | AWS EC2, Let's Encrypt (TLS) |
| 테스트넷 | Ethereum Sepolia (Infura/Alchemy RPC) |

---

## 6. 자기소개서 활용 문구

### 블록체인 컨트랙트 설계 경험

> 이더리움 호환 블록체인 위에서 기부·결제·정산 전체 흐름을 처리하는 스마트 컨트랙트를 설계하고 구현했습니다. ERC-20 토큰을 원화 단위(decimals=3)로 설계해 실물 화폐와 1:1 연동하고, ReentrancyGuard와 역할 기반 접근 제어로 보안을 강화했습니다. 대규모 수혜자 분배 시 gas limit 초과 문제를 3단계 청크 분배 패턴으로 해결했으며, 15개 이벤트로 모든 상태 변경을 온체인에 기록해 투명성을 보장했습니다.

### 백엔드-블록체인 브릿지 API 개발 경험

> Spring Boot와 Web3j를 활용해 스마트 컨트랙트의 22개 기능을 REST API로 노출하는 블록체인 내부 API 레이어를 단독으로 개발했습니다. ABI 인코딩, 트랜잭션 서명, RPC 브로드캐스트, 이벤트 로그 조회까지 Web3j의 저수준 API를 직접 다루며 블록체인과 기존 백엔드를 통합했습니다. 수탁형 지갑 모델을 도입해 사용자 UX를 해치지 않으면서 온체인 기록을 유지했습니다.

### 인프라 구축 경험

> AWS EC2에서 Docker Compose 기반의 멀티 서비스 인프라를 직접 구축했습니다. Traefik v2를 도입해 단일 도메인에서 경로 기반 라우팅, HTTPS 자동화, Prometheus 메트릭 수집, Jaeger 분산 트레이싱을 구성했습니다. Jenkins Declarative Pipeline으로 빌드부터 배포·헬스체크까지 자동화하고, 민감 정보는 Jenkins Credentials로만 관리해 코드베이스에서 시크릿을 완전히 분리했습니다.

---
