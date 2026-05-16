import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";
import WorkspaceNav from "@/app/components/WorkspaceNav";

export default async function PayrollLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireCompanyAdminOrRedirect();
  return (
    <>
      <WorkspaceNav />
      {children}
    </>
  );
}
