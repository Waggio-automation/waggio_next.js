"use client";
import { useState } from "react";

export default function PaymentMethodFields() {
  const [pm, setPm] = useState<"CHEQUE"|"DIRECT_DEPOSIT">("CHEQUE");
  return (
    <div className="space-y-3">
      <div className="flex gap-6">
        <label className="flex items-center gap-2">
          <input type="radio" name="paymentMethod" value="CHEQUE"
                 checked={pm==="CHEQUE"} onChange={()=>setPm("CHEQUE")} />
          <span>Cheque</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="paymentMethod" value="DIRECT_DEPOSIT"
                 checked={pm==="DIRECT_DEPOSIT"} onChange={()=>setPm("DIRECT_DEPOSIT")} />
          <span>Direct deposit</span>
        </label>
      </div>

      {pm==="DIRECT_DEPOSIT" && (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Direct deposit details are completed from the employee profile after creation.
        </div>
      )}
    </div>
  );
}
