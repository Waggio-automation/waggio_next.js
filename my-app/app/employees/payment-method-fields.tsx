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
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span>Bank name *</span>
            <input name="bankName" required className="border rounded p-2"/>
          </label>
          <label className="flex flex-col gap-1">
            <span>Account *</span>
            <input name="bankAccount" required className="border rounded p-2"/>
          </label>
          <label className="flex flex-col gap-1">
            <span>Transit *</span>
            <input name="transitNumber" required className="border rounded p-2"/>
          </label>
          <label className="flex flex-col gap-1">
            <span>Institution *</span>
            <input name="institutionNumber" required className="border rounded p-2"/>
          </label>
        </div>
      )}
    </div>
  );
}
