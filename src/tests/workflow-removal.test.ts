import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

function source(path: string) {
  return readFileSync(resolve(root, path), "utf8");
}

const affectedExecutableFiles = [
  "src/app/employees/actions.ts",
  "src/app/api/payhistory/route.ts",
  "src/app/api/payroll/run/route.ts",
  "src/app/api/payroll/runs/route.ts",
  "src/app/api/payroll/runs/[id]/route.ts",
  "src/app/api/payroll/update-status/route.ts",
];

const retiredIntegrationName = ["n", "8", "n"].join("");
const retiredHeaderName = ["x", "-", retiredIntegrationName, "-secret"].join("");

test("affected executable paths contain no legacy workflow integration", () => {
  for (const path of affectedExecutableFiles) {
    const contents = source(path);
    assert.doesNotMatch(contents, new RegExp(retiredIntegrationName, "i"), path);
    assert.doesNotMatch(contents, new RegExp(retiredHeaderName, "i"), path);
  }
});

test("retained payroll APIs require JSON API authentication", () => {
  const auth = source("src/lib/payroll-api-auth.ts");
  assert.match(auth, /getAuthenticatedCompanyUser/);
  assert.match(auth, /status:\s*401/);
  assert.match(auth, /status:\s*403/);
  assert.match(auth, /CompanyUserRole\.OWNER/);
  assert.match(auth, /CompanyUserRole\.ADMIN/);

  for (const path of [
    "src/app/api/payhistory/route.ts",
    "src/app/api/payroll/run/route.ts",
    "src/app/api/payroll/runs/route.ts",
    "src/app/api/payroll/runs/[id]/route.ts",
    "src/app/api/payroll/update-status/route.ts",
  ]) {
    const contents = source(path);
    assert.match(contents, /requirePayrollApiAuth/);
    assert.doesNotMatch(contents, /requireCompanyAdminOrRedirect/);
  }
});

test("pay history and payroll run reads are tenant scoped with minimal DTOs", () => {
  const payHistoryGet = source("src/app/api/payhistory/route.ts").split(
    "export async function POST"
  )[0];
  const runList = source("src/app/api/payroll/runs/route.ts");
  const runDetail = source("src/app/api/payroll/runs/[id]/route.ts");

  for (const [path, contents] of [
    ["payhistory GET", payHistoryGet],
    ["payroll run list", runList],
    ["payroll run detail", runDetail],
  ]) {
    assert.match(contents, /companyId:\s*auth\.company\.id/, path);
    assert.match(contents, /select:\s*\{/, path);
    assert.doesNotMatch(contents, /institutionNumber|transitBranchNumber|accountNumber/, path);
    assert.doesNotMatch(contents, /\bsin\s*:/i, path);
    assert.doesNotMatch(contents, /\bemail\s*:/i, path);
    assert.doesNotMatch(contents, /\bhourlyRate\s*:|\bsalary\s*:/, path);
    assert.doesNotMatch(contents, /providerRef|paymentRef|trolleyRecipient|token/i, path);
  }

  assert.match(runDetail, /findFirst/);
  assert.match(runDetail, /status:\s*404/);
  assert.match(payHistoryGet, /status:\s*404/);
});

test("creation routes have no external workflow request or workflow configuration dependency", () => {
  for (const path of [
    "src/app/employees/actions.ts",
    "src/app/api/payroll/run/route.ts",
    "src/app/api/payroll/update-status/route.ts",
  ]) {
    const contents = source(path);
    assert.doesNotMatch(contents, new RegExp(`process\\.env\\.${retiredIntegrationName}_`, "i"));
    assert.doesNotMatch(contents, new RegExp(retiredHeaderName, "i"));
  }

  assert.match(source("src/app/employees/actions.ts"), /prisma\.employee\.create/);
  assert.match(source("src/app/api/payroll/run/route.ts"), /prisma\.\$transaction/);
});
