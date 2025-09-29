"use client";
import { useState } from "react";

export default function PayTypeFields() {
  const [pt, setPt] = useState<"HOURLY"|"SALARY">("HOURLY");
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
        <label className="flex flex-col gap-1">
          <span>Hourly Rate *</span>
          <input name="hourlyRate" type="number" step="0.01" required className="border rounded p-2"/>
        </label>
      ) : (
        <label className="flex flex-col gap-1">
          <span>Annual Salary *</span>
          <input name="salary" type="number" step="0.01" required className="border rounded p-2"/>
        </label>
      )}
    </div>
  );
}
