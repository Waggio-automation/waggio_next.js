import Link from "next/link";

const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "/employees", label: "Employees" },
  { href: "/payroll", label: "Create Paystub" },
  { href: "/cra", label: "CRA" },
  { href: "/company-settings", label: "Company Settings" },
];

export default function WorkspaceNav() {
  return (
    <nav className="mx-auto flex w-full max-w-6xl flex-nowrap items-center justify-end gap-2 overflow-x-auto px-4 py-3 text-sm sm:px-6 lg:px-8">
      {navItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="inline-flex shrink-0 whitespace-nowrap rounded-full border border-gray-300 bg-white px-3.5 py-1.5 font-medium text-gray-700 transition hover:bg-gray-50"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
