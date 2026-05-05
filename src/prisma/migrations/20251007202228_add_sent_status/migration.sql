BEGIN;

-- 1) 새 ENUM 타입 생성 (public 스키마 명시)
CREATE TYPE "public"."PayStatus_new" AS ENUM ('PENDING', 'PROCESSED', 'SENT');

-- 2) 기존 default 제거 (이미 PENDING로 잡혀있어서 문제 안 생김)
ALTER TABLE "public"."PayHistory" ALTER COLUMN "status" DROP DEFAULT;

-- 3) 컬럼 타입을 새 ENUM으로 변환 (텍스트 캐스팅으로 안전 처리)
ALTER TABLE "public"."PayHistory"
  ALTER COLUMN "status"
  TYPE "public"."PayStatus_new"
  USING ("status"::text::"public"."PayStatus_new");

-- 4) 기존 ENUM을 old로 보존
ALTER TYPE "public"."PayStatus" RENAME TO "PayStatus_old";

-- 5) 새 ENUM을 기존 이름으로 변경 (Prisma가 바라보는 타입명 유지)
ALTER TYPE "public"."PayStatus_new" RENAME TO "PayStatus";

-- 6) old ENUM 삭제
DROP TYPE "public"."PayStatus_old";

-- 7) default 설정 다시 적용
ALTER TABLE "public"."PayHistory" ALTER COLUMN "status" SET DEFAULT 'PENDING';

COMMIT;
