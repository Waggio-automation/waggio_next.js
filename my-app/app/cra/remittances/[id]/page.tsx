import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";
import { markRemittancePaidAction } from "../../actions";

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(value);
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

export default async function RemittanceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const company = await requireCompanyAdminOrRedirect();
  const { id } = await params;

  const remittance = await prisma.remittance.findFirst({
    where: {
      id: BigInt(id),
      companyId: company.id,
    },
    include: {
      payments: {
        where: { status: "RECORDED" },
        orderBy: { paymentDate: "desc" },
      },
      allocations: {
        include: {
          payHistory: {
            include: {
              employee: {
                select: {
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
        },
      },
      documents: {
        orderBy: { uploadedAt: "desc" },
      },
    },
  });

  if (!remittance) notFound();

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-gray-500">Remittance period</p>
            <h2 className="mt-1 text-2xl font-semibold text-gray-900">
              {formatDate(remittance.periodStart)} to {formatDate(remittance.periodEnd)}
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              Pay {formatMoney(remittance.totalPayable.toNumber())} by {formatDate(remittance.dueDate)}.
            </p>
          </div>
          <div className="rounded-2xl bg-gray-100 px-4 py-3 text-sm text-gray-700">
            Status: <span className="font-semibold text-gray-900">{remittance.status}</span>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900">CRA amount breakdown</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-gray-50 p-4">
              <p className="text-sm text-gray-500">Income tax withheld</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">
                {formatMoney(remittance.totalIncomeTax.toNumber())}
              </p>
            </div>
            <div className="rounded-2xl bg-gray-50 p-4">
              <p className="text-sm text-gray-500">CPP employee</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">
                {formatMoney(remittance.totalCppEmployee.toNumber())}
              </p>
            </div>
            <div className="rounded-2xl bg-gray-50 p-4">
              <p className="text-sm text-gray-500">CPP employer</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">
                {formatMoney(remittance.totalCppEmployer.toNumber())}
              </p>
            </div>
            <div className="rounded-2xl bg-gray-50 p-4">
              <p className="text-sm text-gray-500">EI employee</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">
                {formatMoney(remittance.totalEiEmployee.toNumber())}
              </p>
            </div>
            <div className="rounded-2xl bg-gray-50 p-4">
              <p className="text-sm text-gray-500">EI employer</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">
                {formatMoney(remittance.totalEiEmployer.toNumber())}
              </p>
            </div>
            <div className="rounded-2xl bg-gray-900 p-4 text-white">
              <p className="text-sm text-gray-200">Total payable</p>
              <p className="mt-1 text-xl font-semibold">
                {formatMoney(remittance.totalPayable.toNumber())}
              </p>
            </div>
          </div>

          <div className="mt-6">
            <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-gray-500">
              Employees included
            </h4>
            <div className="mt-3 space-y-2">
              {remittance.allocations.map((allocation) => (
                <div key={allocation.payHistoryId.toString()} className="flex items-center justify-between rounded-2xl border border-gray-200 px-4 py-3 text-sm">
                  <span className="text-gray-900">
                    {allocation.payHistory.employee.firstName} {allocation.payHistory.employee.lastName}
                  </span>
                  <span className="text-gray-500">{formatDate(allocation.payHistory.payDate)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">Mark payment as complete</h3>
            <p className="mt-2 text-sm text-gray-600">
              Use this after you pay CRA outside the app. This keeps your dashboard accurate.
            </p>
            <form action={markRemittancePaidAction} className="mt-4 space-y-3">
              <input type="hidden" name="remittanceId" value={remittance.id.toString()} />
              <label className="block">
                <span className="mb-1 block text-sm text-gray-600">Payment date</span>
                <input
                  type="date"
                  name="paymentDate"
                  defaultValue={new Date().toISOString().slice(0, 10)}
                  className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm text-gray-600">Amount paid</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  name="amountPaid"
                  defaultValue={remittance.totalPayable.toNumber()}
                  className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm text-gray-600">Payment method</span>
                <input
                  type="text"
                  name="paymentMethod"
                  placeholder="Online banking, My Business Account, bank branch"
                  className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm text-gray-600">Reference number</span>
                <input
                  type="text"
                  name="referenceNumber"
                  placeholder="Optional confirmation number"
                  className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm text-gray-600">Notes</span>
                <textarea
                  name="notes"
                  rows={4}
                  placeholder="Optional note or where proof is stored"
                  className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
                />
              </label>
              <button
                type="submit"
                className="w-full rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
              >
                Mark as paid
              </button>
            </form>
          </section>

          <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">How to pay CRA</h3>
            <ul className="mt-3 space-y-2 text-sm text-gray-600">
              <li>Pay CRA separately using online banking, CRA My Business Account, or your bank.</li>
              <li>After payment, record the payment date here right away.</li>
              <li>Keep the confirmation number or receipt so you can verify it later.</li>
            </ul>
          </section>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900">Payments recorded</h3>
          <div className="mt-4 space-y-3">
            {remittance.payments.map((payment) => (
              <div key={payment.id.toString()} className="rounded-2xl bg-gray-50 px-4 py-3">
                <p className="text-sm font-medium text-gray-900">
                  {formatMoney(payment.amountPaid.toNumber())} on {formatDate(payment.paymentDate)}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {[payment.paymentMethod, payment.referenceNumber].filter(Boolean).join(" | ") || "No extra reference recorded"}
                </p>
              </div>
            ))}
            {remittance.payments.length === 0 ? (
              <p className="text-sm text-gray-500">No payment has been recorded yet.</p>
            ) : null}
          </div>
        </div>

        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900">Documents</h3>
          <div className="mt-4 space-y-3">
            {remittance.documents.map((document) => (
              <div key={document.id.toString()} className="rounded-2xl bg-gray-50 px-4 py-3">
                <p className="text-sm font-medium text-gray-900">{document.fileName}</p>
                <p className="mt-1 text-xs text-gray-500">{document.storagePath}</p>
              </div>
            ))}
            {remittance.documents.length === 0 ? (
              <p className="text-sm text-gray-500">Generated remittance reports will appear here.</p>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
