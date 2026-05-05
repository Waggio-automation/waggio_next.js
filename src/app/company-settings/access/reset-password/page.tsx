import Link from "next/link";
import ResetPasswordForm from "../ResetPasswordForm";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ userId?: string; token?: string }>;
}) {
  const params = await searchParams;
  const userId = params.userId;
  const token = params.token;

  if (!userId || !token) {
    return (
      <main className="mx-auto w-full max-w-xl px-6 py-8 space-y-6">
        <header className="space-y-2">
          <Link
            href="/company-settings/access"
            className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
          >
            <span className="mr-1 text-lg">←</span>
            Back to Login
          </Link>
          <div>
            <p className="text-sm text-gray-500">Account Access</p>
            <h1 className="text-2xl font-semibold">Reset password</h1>
          </div>
        </header>
        <p className="text-sm text-red-600">The password reset link is missing required information.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-xl px-6 py-8 space-y-6">
      <header className="space-y-2">
        <Link
          href="/company-settings/access"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
        >
          <span className="mr-1 text-lg">←</span>
          Back to Login
        </Link>
        <div>
          <p className="text-sm text-gray-500">Account Access</p>
          <h1 className="text-2xl font-semibold">Set a new password</h1>
          <p className="mt-1 text-sm text-gray-500">
            Choose a new password for the payroll workspace account.
          </p>
        </div>
      </header>

      <ResetPasswordForm userId={userId} token={token} />
    </main>
  );
}
