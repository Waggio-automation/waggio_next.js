import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";

export default async function EmployeesLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireCompanyAdminOrRedirect();
  return children;
}
