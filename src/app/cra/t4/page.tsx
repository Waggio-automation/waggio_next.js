import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";
import { getMissingT4FilingSettings } from "@/lib/cra";
import { getT4SlipDocumentLabel, getT4SummaryDisplayStatus } from "@/lib/t4-artifact-policy";
import { generateT4Action } from "../actions";
import PlanRequiredButton from "@/app/components/PlanRequiredButton";
import {
  CRA_OPERATIONAL_TIME_ZONE,
  getDateOnlyCalendarYear,
  getTodayUtcDateOnly,
} from "@/lib/date-only";
import {
  getCompanyProviderVerificationFreshness,
  getProviderVerificationBlockedDocumentIds,
} from "@/lib/payments/provider-verification";

type SummaryDocument = {
  id: bigint;
  fileName: string;
  mimeType: string;
  uploadedAt: Date;
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(value);
}

function formatDate(value: Date | null) {
  if (!value) return "Not generated";
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: CRA_OPERATIONAL_TIME_ZONE,
  }).format(value);
}

function documentLabel(fileName: string) {
  if (fileName.endsWith(".xml")) return "Download XML";
  if (fileName.endsWith(".pdf")) return "Download PDF";
  if (fileName.endsWith(".json")) return "Download JSON";
  return "Download";
}

function getSummaryDocumentKey(document: SummaryDocument) {
  const fileName = document.fileName.toLowerCase();
  if (fileName.endsWith(".pdf")) return "pdf";
  if (fileName.endsWith(".xml")) return "xml";
  if (fileName.endsWith(".json")) return "json";
  return `${document.mimeType}:${fileName.split(".").pop() ?? "unknown"}`;
}

function getVisibleSummaryDocuments(documents: SummaryDocument[]) {
  const latestByKind = new Map<string, SummaryDocument>();

  for (const document of documents) {
    const key = getSummaryDocumentKey(document);
    const current = latestByKind.get(key);

    if (!current || current.uploadedAt < document.uploadedAt) {
      latestByKind.set(key, document);
    }
  }

  return Array.from(latestByKind.values()).sort((left, right) => {
    return right.uploadedAt.getTime() - left.uploadedAt.getTime();
  });
}

export default async function T4ManagementPage() {
  const company = await requireCompanyAdminOrRedirect();
  const currentYear = getDateOnlyCalendarYear(getTodayUtcDateOnly());
  const missingSettings = await getMissingT4FilingSettings(company.id);
  const t4Ready = missingSettings.length === 0;
  const hasSelectedPlan = Boolean(company.currentPlan);

  const [summaries, slips, providerVerification, blockedDocumentIds] = await Promise.all([
    prisma.t4Summary.findMany({
      where: { companyId: company.id },
      orderBy: [{ taxYear: "desc" }],
      include: {
        documents: {
          where: { validationStatus: "ACTIVE" },
          orderBy: { uploadedAt: "desc" },
        },
      },
    }),
    prisma.t4Slip.findMany({
      where: { companyId: company.id },
      orderBy: [{ taxYear: "desc" }, { employee: { firstName: "asc" } }],
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        documents: {
          where: { validationStatus: "ACTIVE" },
          orderBy: { uploadedAt: "desc" },
          take: 1,
        },
      },
    }),
    getCompanyProviderVerificationFreshness(company.id),
    getProviderVerificationBlockedDocumentIds(company.id),
  ]);
  const visibleSummaries = summaries.map((summary) => ({
    ...summary,
    documents: summary.documents.filter((document) => !blockedDocumentIds.has(document.id)),
  }));
  const visibleSlips = slips.map((slip) => ({
    ...slip,
    documents: slip.documents.filter((document) => !blockedDocumentIds.has(document.id)),
  }));
  const providerEvidenceReviewRequired =
    providerVerification.neverSuccessfullyVerifiedCount > 0 ||
    providerVerification.staleVerificationCount > 0 ||
    providerVerification.evidenceVersionMismatchCount > 0 ||
    providerVerification.unverifiedStatusCount > 0 ||
    providerVerification.providerReferenceMissingCount > 0;

  return (
    <div className="space-y-6">
      {providerEvidenceReviewRequired ? (
        <section className="rounded-3xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-950">
          <p className="font-semibold">REVIEW REQUIRED — provider evidence is stale or unverified</p>
          <p className="mt-1">
            Unverified status: {providerVerification.unverifiedStatusCount}. Never verified: {providerVerification.neverSuccessfullyVerifiedCount}. Missing provider reference: {providerVerification.providerReferenceMissingCount}. Stale: {providerVerification.staleVerificationCount}. Outdated contract: {providerVerification.evidenceVersionMismatchCount}. Affected CRA downloads are blocked.
          </p>
        </section>
      ) : null}
      <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Generate year-end T4 package</h2>
            <p className="mt-2 text-sm text-gray-600">
              This creates one T4 slip per employee plus a company-level T4 summary.
            </p>
            {!t4Ready ? (
              <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                T4 filing settings are incomplete: {missingSettings.join(", ")}.{" "}
                <Link href="/cra/settings" className="font-medium underline">
                  Open CRA settings
                </Link>
              </div>
            ) : null}
          </div>
          <form action={generateT4Action} className="flex items-center gap-3">
            <input
              type="number"
              name="taxYear"
              defaultValue={currentYear}
              className="rounded-2xl border border-gray-300 px-4 py-3 text-sm"
            />
            <PlanRequiredButton
              hasSelectedPlan={hasSelectedPlan}
              currentPlan={company.currentPlan}
              requiredPlan="PRO"
              type="submit"
              disabled={!t4Ready}
              className="rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              Generate now
            </PlanRequiredButton>
          </form>
        </div>
      </section>

      <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-gray-900">T4 summaries</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-200 text-left text-gray-500">
              <tr>
                <th className="py-3 pr-3">Tax year</th>
                <th className="py-3 pr-3">Employees</th>
                <th className="py-3 pr-3">Employment income</th>
                <th className="py-3 pr-3">Income tax</th>
                <th className="py-3 pr-3">Status</th>
                <th className="py-3 pr-3">Generated</th>
                <th className="py-3">Files</th>
              </tr>
            </thead>
            <tbody>
              {visibleSummaries.map((summary) => (
                (() => {
                  const visibleDocuments = getVisibleSummaryDocuments(summary.documents);
                  const displayStatus = getT4SummaryDisplayStatus(
                    summary.status,
                    visibleDocuments.length
                  );

                  return (
                    <tr key={summary.id.toString()} className="border-b border-gray-100 last:border-0">
                      <td className="py-3 pr-3 font-medium text-gray-900">{summary.taxYear}</td>
                      <td className="py-3 pr-3 text-gray-700">{summary.employeeCount}</td>
                      <td className="py-3 pr-3 text-gray-700">
                        {formatMoney(summary.totalEmploymentIncome.toNumber())}
                      </td>
                      <td className="py-3 pr-3 text-gray-700">
                        {formatMoney(summary.totalIncomeTaxDeducted.toNumber())}
                      </td>
                      <td className="py-3 pr-3 text-gray-700">{displayStatus}</td>
                      <td className="py-3 pr-3 text-gray-700">{formatDate(summary.generatedAt)}</td>
                      <td className="py-3 text-gray-700">
                        <div className="flex flex-wrap gap-2">
                          {visibleDocuments.map((document) => (
                            <a
                              key={document.id.toString()}
                              href={`/api/documents/${document.id.toString()}`}
                              className="rounded-full border border-gray-300 px-3 py-1 text-xs font-medium text-gray-900 hover:bg-gray-50"
                            >
                              {documentLabel(document.fileName)}
                            </a>
                          ))}
                          {visibleDocuments.length === 0 ? "No file" : null}
                        </div>
                      </td>
                    </tr>
                  );
                })()
              ))}
              {visibleSummaries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-sm text-gray-500">
                    No T4 summary has been generated yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-gray-900">Employee T4 slips</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-200 text-left text-gray-500">
              <tr>
                <th className="py-3 pr-3">Employee</th>
                <th className="py-3 pr-3">Tax year</th>
                <th className="py-3 pr-3">Employment income</th>
                <th className="py-3 pr-3">CPP</th>
                <th className="py-3 pr-3">EI</th>
                <th className="py-3 pr-3">Income tax</th>
                <th className="py-3">Document</th>
              </tr>
            </thead>
            <tbody>
              {visibleSlips.map((slip) => (
                <tr key={slip.id.toString()} className="border-b border-gray-100 last:border-0">
                  <td className="py-3 pr-3 text-gray-900">
                    {slip.employee.firstName} {slip.employee.lastName}
                  </td>
                  <td className="py-3 pr-3 text-gray-700">{slip.taxYear}</td>
                  <td className="py-3 pr-3 text-gray-700">
                    {formatMoney(slip.employmentIncome.toNumber())}
                  </td>
                  <td className="py-3 pr-3 text-gray-700">
                    {formatMoney(slip.cppContributionsEmployee.toNumber())}
                  </td>
                  <td className="py-3 pr-3 text-gray-700">
                    {formatMoney(slip.eiPremiumsEmployee.toNumber())}
                  </td>
                  <td className="py-3 pr-3 text-gray-700">
                    {formatMoney(slip.incomeTaxDeducted.toNumber())}
                  </td>
                  <td className="py-3 text-gray-700">
                    {slip.documents[0] ? (
                      <a
                        href={`/api/documents/${slip.documents[0].id.toString()}`}
                        className="rounded-full border border-gray-300 px-3 py-1 text-xs font-medium text-gray-900 hover:bg-gray-50"
                      >
                        {getT4SlipDocumentLabel(slip.status, true)}
                      </a>
                    ) : (
                      getT4SlipDocumentLabel(slip.status, false)
                    )}
                  </td>
                </tr>
              ))}
              {slips.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-sm text-gray-500">
                    No employee T4 slips generated yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
