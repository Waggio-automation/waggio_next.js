import type { ReactNode } from "react";
import Link from "next/link";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";

export default async function CraLayout({ children }: { children: ReactNode }) {
  await requireCompanyAdminOrRedirect();

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gray-500">
            CRA Payroll
          </p>
          <h1 className="text-2xl font-semibold text-gray-900">Owner-only CRA workspace</h1>
        </div>
        <nav className="flex flex-wrap gap-3 text-sm">
          <Link href="/" className="rounded-full border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50">
            Dashboard
          </Link>
          <Link href="/cra" className="rounded-full border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50">
            CRA Home
          </Link>
          <Link href="/cra/t4" className="rounded-full border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50">
            T4s
          </Link>
          <Link href="/cra/settings" className="rounded-full border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50">
            CRA Settings
          </Link>
        </nav>
      </header>
      {children}
    </main>
  );
}
