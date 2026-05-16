import { Suspense } from "react";
import { getAuthenticatedCompanyUser } from "@/lib/company-auth";
import LoginSuccessNotice from "@/app/components/LoginSuccessNotice";

export default async function AuthenticatedTopBar() {
  const session = await getAuthenticatedCompanyUser();

  if (!session) return null;

  const companyName = session.company.name?.trim() || "Company workspace";

  return (
    <div className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex min-h-10 w-full max-w-6xl items-center justify-end gap-3 px-4 py-2 sm:px-6 lg:px-8">
        <Suspense fallback={null}>
          <LoginSuccessNotice />
        </Suspense>
        <p className="min-w-0 truncate text-right text-sm text-gray-600">
          Welcome,{" "}
          <span className="font-medium text-gray-900">{companyName}</span>
        </p>
        <form action="/api/auth/logout" method="post" className="shrink-0">
          <button
            type="submit"
            className="inline-flex whitespace-nowrap rounded-full border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Log out
          </button>
        </form>
      </div>
    </div>
  );
}
