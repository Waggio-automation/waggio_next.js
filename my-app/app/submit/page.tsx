// app/submit/page.tsx
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export default async function SubmitPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ok = searchParams?.ok === "1";

  // 서버 액션: 폼 데이터 → Employee 저장
  async function createEmployee(formData: FormData) {
    "use server";

    // 1) 필수값 추출
    const firstName = String(formData.get("firstName") || "").trim();
    const lastName = String(formData.get("lastName") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const sin = String(formData.get("sin") || "").trim();               // 9 digits 기대
    const addrLine1 = String(formData.get("addrLine1") || "").trim();
    const addrCity = String(formData.get("addrCity") || "").trim();
    const addrPostal = String(formData.get("addrPostal") || "").trim();

    const birthDateStr = String(formData.get("birthDate") || "");
    const employmentType = String(formData.get("employmentType") || "FULL_TIME");
    const hireDateStr = String(formData.get("hireDate") || "");
    const payGroup = String(formData.get("payGroup") || "BI_WEEKLY");
    const payType = String(formData.get("payType") || "HOURLY");

    const hourlyRateStr = String(formData.get("hourlyRate") || "");
    const salaryStr = String(formData.get("salary") || "");

    // 2) 검증(간단)
    if (!firstName || !lastName || !email) throw new Error("Missing name/email");
    if (!/^\d{9}$/.test(sin)) throw new Error("SIN must be 9 digits");
    if (!addrLine1 || !addrCity || !addrPostal) throw new Error("Missing address fields");
    if (!birthDateStr || !hireDateStr) throw new Error("Missing dates");

    const birthDate = new Date(birthDateStr);
    const hireDate = new Date(hireDateStr);

    // payType에 따라 rate/ salary 처리
    let hourlyRate: number | null = null;
    let salary: number | null = null;
    if (payType === "HOURLY") {
      const n = Number(hourlyRateStr);
      if (!Number.isFinite(n)) throw new Error("hourlyRate required for HOURLY");
      hourlyRate = n;
    } else if (payType === "SALARY") {
      const n = Number(salaryStr);
      if (!Number.isFinite(n)) throw new Error("salary required for SALARY");
      salary = n;
    } else {
      throw new Error("Invalid payType");
    }

    // 3) DB 저장 (기본값 있는 것들은 생략 가능)
    await prisma.employee.create({
      data: {
        firstName,
        lastName,
        email,
        sin,
        paymentMethod: "CHEQUE", // 기본값(CHEQUE). 폼에서 선택하게 바꿔도 됨.

        addrLine1,
        addrCity,
        addrPostal,
        // 선택·기본값
        addrProvince: "ON",
        addrCountry: "CA",

        birthDate,
        employmentType: employmentType as any, // "FULL_TIME" | "PART_TIME" | "CONTRACTOR"
        hireDate,
        payGroup: payGroup as any,             // "BI_WEEKLY" | "MONTHLY"
        payType: payType as any,               // "HOURLY" | "SALARY"
        hourlyRate,                            // Decimal? → number로 넣어도 Prisma가 처리
        salary,                                // Decimal?

        // 기타 기본값들: vacationPay=4, bonus=0, federalTD1, provincialTD1 등 스키마 기본 사용
        bankName: null,
        bankAccount: null,
        transitNumber: null,
        institutionNumber: null,
      },
    });

    // 목록/페이지 갱신 후 간단한 성공 표시
    revalidatePath("/submit");
    redirect("/submit?ok=1");
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Create Employee (MVP)</h1>
      {ok && (
        <div className="rounded border p-3 text-green-700 bg-green-50">
          Saved! ✅
        </div>
      )}

      <form action={createEmployee} className="space-y-6">
        {/* 기본 정보 */}
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span>First name *</span>
            <input name="firstName" required className="border rounded p-2" />
          </label>
          <label className="flex flex-col gap-1">
            <span>Last name *</span>
            <input name="lastName" required className="border rounded p-2" />
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            <span>Email *</span>
            <input type="email" name="email" required className="border rounded p-2" />
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            <span>SIN (9 digits) *</span>
            <input name="sin" inputMode="numeric" pattern="\d{9}" required className="border rounded p-2" />
          </label>
        </div>

        {/* 주소 */}
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span>Address line 1 *</span>
            <input name="addrLine1" required className="border rounded p-2" />
          </label>
          <label className="flex flex-col gap-1">
            <span>City *</span>
            <input name="addrCity" required className="border rounded p-2" />
          </label>
          <label className="flex flex-col gap-1">
            <span>Postal Code *</span>
            <input name="addrPostal" required className="border rounded p-2" />
          </label>
          <label className="flex flex-col gap-1">
            <span>Province</span>
            <input name="addrProvince" defaultValue="ON" className="border rounded p-2" />
          </label>
          <label className="flex flex-col gap-1">
            <span>Country</span>
            <input name="addrCountry" defaultValue="CA" className="border rounded p-2" />
          </label>
        </div>

        {/* 고용/페이 정보 */}
        <div className="grid grid-cols-3 gap-4">
          <label className="flex flex-col gap-1">
            <span>Birth date *</span>
            <input type="date" name="birthDate" required className="border rounded p-2" />
          </label>
          <label className="flex flex-col gap-1">
            <span>Employment type *</span>
            <select name="employmentType" className="border rounded p-2">
              <option>FULL_TIME</option>
              <option>PART_TIME</option>
              <option>CONTRACTOR</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span>Hire date *</span>
            <input type="date" name="hireDate" required className="border rounded p-2" />
          </label>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <label className="flex flex-col gap-1">
            <span>Pay group</span>
            <select name="payGroup" className="border rounded p-2" defaultValue="BI_WEEKLY">
              <option>BI_WEEKLY</option>
              <option>MONTHLY</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span>Pay type *</span>
            <select name="payType" className="border rounded p-2" defaultValue="HOURLY">
              <option>HOURLY</option>
              <option>SALARY</option>
            </select>
          </label>

          {/* 아래 둘 다 보여주고, 서버에서 payType에 맞는 것만 사용 */}
          <label className="flex flex-col gap-1">
            <span>Hourly rate (if HOURLY)</span>
            <input name="hourlyRate" type="number" step="0.01" className="border rounded p-2" />
          </label>
          <label className="flex flex-col gap-1">
            <span>Annual salary (if SALARY)</span>
            <input name="salary" type="number" step="0.01" className="border rounded p-2" />
          </label>
        </div>

        <button type="submit" className="border rounded px-4 py-2 hover:bg-gray-50">
          Save Employee
        </button>
      </form>
    </div>
  );
}
