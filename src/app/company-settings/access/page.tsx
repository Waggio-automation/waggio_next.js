import Link from "next/link";
import AccessForm from "./AccessForm";

export default async function CompanyAccessPage() {
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
          <h1 className="text-2xl font-semibold">Create or access your workspace</h1>
          <p className="mt-1 text-sm text-gray-500">
            Sign up to create a new company workspace, or log in to an existing one.
          </p>
        </div>
      </header>

      <AccessForm />
    </main>
  );
}
