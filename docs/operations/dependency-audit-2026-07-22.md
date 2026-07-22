# 의존성 취약점 트리아지 — 2026-07-22

시작 상태: `npm audit` 10건 (2 critical, 7 high, 1 moderate). Dependabot 목록은 [보안 탭](https://github.com/Waggio-automation/waggio_next.js/security/dependabot)에서 개별 대조 필요.

## 패치 완료 (이번 커밋)

| 패키지 | 심각도 | 조치 | 실제 위험 평가 |
| --- | --- | --- | --- |
| nodemailer 8.0.7 → **9.0.3** | HIGH | 명시적 업그레이드 (`npm install nodemailer@^9.0.3`, semver-major라 audit fix가 건너뜀) | `email.ts` 실사용 — CRLF 헤더 인젝션·jsonTransport 파일접근 우회·OAuth2 TLS 미검증·raw SSRF. **이메일 재구현(Day 3) 전 선행 완료** |
| shell-quote | CRITICAL | `npm audit fix` | `concurrently` 경유, dev 전용(`dev:tunnel`) — 프로덕션 위험 낮음 |
| undici | HIGH | `npm audit fix` | 전이 의존성 |
| ws | HIGH | `npm audit fix` | 전이 의존성 |
| js-yaml | HIGH | `npm audit fix` | 전이 의존성 |
| brace-expansion | HIGH | `npm audit fix` | eslint 경유 dev 의존성, DoS |

## 회귀 확인

- `npm test`: **44/44 통과**
- nodemailer 9 런타임 스모크 테스트(jsonTransport sendMail): 통과 — `email.ts` 사용 API(createTransport/sendMail)는 v9에서 동일
- `npm run build`: 샌드박스 네트워크 제한(Prisma 엔진 다운로드 403, Google Fonts fetch 차단)으로 로컬/CI에서 실행 필요. **push 전 로컬에서 `npm run build` 1회 확인 권장**
- `@types/nodemailer`는 최신이 8.0.1 (v9 타입 미출시) — 기본 API만 사용하므로 ^8.0.0 유지, v9 타입 출시 시 갱신

## 이월 (다음 주)

| 패키지 | 심각도 | 상태 | 판단 |
| --- | --- | --- | --- |
| postcss <8.5.10 (next 내장 8.4.31) | MODERATE | **차단됨** | 수정판은 next ≥16.3.0 stable부터 (현 최신 16.2.11도 취약 범위). `npm audit fix --force`는 next@9.3.3 다운그레이드라 **절대 금지**. 빌드타임 XSS(stringify 출력)라 런타임 노출 낮음. Next 16.3 안정판 출시 시 업그레이드 검토 |
| sharp <0.35.0 (0.34.5, next 의존) | HIGH | **차단됨** | 동일하게 next에 고정. libvips CVE 4건 — next/image 최적화 경로. 신뢰할 수 없는 사용자 업로드 이미지를 next/image로 처리하지 않는 한 노출 제한적. postcss와 함께 Next 16.3에서 해결 |
| Dependabot 잔여 항목 | — | 미검토 | npm audit(10건)과 Dependabot(13건) 차이분은 GitHub 보안 탭에서 개별 확인 — lockfile-only 항목이나 GitHub Actions 관련일 가능성 |

## 재현 명령

```bash
npm audit                       # 현황
npm audit fix                   # --force 금지
npm install nodemailer@^9.0.3   # major는 명시적으로
npm test && npm run build       # 회귀 확인
```
