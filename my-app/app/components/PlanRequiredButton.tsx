"use client";

import { MouseEvent, ReactNode, useState } from "react";
import Link from "next/link";

type PlanRequiredButtonProps = {
  hasSelectedPlan: boolean;
  currentPlan?: string | null;
  requiredPlan?: "BASIC" | "PRO";
  children: ReactNode;
  className: string;
  disabled?: boolean;
  type?: "button" | "submit";
  onClick?: () => void | Promise<void>;
};

function PlanRequiredModal({
  mode,
  onClose,
}: {
  mode: "choose" | "upgrade";
  onClose: () => void;
}) {
  const isUpgrade = mode === "upgrade";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-3xl border border-gray-200 bg-white p-6 shadow-xl">
        <div className="space-y-2">
          <p className="text-sm uppercase tracking-[0.2em] text-gray-500">
            {isUpgrade ? "Pro required" : "Plan required"}
          </p>
          <h2 className="text-2xl font-semibold text-gray-900">
            {isUpgrade ? "Switch to Pro to continue" : "Choose a plan to continue"}
          </h2>
          <p className="text-sm leading-6 text-gray-600">
            {isUpgrade
              ? "CRA remittances, T4 generation, and year-end filing workflows are included in Pro."
              : "Select Basic or Pro before saving, generating, or running payroll workflows."}
          </p>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <Link
            href={
              isUpgrade
                ? "/company-settings?setup=upgrade_required"
                : "/company-settings?setup=plan_required"
            }
            className="rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            {isUpgrade ? "Switch to Pro" : "Choose a plan"}
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function PlanRequiredButton({
  hasSelectedPlan,
  currentPlan,
  requiredPlan,
  children,
  className,
  disabled,
  type = "button",
  onClick,
}: PlanRequiredButtonProps) {
  const [modalMode, setModalMode] = useState<"choose" | "upgrade" | null>(null);

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (!hasSelectedPlan) {
      event.preventDefault();
      setModalMode("choose");
      return;
    }

    if (requiredPlan === "PRO" && currentPlan !== "PRO") {
      event.preventDefault();
      setModalMode("upgrade");
      return;
    }

    void onClick?.();
  }

  return (
    <>
      <button type={type} disabled={disabled} onClick={handleClick} className={className}>
        {children}
      </button>
      {modalMode ? (
        <PlanRequiredModal mode={modalMode} onClose={() => setModalMode(null)} />
      ) : null}
    </>
  );
}
