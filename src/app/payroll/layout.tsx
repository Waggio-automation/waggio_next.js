import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";

export default async function PayrollLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireCompanyAdminOrRedirect();
  return children;
}
