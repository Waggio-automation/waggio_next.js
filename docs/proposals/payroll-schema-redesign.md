# schema 수정

payrollrun을 없애고,

| 담당 |  |
| --- | --- |
| `PaystubRun` | PDF 생성, 이메일 발송, 발송 스케줄직원  |
| `PaytransferRun` | `PaytransferRun`자금 조달, Trolley 이체, 빌링`PayHistory` |
| `PayHistory` | 개인 급여 계산값 + 두 상태 |

```
enum PaystubStatus {
SCHEDULED
PROCESSING
SENT
FAILED
}

enum PaytransferStatus {
  PENDING     // 이체 전
  TRANSFER_SENDING     // Trolley 처리 중 -> 
  TRANSFER_SENT        // 이체 완료
  FAILED      // 이체 실패
  RETURNED // 은행에서 반환
}

FAILED랑 RETURNED는 실패 지점이 다름.

FAILED   → Trolley에서 막힘 (은행까지 못 감)
           예: 잔액 부족, 계정 정보 오류, Compliance 거부

RETURNED → 은행까지 갔다가 튕겨서 돌아옴
           예: 계좌 폐쇄, 계좌번호 오류
```

```
PaystubRun                          PaytransferRun
├── id                              ├── id
├── companyId                       ├── companyId
├── payDate                         ├── payDate
├── periodStart / periodEnd         ├── periodStart / periodEnd
├── scheduledAt                     ├── sendAt
├── status: PaystubRunStatus        ├── status: PaytransferRunStatus
│   SCHEDULED → PROCESSING          │   SCHEDULED → FUNDING
│   → SENT / FAILED                 │   → PAYING → PAID / FAILED
└── payHistories[]                  ├── providerRef (Trolley batch ID)
                                    ├── billingInfo...
                                    └── payHistories[]
```

최종 payhistory 테이블

`model PayHistory {
  id                       BigInt     @id @default(autoincrement())
  employeeId               BigInt
  payDate                  DateTime
  periodStart              DateTime?
  periodEnd                DateTime?
  sequenceNumber           String?

  // 급여 계산
  grossPay                 Decimal
  ded_cpp                  Decimal    @default(0)
  ded_ei                   Decimal    @default(0)
  ded_income_tax           Decimal    @default(0)
  ded_eht                  Decimal    @default(0)
  ded_wsib                 Decimal    @default(0)
  netPay                   Decimal
  hoursWorked              Decimal?

  // 검토
  review_valid             Boolean    @default(true)
  review_errors            String[]   @default([])
  review_warnings          String[]   @default([])

  // 명세서 (Paystub)
  paystubRunId             BigInt?
  paystubStatus            PaystubStatus     @default(SCHEDULED)
  pdfUrl                   String?
  emailProvider            String?
  emailSentAt              DateTime?
  paystubFailureReason     String?

  // 이체 (Paytransfer)
  paytransferRunId         BigInt?
  paytransferStatus        PaytransferStatus @default(PENDING)
  paymentProvider          String?
  paymentRef               String?           // Trolley payment ID
  paidAt                   DateTime?
  estimatedDeliveryAt      DateTime?         // Trolley Estimated Delivery
  attemptCount             Int               @default(0)
  lastAttemptAt            DateTime?
  paytransferFailureReason String?
  trolleyEvents            Json?             // webhook 감사 로그

  createdAt                DateTime   @default(now())
  updatedAt                DateTime   @updatedAt

  employee              Employee               @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  paystubRun            PaystubRun?            @relation(fields: [paystubRunId], references: [id], onDelete: SetNull)
  paytransferRun        PaytransferRun?        @relation(fields: [paytransferRunId], references: [id], onDelete: SetNull)
  remittanceAllocations RemittancePayHistory[]

  @@index([employeeId, payDate])
  @@index([paystubRunId])
  @@index([paytransferRunId])
}`

---

## 기존 대비 변경 요약

| 기존 | 변경 |
| --- | --- |
| `status PayHistoryStatus` | `paystubStatus` + `paytransferStatus` 로 분리 |
| `payrollRunId` | `paystubRunId` + `paytransferRunId` 로 분리 |
| `failureReason` | `paystubFailureReason` + `paytransferFailureReason` 로 분리 |
| `deliveryStatus String?` | `estimatedDeliveryAt DateTime?` 로 교체 |
| 없음 | `trolleyEvents Json?` 추가 |
| `payrollRun relation` | `paystubRun` + `paytransferRun` relation 으로 교체 |
|  |  |

n8n → railway 

`[Vercel / Local - Next.js]
  HTML 생성 (템플릿 로직)
      ↓
  POST {RAILWAY_PDF_URL}/pdf
      ↓
[Railway - PDF Service]
  Puppeteer + Chromium (안정적 환경)
  PDF buffer 반환
      ↓
[Vercel / Local - Next.js]
  Vercel Blob 업로드 → pdfUrl 저장`

---

## 구현 단계

**1단계 — Railway PDF 서비스 (신규)**

`pdf-service/
  src/index.ts   (Express)
  package.json
  Dockerfile`

- `POST /pdf` — `{ html: string }` 받아서 PDF buffer 반환
- 완전 stateless, DB 접근 없음
- Railway에 배포

**2단계 — 기존 `/api/payslip/pdf/route.ts` 단순화**

`// isVercel 분기 전부 제거
const res = await fetch(process.env.RAILWAY_PDF_URL + "/pdf", {
  method: "POST",
  body: JSON.stringify({ html }),
})
const pdfBuffer = Buffer.from(await res.arrayBuffer())
// → Vercel Blob 업로드`

**3단계 — 환경변수**

`RAILWAY_PDF_URL=https://your-service.railway.app   # Vercel + 로컬 동일`

---

## 로컬 개발은?

Railway 서비스 URL을 `.env.local`에 넣으면 로컬도 Railway 호출하면 되고, 아니면 Railway 서비스를 로컬에서도 `node`로 따로 띄우는 방식 두 가지 가능해요.

HTML을 **호출하는 쪽에서 만들어서** 넘겨줘요. 즉 PDF 서비스는 "HTML → PDF 변환기"일 뿐이에요.

---

## 흐름 상세

`Next.js (/api/paystub/generate)          Railway (/pdf)

1. DB에서 직원/급여 데이터 조회
2. HTML 템플릿 렌더링
   (이름, 급여, 공제항목 등 삽입)
3. POST /pdf 호출           →   HTML 문자열 받음
   { html: "<html>..." }    →   Puppeteer로 브라우저 열기
                            →   HTML 렌더링
                            ←   PDF buffer 반환
4. Vercel Blob에 업로드
5. pdfUrl DB 저장
6. 이메일 발송`

---

## 핵심 포인트

**Railway 서비스는 데이터를 모름** — 그냥 HTML을 PDF로 바꿔주는 도구예요.

`// Railway /pdf 는 이게 전부
app.post("/pdf", async (req, res) => {
  const { html } = req.body
  const pdf = await generatePdf(html)  // Puppeteer
  res.send(pdf)
})`

**데이터 조회 + 템플릿 로직은 전부 Next.js 쪽**에 있고, Railway는 Chromium 환경만 제공하는 거예요.

웹에서 "인쇄 → PDF 저장" 하는 것과 원리가 같아요.

`브라우저에서 인쇄할 때:
  HTML 렌더링 → PDF로 저장

Railway에서:
  HTML 받음 → Chromium이 렌더링 → PDF로 저장`

Chromium이 브라우저 엔진이라서 HTML/CSS를 완벽하게 이해해요. 그래서 복잡한 레이아웃도 그대로 PDF가 돼요.

## 흐름도

`[버튼 클릭]
     │
     ▼
PayHistory 생성 (paytransferStatus: PENDING)
     │
     ├──────────────────────────┐
     ▼                          ▼
PaystubRun (SCHEDULED)    PaytransferRun (PENDING)
     │                          │
     └──────────┬───────────────┘
                │
          [sendAt 09:00]
          Cron 발동
                │
     ┌──────────┴───────────────┐
     ▼                          ▼
PDF 생성 (Railway)         Trolley 이체 요청
이메일 발송                paytransferStatus: TRANSFER_SENDING
PaystubRun: SENT           PaytransferRun: PROCESSING
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
             [정상 처리]      [실패]       [반환]
          Trolley webhook   Trolley      Trolley
          TRANSFER_SENT     FAILED       RETURNED
          PaytransferRun:   PaytransferRun:
          PAID              FAILED`

---

# 1. Employee 테이블 리팩토링

## 왜 바꾸나

기존 `Employee` 테이블 하나에 성격이 다른 정보들이 섞여 있었음.

문제는 두 가지:

- 연봉이 바뀌면 기존 값이 덮어씌워져서 **이전 급여 설정을 알 수 없음**
- 재계산이나 감사가 필요할 때 **그 시점의 설정값을 복원할 방법이 없음**

---

## 변경 내용

기존 `Employee` 테이블 하나 → 6개 테이블로 분리

### Employee (신원정보만 남김)

```
id, firstName, lastName, email, sin, birthDate,
hireDate, employeeNumber, employmentType, companyId,
addrLine1 ~ addrCountry
```

### EmployeePayConfig (이력 O)

```
id, employeeId, salary, hourlyRate, payGroup,
payType, vacationPay, bonus, department, jobTitle,
effectiveFrom 
```

> 연봉/직급 변경 시 기존 행은 유지하고 새 행 insert
> 

### EmployeeTaxConfig (이력 O)

```
id, employeeId, federalTD1, provincialTD1,
effectiveFrom
```

> TD1 양식 재제출 시 새 행 insert
> 

### EmployeeBenefitsConfig (이력 O)

```
id, employeeId, dentalBenefitsCoverage,
rppDpspRegistrationNumber, pensionAdjustmentOverride,
effectiveFrom
```

> T4 계산 시 해당 연도 플랜 기준으로 조회해야 하므로 이력 필요
> 

### EmployeeBankAccount (이력 O)

```
id, employeeId, institutionNumber,
transitBranchNumber, accountNumber, paymentMethod,
effectiveFrom
```

> 어떤 계좌로 송금됐는지 감사추적 목적
> 

### EmployeePayoutConfig (이력 X, 덮어쓰기)

```
id, employeeId, trolleyRecipientId, trolleyReferenceId,
trolleyRecipientAccountId, trolleyRecipientAccountType,
payoutEnabled, payoutSetupStatus
```

> Trolley 외부 서비스 영역이라 현재 상태만 유지
> 

---

## 관계

```
Employee (1) ──→ (N) EmployeePayConfig
Employee (1) ──→ (N) EmployeeTaxConfig
Employee (1) ──→ (N) EmployeeBenefitsConfig
Employee (1) ──→ (N) EmployeeBankAccount
Employee (1) ──→ (1) EmployeePayoutConfig
```

이력 테이블(1:N)은 `effectiveFrom` 기준으로 가장 최근 행이 현재 적용 중인 설정.

---

## 이력 조회 방법

특정 시점의 설정값이 필요할 때 (예: 3월 급여 재계산):

```sql
SELECT * FROM employee_pay_configs
WHERE employee_id = 101
AND effective_from <= '2024-03-31'
ORDER BY effective_from DESC
LIMIT 1;
```

**Company, CompanyUser table 보완**

**`Company.adminEmail` 제거** — `CompanyUser`(OWNER)의 email로 대체

company 테이블에서  users               CompanyUser[]로 가지고 옴. ㅇ

현재 companyUser에서 role         CompanyUserRole @default(OWNER)로 고정되어있고, 회원가입할때 owner로 하드코딩되어있는 상태.

## CompanyUser 생성 — 회원가입 시 단 한 번

signup/route.ts:84-91에서:

`const user = await tx.companyUser.create({
  data: {
    companyId: company.id,
    email,
    passwordHash,
    firstName: firstName || null,
    lastName: lastName || null,
    role: "OWNER",   // ← 항상 하드코딩
  },
});`

## 결론:

지금 `role: "OWNER"` 하드코딩은 **의도적으로 맞는 코드**예요. 회원가입하는 사람은 항상 OWNER니까요.

나중에 초대 기능 추가할 때 그때 ADMIN 생성 로직을 별도로 만들면 돼요. 지금 건드릴 필요 없어요.

그럼 회원가입할때 저거 받는 창을 만들어야해?

아니요. 회원가입하는 사람은 항상 OWNER예요.

`회원가입 = 회사 계정을 새로 만드는 사람 → 무조건 OWNER`

ADMIN은 OWNER가 나중에 팀원을 초대할 때 생기는 거예요:

`OWNER가 초대 → bob@acme.com 입력 → ADMIN으로 CompanyUser 생성`

그러니까 role을 받는 창이 필요한 게 아니라, **유저 초대 기능**이 필요한 거예요. 지금 그 기능이 없어서 ADMIN이 존재할 수 없는 상태인 거고요.

지금 당장 멀티 유저 초대가 필요하지 않으면 건드릴 필요 없어요.

**만약 받는 창을 만들면 초대기능이 필요없는건데 왜 저거보다 초대기능을 추천하는거야?**

보안 문제 때문이에요.

회원가입 폼에서 role을 선택하게 하면:

`누군가 signup 페이지에서
email: hacker@bad.com
role: ADMIN
company: Acme Corp  ← 어떤 회사든 선택 가능`

이렇게 되면 아무나 어떤 회사의 ADMIN으로 가입할 수 있어요.

---

초대 방식이 필요한 이유는 role 때문이 아니라 **"어느 회사에 속하는지"를 검증**하기 위해서예요:

`초대 링크 = "Acme Corp의 OWNER가 이 사람을 승인했다"는 증명`

초대 없이 role 선택 폼만 만들면 company 귀속을 검증할 방법이 없어요.

---

지금 구조에서 현실적인 선택지는:

| 방식 | 설명 |
| --- | --- |
| 지금처럼 유지 | 회사당 1명(OWNER)만 운영 |
| 초대 기능 추가 | OWNER가 이메일로 팀원 초대 → ADMIN 생성 |

회사당 혼자 쓰는 구조면 지금 그대로도 충분해요.

(급하지 않음) 스키마에 `OWNER | ADMIN` enum이 있지만, 실제 코드 어디에도 역할을 **검사해서 다르게 동작하는 로직이 없다**는 뜻이에요.

`// 이런 코드가 있어야 역할이 "구분된다"고 할 수 있는데
if (user.role !== "OWNER") {
  return 403  // ADMIN은 이 기능 못 씀
}

// 현재 코드에 위 같은 게 단 한 줄도 없음`

지금 상태는:

`OWNER로 로그인한 사람  → 모든 기능 접근 가능
ADMIN으로 로그인한 사람 → 똑같이 모든 기능 접근 가능`

역할이 달라도 실제 경험이 동일해요. enum만 정의해두고 권한 분기 구현을 아직 안 한 상태예요.