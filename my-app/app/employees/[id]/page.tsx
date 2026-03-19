import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import PaymentStatusCard from "./payment-status-card";

function toUiPayoutStatus(status: string) {
  switch (status) {
    case "REQUIRED":
      return "required" as const;
    case "PENDING":
      return "pending" as const;
    case "READY":
      return "ready" as const;
    case "ISSUE":
      return "issue" as const;
    default:
      return "required" as const;
  }
}

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let employeeId: bigint;
  try {
    employeeId = BigInt(id);
  } catch {
    notFound();
  }

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      employmentType: true,
      payType: true,
      payGroup: true,
      payoutSetupStatus: true,
      payoutEnabled: true,
      trolleyRecipientAccountType: true,
      createdAt: true,
    },
  });

  if (!employee) {
    notFound();
  }

  return (
    <main className="max-w-4xl mx-auto p-6 space-y-6">
      <Link
        href="/employees"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
      >
        <span className="mr-1 text-lg">←</span>
        Back to Employees
      </Link>

      <section className="rounded border p-4 space-y-2">
        <h1 className="text-2xl font-semibold">
          {employee.firstName} {employee.lastName}
        </h1>
        <p className="text-sm text-gray-600">{employee.email}</p>
        <div className="grid grid-cols-2 gap-3 text-sm text-gray-600 pt-2">
          <p>Employment: {employee.employmentType}</p>
          <p>Pay type: {employee.payType}</p>
          <p>Pay group: {employee.payGroup}</p>
          <p>Created: {employee.createdAt.toLocaleDateString()}</p>
        </div>
      </section>

      <PaymentStatusCard
        employeeId={employee.id.toString()}
        initialStatus={toUiPayoutStatus(employee.payoutSetupStatus)}
        initialMethod={
          employee.trolleyRecipientAccountType === "paypal" ? "paypal" : "bank-transfer"
        }
      />
    </main>
  );
}
