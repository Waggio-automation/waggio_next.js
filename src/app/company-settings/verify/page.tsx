import { redirect } from "next/navigation";

export default async function CompanyVerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; companyId?: string }>;
}) {
  const params = await searchParams;
  const token = params.token;
  const companyId = params.companyId;

  if (!token || !companyId) {
    return (
      <main className="mx-auto w-full max-w-xl px-6 py-10 space-y-4">
        <h1 className="text-xl font-semibold">Invalid magic link</h1>
        <p className="text-sm text-red-600">Missing token or companyId.</p>
      </main>
    );
  }

  redirect(
    `/api/company/verify?token=${encodeURIComponent(token)}&companyId=${encodeURIComponent(companyId)}`
  );
}
