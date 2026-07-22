# 환경변수 인벤토리 및 시크릿 로테이션 판단

작성일: 2026-07-22. 로컬 `.env`/`.env.local`과 코드베이스 전체 `process.env.*` 스캔 기준.
값은 절대 이 문서·티켓·로그에 기록하지 않는다. Vercel 대시보드 값은 저장소에서 확인 불가하므로 아래 체크리스트로 수동 검증한다.

## 1. 전체 인벤토리

### 코어 / 인프라

| 변수 | 사용처 | 로컬 존재 | 필수 | 비고 |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | Prisma 전역 | `.env`, `.env.local` | ✅ | 로컬은 localhost PostgreSQL |
| `DIRECT_URL` | Prisma direct connection | `.env.local` (`.env`엔 주석) | Vercel에서 필요 시 | Neon 등 pooler 사용 시 필수 |
| `APP_URL` | 비밀번호 재설정 링크 등 (`password-reset/request`) | `.env.local` | ✅ | 로컬은 ngrok URL |
| `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_SITE_URL` | `stripe.ts` 리다이렉트 URL, 재설정 링크 fallback | 없음 | Vercel 권장 | `VERCEL_URL` fallback 존재 |
| `NODE_ENV` | 8곳 | 자동 설정 | — | 수동 설정 불필요 |
| `VERCEL_URL` | URL fallback 2곳 | — | — | Vercel 자동 주입 |

### 인증 / 보안 시크릿

| 변수 | 사용처 | 로컬 존재 | 필수 | 비고 |
| --- | --- | --- | --- | --- |
| `COMPANY_ADMIN_SESSION_SECRET` | `company-auth.ts` 세션 서명 | `.env` | ✅ | `NEXTAUTH_SECRET` fallback 있음 |
| `NEXTAUTH_SECRET` | `company-auth.ts` fallback | 없음 | 선택 | 위 변수 있으면 불필요 |
| `CRON_SECRET` | `cron-auth.ts` (Vercel cron 인증) | 없음 (Vercel 전용) | ✅ (프로덕션) | `vercel.json` cron 2개가 사용 |
| `ENCRYPTION_KEY` | `crypto.ts` SIN AES-256-CBC 암호화 | `.env` | ✅ | 64자 hex 필수. 로테이션 = 데이터 재암호화 필요 |
| `API_KEY` | `employees/route.ts` 주석 처리된 코드만 | 없음 | ❌ | 죽은 참조 — 어디에도 설정 불필요 |

### 결제 / 외부 서비스

| 변수 | 사용처 | 로컬 존재 | 필수 | 비고 |
| --- | --- | --- | --- | --- |
| `STRIPE_SECRET_KEY` | `stripe.ts` | `.env` (test 키) | ✅ | |
| `STRIPE_PUBLISHABLE_KEY` | (현재 코드 미참조) | `.env` (test 키) | 선택 | 코드에서 미사용 — 정리 후보 |
| `STRIPE_RESTRICTED_KEY` | (현재 코드 미참조) | `.env` (test 키) | ❌ | 코드에서 미사용 — 정리 후보 |
| `STRIPE_WEBHOOK_SECRET` | `stripe/webhook/route.ts` | 없음 | ✅ (프로덕션) | 환경별 상이 |
| `TROLLEY_ACCESS_KEY` / `TROLLEY_SECRET_KEY` | `trolley.ts` | `.env` (sandbox) | ✅ | |
| `TROLLEY_BASE_URL` | `trolley.ts` override | 없음 | 선택 | 기본값 내장 |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | 1곳 | `.env`, `.env.local` | ✅ | 클라이언트 노출 — HTTP referrer 제한 필수 |
| `PDF_SERVER_URL` / `PDF_SERVER_SECRET` | `paystub.ts` (Railway PDF 서버) | `.env.local` | ✅ | |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM_EMAIL` / `SMTP_FROM_NAME` | `email.ts` | `.env` 주석만 | 이메일 발송 시 필수 | |

### 스크립트 / 테스트 전용 (배포 환경 불필요)

| 변수 | 사용처 |
| --- | --- |
| `CRA_INTEGRATION_DATABASE_URL`, `CRA_INTEGRATION_ALLOW_REMOTE` | `scripts/run-cra-integration-tests.ts` |
| `CRA_GENERATED_DIR` | `cra.ts` (기본값 있음) |
| `T4_CRASH_TAX_YEAR`, `T4_CRASH_COMPANY_ID` | `scripts/t4-crash-after-artifacts.ts` |

### 제거 완료 (2026-07-22 로컬 `.env`에서 삭제)

| 변수 | 사유 |
| --- | --- |
| `N8N_WEBHOOK_URL`, `N8N_API_KEY`, `N8N_SECRET`, `N8N_PAYROLL_WEBHOOK_URL`(주석) | n8n 폐기 (코드 제거 2026-07-17 완료, `../audit/n8n-usage-audit.md`) |
| `PAYROLL_UPDATE_TOKEN` | 코드 미참조 + `N8N_API_KEY`와 동일 값이었음 → n8n 공유 시크릿으로 간주, 폐기 |

## 2. Vercel 수동 체크리스트

저장소에서 확인 불가. Vercel → Settings → Environment Variables (Development/Preview/Production 각각):

- [ ] 위 "필수" 변수들이 환경별로 존재하는지 확인 (특히 `CRON_SECRET`, `STRIPE_WEBHOOK_SECRET`, `ENCRYPTION_KEY`)
- [ ] 다음 6개 이름 삭제: `N8N_SECRET`, `N8N_API_KEY`, `N8N_WEBHOOK_URL`, `N8N_PAYROLL_WEBHOOK_URL`, `N8N_TEST_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`
- [ ] `PAYROLL_UPDATE_TOKEN`, `API_KEY` 존재 시 삭제 (코드 미사용)
- [ ] 삭제 후 재배포하여 반영

CLI 대안: `vercel env ls` 로 이름 목록 확인 (값 노출 없음), `vercel env rm <이름> <environment>`.

## 3. 시크릿 로테이션 판단

원칙: **n8n(외부 SaaS)에 값이 전달·저장됐던 시크릿은 무조건 교체.** n8n 클라우드 워크플로/크리덴셜 스토어는 우리 통제 밖이었다.

| 시크릿 | n8n 공유 여부 | 판단 |
| --- | --- | --- |
| `N8N_API_KEY` = `PAYROLL_UPDATE_TOKEN` (동일 값) | **확실** — n8n이 이 값으로 API 호출 | **폐기 완료.** 같은 값을 재사용하는 곳이 있다면 그곳도 교체 |
| `N8N_SECRET` | **확실** | **폐기 완료** |
| `CRON_SECRET` | 확인 필요 — 코드상 n8n과 무관 (Vercel cron 전용 헤더 인증). 단, n8n 워크플로가 cron 엔드포인트를 직접 호출하도록 설정돼 있었다면 공유된 것 | n8n 콘솔에서 `/api/cron/*` 호출 워크플로 존재 여부 확인. **존재했으면 교체(비용 낮음 — Vercel 값 변경만). 불확실하면 그냥 교체 권장** |
| `ENCRYPTION_KEY` | 가능성 낮음 — 키 자체는 서버에서만 사용. 단, n8n 워크플로가 SIN 복호화를 수행했다면 공유된 것 | n8n 크리덴셜/워크플로에 이 키가 입력됐는지 확인. **공유됐으면 필수 교체 + 전체 SIN 재암호화 마이그레이션 필요** (`sin-backfill.md` 참고). 미공유 확인 시 유지 |
| Trolley 키 | 확인 필요 — n8n이 payroll 처리를 했으므로 n8n에서 직접 Trolley를 호출했을 가능성 있음 | n8n 크리덴셜 스토어 확인. **공유됐으면 Trolley 대시보드에서 키 재발급.** 현재 로컬 값은 sandbox 키 — 프로덕션 키가 별도로 n8n에 있었는지가 핵심 |
| Stripe 키 | 가능성 낮음 — n8n 워크플로 범위(직원 생성/급여 이벤트)에 Stripe 없음 | n8n 크리덴셜 스토어에 Stripe 없음 확인만 하면 유지. 현재 로컬 값은 test 키 |

### 실행 순서

1. n8n 콘솔 → Credentials + 각 워크플로 노드에서 사용된 시크릿 목록 확보 (값 아닌 이름만 기록)
2. 공유 확인된 키부터 교체: 발급처(Trolley/Stripe 대시보드, 수동 생성 시크릿)에서 신규 발급 → Vercel 3개 환경 + 로컬 갱신 → 재배포 → 구 키 폐기
3. `ENCRYPTION_KEY` 교체가 필요한 경우에만 재암호화 마이그레이션 계획 수립 (단순 값 교체 시 기존 SIN 복호화 불가)
4. n8n 계정/워크스페이스 자체 해지로 크리덴셜 스토어 폐기 완결
