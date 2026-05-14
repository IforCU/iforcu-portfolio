# Newstagram 백엔드 포트폴리오 - 인프라 & 시맨틱 검색

> **프로젝트 개요:** AI 기반 뉴스 큐레이션 서비스 백엔드  
> **담당 영역:** 인프라 설계 및 구축 / 시맨틱 검색 & 추천 시스템 개발  
> **기술 스택:** Spring Boot 3, PostgreSQL + pgVector, Redis, Apache Kafka, Docker, OpenAI Embeddings, Komoran NLP

---

## 1. 프로젝트 아키텍처 설계

### 멀티 모듈 MSA 구조

단일 서버로 처리하기 어려운 뉴스 수집 · API 서빙 · 로깅을 독립 모듈로 분리하여 각 서비스가 독립적으로 배포·스케일링 가능한 구조를 설계했습니다.

```
newstagram (root)
├── api-server       (Port 8080) — REST API, 검색, 추천, 인증
├── rss-collector    (Port 8082) — RSS 수집, 벡터화, 클러스터링
├── logging-server   (Port 8081) — Kafka 기반 비동기 로그 처리
└── newstagram-domain            — 공유 JPA 엔티티, pgVector 도메인
```

**핵심 설계 의도:**
- `rss-collector`는 대규모 배치·임베딩 연산을 독립 실행하여 API 서버 성능에 영향 없음
- `logging-server`는 Kafka 컨슈머로 로그를 비동기 처리하여 API 응답 지연 없음
- `newstagram-domain`을 라이브러리로 분리하여 JPA 엔티티 중복 방지

---

## 2. 인프라 구축

### 2-1. Docker 기반 로컬/운영 환경 통일

세 개 서버 모두 **동일한 멀티스테이지 Dockerfile 패턴**으로 이미지를 최소화했습니다.

```dockerfile
# Stage 1: Build
FROM eclipse-temurin:17-jdk-alpine AS builder
WORKDIR /workspace
COPY . .
RUN ./gradlew :api-server:bootJar -x test --no-daemon

# Stage 2: Runtime (경량 JRE 이미지)
FROM eclipse-temurin:17-jre-alpine
COPY --from=builder /workspace/api-server/build/libs/*.jar app.jar
ENTRYPOINT ["java", "-jar", "/app.jar"]
```

**효과:** 빌드 의존성을 런타임 이미지에서 제거, 최종 이미지 크기 최소화

---

### 2-2. Docker Compose 인프라 스택

PostgreSQL + Redis + Kafka를 단일 `docker-compose.yml`로 관리하며 헬스체크와 볼륨 마운트를 포함했습니다.

| 서비스 | 이미지 | 포트 | 특징 |
|--------|--------|------|------|
| PostgreSQL | postgres:16 | 5432 | pgVector 확장 활성화 |
| Redis | redis:7-alpine | 6379 | Lettuce 커넥션 풀 (max 10) |
| Kafka | apache/kafka:4.1.1 | 9092/9094 | KRaft 모드 (Zookeeper 불필요) |

```yaml
# Kafka - KRaft 모드 설정 핵심
KAFKA_PROCESS_ROLES: broker,controller
KAFKA_CONTROLLER_QUORUM_VOTERS: 1@kafka:9093
KAFKA_LISTENERS: PLAINTEXT://:9092,CONTROLLER://:9093,EXTERNAL://:9094
```

- **Zookeeper 제거:** Kafka 4.x KRaft 모드 적용으로 인프라 단순화
- **헬스체크:** 각 서비스에 healthcheck 설정으로 의존 서비스 기동 순서 보장

---

### 2-3. 운영 환경 보안 설정 (application-prod.properties)

```properties
# Redis SSL 활성화
spring.data.redis.ssl.enabled=true

# Kafka SASL/SSL 인증
spring.kafka.properties.security.protocol=SASL_SSL
spring.kafka.properties.sasl.mechanism=PLAIN

# RDS PostgreSQL 엔드포인트
spring.datasource.url=jdbc:postgresql://${RDS_ENDPOINT}:5432/${DB_NAME}

# 리버스 프록시 헤더 처리
server.forward-headers-strategy=framework
```

로컬(dev)과 운영(prod) 설정을 Spring Profile로 완전히 분리하여 민감 정보는 환경변수로만 주입됩니다.

---

## 3. 시맨틱 검색 시스템

### 3-1. 전체 파이프라인 개요

```
[사용자 자연어 쿼리]
        ↓
[Komoran 형태소 분석 → 키워드 추출 + 기간 파싱]
        ↓
[OpenAI 쿼리 임베딩 (text-embedding-3-small)]
        ↓
[GPT-4o-mini 카테고리 분류]
        ↓
[pgVector 코사인 유사도 검색 (threshold < 0.80)]
        ↓
[키워드 In-memory 필터링 → 정렬 → 페이지네이션]
        ↓
[결과 반환 (Redis 캐시)]
```

---

### 3-2. 의미 기반 뉴스 검색 파이프라인

한국어 자연어 쿼리를 처리하는 다단계 검색 파이프라인을 구현했습니다.

#### 검색 흐름 예시

```
입력: "요즘 KBO에서 기아 타이거즈 관련한 소식이 궁금해"

Step 1. [의도 분석 - Komoran NLP]
  Komoran 형태소 분석 → 명사 추출: ["KBO", "기아", "타이거즈"]
  "요즘" 감지 → dateRange = 7일
  불용어 제거: ["뉴스", "기사", "관련", "소식"] 필터링
  → 정제된 쿼리: "기아 타이거즈", 기간: 7일

Step 2. [쿼리 임베딩 - text-embedding-3-small]
  GMS API 호출 → 1536D 벡터 생성
  @Cacheable("search_results") — 동일 쿼리 재호출 시 캐시 반환

Step 3. [LLM 카테고리 분석 - gpt-4o-mini]
  카테고리 추론 → ["스포츠", "야구"] → categoryIds 필터 조건 생성

Step 4. [pgVector 유사도 검색]
  SELECT * FROM articles
  WHERE embedding <=> CAST(? AS vector) < 0.80  ← 임계값 필터
    AND category_id IN (?)                        ← 카테고리 필터
    AND published_at >= NOW() - INTERVAL '7 days' ← 기간 필터
  ORDER BY embedding <=> CAST(? AS vector)
  LIMIT 800

Step 5. [키워드 필터링 (In-memory)]
  title/description에 ["기아", "타이거즈"] 포함 여부 검사
  → 의미적으로는 가깝지만 키워드가 없는 결과 제거

Step 6. [정렬 + 페이지네이션]
  publishedAt DESC 정렬 → page*limit offset skip → 반환
```

#### 검색 최적화 전략

| 최적화 | 구현 방법 | 효과 |
|--------|-----------|------|
| 쿼리 캐싱 | `@Cacheable("search_results")` — 쿼리+페이지+임계값 조합키 | 동일 검색 재실행 시 임베딩 API 호출 없음 |
| 임계값 필터 | 코사인 거리 < 0.80 으로 관련 없는 결과 선제 차단 | 후처리 부하 감소 |
| 상위 800개 제한 | pgVector에서 최대 800개만 추출 후 In-memory 처리 | DB 부하와 메모리 균형 |
| 성능 로깅 | 각 단계별 ms 측정 로그 | 병목 지점 파악 가능 |

---

## 4. 데이터베이스 스키마 설계

### pgVector 활용

```sql
-- articles 테이블: 벡터 유사도 검색에 활용
embedding vector(1536)  -- OpenAI text-embedding-3-large 기준

-- 코사인 유사도 검색 인덱스 (IVFFlat)
CREATE INDEX ON articles USING ivfflat (embedding vector_cosine_ops);
```

검색 쿼리 임베딩과 기사 임베딩 간의 코사인 거리(`<=>` 연산자)로 의미적으로 유사한 기사를 O(log n) 수준에서 검색합니다.

---

## 5. 성과 및 기술적 도전 과제

### 해결한 문제들

**① 한국어 자연어 검색 의도 파악**
- 문제: "요즘", "최근" 같은 시간 표현이나 불용어를 그대로 임베딩하면 검색 품질 저하
- 해결: Komoran 형태소 분석기로 명사 추출 + 시간 표현(요즘→7일, 최근→3일) 파싱 + 불용어 사전 필터링

**② 의미 검색과 키워드 검색의 한계 보완**
- 문제: pgVector 유사도 검색만 쓰면 키워드가 없는 관련 없는 결과가 포함됨, 반대로 키워드 검색만 쓰면 동의어·문맥 파악 불가
- 해결: pgVector로 의미 유사 후보 800개 추출 → In-memory 키워드 필터로 이중 검증하는 하이브리드 파이프라인 구성

**③ 반복 검색 비용 및 응답 속도**
- 문제: 동일 쿼리마다 임베딩 API를 재호출하면 비용·지연 발생
- 해결: `@Cacheable("search_results")`로 쿼리+페이지+임계값 조합키를 Redis에 캐싱, 재호출 시 API 없이 즉시 반환

**④ 로컬 ↔ 운영 환경 설정 불일치**
- 문제: 개발 중 민감 정보가 코드에 노출될 위험
- 해결: Spring Profile(dev/prod) 분리 + 민감 값은 전부 환경변수로만 주입, 운영 시 Redis SSL·Kafka SASL 자동 활성화

---

## 6. 기술 스택 요약

| 분류 | 기술 |
|------|------|
| **언어 / 프레임워크** | Java 17, Spring Boot 3.5 |
| **데이터베이스** | PostgreSQL 16 + pgVector |
| **캐시** | Redis 7 (Lettuce), Spring Cache |
| **메시지 큐** | Apache Kafka 4.1 (KRaft) |
| **AI / 임베딩** | OpenAI text-embedding-3-small, GPT-4o-mini |
| **NLP** | Komoran (한국어 형태소 분석기) |
| **인프라** | Docker, Docker Compose, 멀티스테이지 빌드 |
| **빌드** | Gradle 멀티 모듈 |

---

## 7. 자기소개서 활용 문구 예시

### 인프라 관련

> "Docker Compose 기반으로 PostgreSQL(pgVector), Redis, Apache Kafka를 하나의 환경에서 관리하고, 멀티스테이지 Docker 빌드로 경량 런타임 이미지를 구성했습니다. Kafka 4.x의 KRaft 모드를 도입하여 Zookeeper 의존성을 제거하고 인프라를 단순화했으며, Spring Profile로 개발/운영 환경을 완전히 분리하여 민감 정보를 환경변수로만 주입하는 보안 구조를 설계했습니다."

> "운영 환경에서는 Redis SSL 활성화, Kafka SASL/SSL 인증, AWS RDS 엔드포인트 연결을 application-prod.properties에 구성하고, 리버스 프록시 헤더 전략(forward-headers-strategy)을 적용하여 클라우드 배포 환경에서도 안정적으로 동작하도록 설정했습니다."

### 시맨틱 검색 관련

> "한국어 자연어 쿼리를 Komoran 형태소 분석기로 파싱하여 핵심 명사를 추출하고 '요즘', '최근' 같은 시간 표현을 날짜 범위로 변환한 뒤, OpenAI text-embedding-3-small로 쿼리 벡터를 생성하여 pgVector 코사인 유사도 검색으로 의미적으로 관련된 뉴스 기사를 검색하는 다단계 파이프라인을 구현했습니다."

> "pgVector 유사도 검색(임계값 0.80)으로 상위 800개 후보를 추출한 뒤 In-memory 키워드 필터링을 적용하는 하이브리드 검색 방식을 설계했습니다. 동일 쿼리에 대한 반복 호출은 Redis 캐시(@Cacheable)로 처리하여 임베딩 API 비용과 응답 지연을 줄였고, GPT-4o-mini를 활용한 카테고리 자동 분류로 검색 정확도를 높였습니다."
