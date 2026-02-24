import { requireStripeVerifiedCompanyOrRedirect } from "@/lib/company-onboarding";

export default async function EmployeesLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireStripeVerifiedCompanyOrRedirect();
  return children;
}
