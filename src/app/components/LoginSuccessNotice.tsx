"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export default function LoginSuccessNotice() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isLoginSuccess = searchParams.get("setup") === "login_success";
  const [isVisible, setIsVisible] = useState(isLoginSuccess);

  useEffect(() => {
    if (!isLoginSuccess) {
      setIsVisible(false);
      return;
    }

    setIsVisible(true);
    const hideTimer = window.setTimeout(() => setIsVisible(false), 2800);
    const cleanupTimer = window.setTimeout(() => {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete("setup");
      const query = nextParams.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, 3300);

    return () => {
      window.clearTimeout(hideTimer);
      window.clearTimeout(cleanupTimer);
    };
  }, [isLoginSuccess, pathname, router, searchParams]);

  if (!isLoginSuccess) return null;

  return (
    <span
      className={`inline-flex shrink-0 whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm text-emerald-800 transition duration-500 ${
        isVisible ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0"
      }`}
    >
      Logged in successfully.
    </span>
  );
}
