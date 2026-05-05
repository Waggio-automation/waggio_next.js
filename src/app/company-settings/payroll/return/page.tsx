import { redirect } from "next/navigation";

export default async function CompanyPayrollReturnPage() {
  redirect("/company-settings?setup=done");
}
