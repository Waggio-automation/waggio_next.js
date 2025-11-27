-- ─────────────────────────
-- ENUM 타입 생성 (변경 없음)
-- ─────────────────────────

CREATE TYPE "public"."EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACTOR');
CREATE TYPE "public"."PayGroup" AS ENUM ('BI_WEEKLY', 'MONTHLY');
CREATE TYPE "public"."PayType" AS ENUM ('HOURLY', 'SALARY');
CREATE TYPE "public"."PaymentMethod" AS ENUM ('CHEQUE', 'DIRECT_DEPOSIT');
CREATE TYPE "public"."PayStatus" AS ENUM ('PENDING', 'PROCESSED', 'PAID');

-- ─────────────────────────
-- Employee 테이블 (변경 없음)
-- ─────────────────────────

CREATE TABLE "public"."Employee" (
    "id" BIGSERIAL NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "sin" TEXT NOT NULL,

    "paymentMethod" "public"."PaymentMethod" NOT NULL DEFAULT 'CHEQUE',
    "addrLine1"     TEXT NOT NULL,
    "addrLine2"     TEXT,
    "addrCity"      TEXT NOT NULL,
    "addrProvince"  TEXT NOT NULL DEFAULT 'ON',
    "addrPostal"    TEXT NOT NULL,
    "addrCountry"   TEXT NOT NULL DEFAULT 'CA',

    "birthDate"      TIMESTAMP(3) NOT NULL,
    "employmentType" "public"."EmploymentType" NOT NULL,
    "hireDate"       TIMESTAMP(3) NOT NULL,
    
    "payGroup" "public"."PayGroup" NOT NULL DEFAULT 'BI_WEEKLY',
    "payType"  "public"."PayType"  NOT NULL,
    
    "hourlyRate"  DECIMAL(65,30),
    "salary"      DECIMAL(65,30),
    "vacationPay" DECIMAL(65,30) NOT NULL DEFAULT 4,
    "bonus"       DECIMAL(65,30) NOT NULL DEFAULT 0,

    "federalTD1"    DECIMAL(65,30) NOT NULL DEFAULT 15492,
    "provincialTD1" DECIMAL(65,30) NOT NULL DEFAULT 12298,
    
    "bankName"        TEXT,
    "bankAccount"     TEXT,
    "transitNumber"   TEXT,
    "institutionNumber" TEXT,
    
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    
    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────
-- ✅ 업그레이드된 PayHistory 테이블
-- ─────────────────────────

CREATE TABLE "public"."PayHistory" (
    "id" BIGSERIAL NOT NULL,
    "employeeId" BIGINT NOT NULL,

    -- ✅ 근무 시간 분리 저장
    "regularHours"  DECIMAL(65,30),             -- 정규 근무
    "overtimeHours" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "holidayHours"  DECIMAL(65,30) NOT NULL DEFAULT 0,  -- ✅ 공휴일 근무

    -- ✅ 각각의 금액 breakdown 저장
    "basePay"      DECIMAL(65,30) NOT NULL DEFAULT 0,   -- regular만 * rate
    "overtimePay"  DECIMAL(65,30) NOT NULL DEFAULT 0,   -- OT만
    "holidayPay"   DECIMAL(65,30) NOT NULL DEFAULT 0,   -- ✅ 공휴일 프리미엄 금액
    "vacationPay"  DECIMAL(65,30) NOT NULL DEFAULT 0,   -- ✅ 계산된 휴가비만
    "grossPay"    DECIMAL(65,30) NOT NULL,              -- 최종 총액

    -- ✅ 공제는 기존 유지
    "ded_cpp"         DECIMAL(65,30) NOT NULL DEFAULT 0,
    "ded_ei"          DECIMAL(65,30) NOT NULL DEFAULT 0,
    "ded_income_tax"  DECIMAL(65,30) NOT NULL DEFAULT 0,
    "ded_eht"         DECIMAL(65,30) NOT NULL DEFAULT 0,
    "ded_wsib"        DECIMAL(65,30) NOT NULL DEFAULT 0,

    "netPay"       DECIMAL(65,30) NOT NULL,
    "status"       "public"."PayStatus" NOT NULL DEFAULT 'PENDING',
    "review_valid" BOOLEAN NOT NULL DEFAULT true,
    "review_errors"   TEXT[] DEFAULT ARRAY[]::TEXT[],
    "review_warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayHistory_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PayHistory_employeeId_fkey" 
        FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") 
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- ─────────────────────────
-- ✅ Indexes 업데이트
-- ─────────────────────────

CREATE INDEX "Employee_email_hireDate_idx" 
  ON "public"."Employee"("email", "hireDate");

CREATE INDEX "PayHistory_employeeId_payDate_idx" 
  ON "public"."PayHistory"("employeeId", "payDate");
