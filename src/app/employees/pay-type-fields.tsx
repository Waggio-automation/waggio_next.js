"use client";
import { useState } from "react";

export default function PayTypeFields() {
  const [pt, setPt] = useState<"HOURLY"|"SALARY">("HOURLY");
  const fieldClassName =
    "w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-500";
  const labelClassName = "flex flex-col gap-2 text-sm text-gray-700";

  return (
    <div className="space-y-3">
      <div className="flex gap-6">
        <label className="flex items-center gap-2">
          <input type="radio" name="payType" value="HOURLY" checked={pt==="HOURLY"} onChange={()=>setPt("HOURLY")} />
          <span>Hourly</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="payType" value="SALARY" checked={pt==="SALARY"} onChange={()=>setPt("SALARY")} />
          <span>Salary</span>
        </label>
      </div>

      {pt==="HOURLY" ? (
        <label className={`${labelClassName} max-w-sm`}>
          <span>Hourly Rate *</span>
          <input
            name="hourlyRate"
            type="number"
            step="0.01"
            required
            className={fieldClassName}
          />
        </label>
      ) : (
        <label className={`${labelClassName} max-w-sm`}>
          <span>Annual Salary *</span>
          <input
            name="salary"
            type="number"
            step="0.01"
            required
            className={fieldClassName}
          />
        </label>
      )}
    </div>
  );
}
