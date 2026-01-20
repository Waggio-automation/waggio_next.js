"use client";

import { useSearchParams } from "next/navigation";

export default function EmployeesClient({
  createForm,
  table,
}: {
  createForm: React.ReactNode;
  table: React.ReactNode;
}) {
  const searchParams = useSearchParams();
  const view = searchParams.get("view");
  const showCreateForm = view !== "all";

  return (
    <>
      {showCreateForm && createForm}
      {table}
    </>
  );
}
