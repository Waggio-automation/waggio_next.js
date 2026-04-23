import Link from "next/link";
import ForgotEmailForm from "../ForgotEmailForm";

export default function ForgotEmailPage() {
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
          <h1 className="text-2xl font-semibold">Find login email</h1>
          <p className="mt-1 text-sm text-gray-500">
            Enter the company name and the system will show the masked login email.
          </p>
        </div>
      </header>

      <ForgotEmailForm />
    </main>
  );
}
