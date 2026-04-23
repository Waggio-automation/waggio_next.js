import Link from "next/link";
import ForgotPasswordForm from "../ForgotPasswordForm";

export default function ForgotPasswordPage() {
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
          <p className="mt-1 text-sm text-gray-500">
            Enter the login email and the app will send a one-time password reset email.
          </p>
        </div>
      </header>

      <ForgotPasswordForm />
    </main>
  );
}
