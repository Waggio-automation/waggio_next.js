import Link from "next/link";

type PayoutStatus = "required" | "pending" | "ready" | "issue";

export default function PaymentStatusCard({
  initialStatus,
}: {
  initialStatus: PayoutStatus;
}) {
  const status = initialStatus;

  return (
    <section className="rounded border p-4 space-y-3">
      <h2 className="text-lg font-medium">Payment status</h2>

      {status === "ready" ? (
        <p className="text-sm text-green-700">✅ Ready for automatic payments</p>
      ) : status === "pending" ? (
        <p className="text-sm text-amber-700">⏳ Bank account pending verification</p>
      ) : status === "issue" ? (
        <p className="text-sm text-red-700">⚠️ Bank account needs attention</p>
      ) : (
        <p className="text-sm text-amber-700">⚠️ Bank account required</p>
      )}

      <div className="rounded border border-dashed p-3 text-sm text-gray-600">
        Company bank accounts are managed in Company Settings → Payroll Settings.
      </div>

      <Link
        href="/company-settings"
        className="inline-flex items-center text-sm text-indigo-600 hover:text-indigo-500"
      >
        Go to Company Settings -&gt;
      </Link>
    </section>
  );
}
