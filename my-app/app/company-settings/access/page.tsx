import Link from "next/link";
import AccessForm from "./AccessForm";
import { prisma } from "@/lib/prisma";

export default async function CompanyAccessPage() {
  const accountCount = await prisma.companyUser.count();
  const hasExistingAccount = accountCount > 0;

  return (
    <main className="mx-auto w-full max-w-xl px-6 py-8 space-y-6">
      <header className="space-y-2">
        <Link
          href="/company-settings"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
        >
          <span className="mr-1 text-lg">←</span>
          Back to Company Settings
        </Link>
        <div>
          <p className="text-sm text-gray-500">Account Access</p>
          <h1 className="text-2xl font-semibold">
            {hasExistingAccount ? "Log in to your workspace" : "Create your owner account"}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {hasExistingAccount
              ? "Use the email and password for your payroll workspace."
              : "Create the first owner account, then choose a plan in Company Settings before using payroll."}
          </p>
        </div>
      </header>

      <AccessForm hasExistingAccount={hasExistingAccount} />
    </main>
  );
}
