# Business-rule catalog

Confidence means confidence that the table describes the code, not that the rule is legally correct. All tax/employment rules below require authoritative CRA/Ontario/WSIB or qualified payroll verification before production approval.

| ID | Rule / source | Input -> output; rounding/error | Scope | Tests | Confidence / validation gap |
| --- | --- | --- | --- | --- | --- |
| BR-001 | Pay periods (`cra-constants-2026.ts`) | BI_WEEKLY -> 26; MONTHLY -> 12 | 2026, Ontario UI | None | High code; weekly/semi-monthly absent |
| BR-002 | Hourly base (`calculatePayroll.ts`) | `(total-holiday)*rate + holiday*1.5*rate + overtime*1.5*rate` | Ontario, 2026 | None | High code; holiday/OT eligibility and stacking unverified |
| BR-003 | Salary base | annual salary / periods | 2026 | None | High code; partial periods absent |
| BR-004 | Vacation | include flag -> base pay * employee percentage | Ontario | None | High code; accrual/payout/statutory basis unverified |
| BR-005 | Gross | base + vacation; bonus field ignored | 2026 | None | High code; missing bonus/additional earnings |
| BR-006 | CPP | period exemption and period-prorated annual cap, rate 5.95% | 2026 outside Quebec | None | High code; known defect: no YTD max/CPP2 |
| BR-007 | EI | gross capped at annual insurable / periods, rate 1.63% | 2026 outside Quebec | None | High code; no YTD max/reduced rates |
| BR-008 | Federal tax | T4127-style annualization/brackets, TD1, employment amount | 2026 | None | Medium; explicit high-income BPA and other factors omitted |
| BR-009 | Ontario tax | brackets + surtax + health premium + reduction | Ontario 2026 | None | Medium; requires official vectors |
| BR-010 | Net pay | gross - CPP - EI - income tax - EHT - WSIB; cents via JS `Math.round` | Current | None | High code; EHT/WSIB classification unsafe; binary number risk |
| BR-011 | Contractor | Same payroll deductions as employee; T4 later marks CPP/EI exempt | Current | None | High code; internally contradictory and unsafe |
| BR-012 | Ready line | netPay > 0 -> READY else PENDING | Current | None | High code; nonpositive lines make whole Trolley run fail |
| BR-013 | Run creation | transaction creates run/lines then marks run PROCESSED | Current | None | High; no review/approval/finalize/idempotency |
| BR-014 | Date validity | Client rejects pay date before period end; API only requires strings | Current | None | High; server allows invalid/ambiguous dates/negative inputs |
| BR-015 | Scheduled send | date string parsed with `new Date`; cron selects sendAt <= now | Current | None | High; UTC/local semantics and DST intent undefined |
| BR-016 | Trolley readiness | employee flag + recipient ID + account ID; company env credentials imply ready | Current | 3 narrow mapping tests | High; provider/KYC/account status not actually verified |
| BR-017 | Payment amount | stored net converted to fixed two-decimal CAD string | Current | None | High code; currency fixed by settings |
| BR-018 | Trolley idempotency | deterministic external IDs; duplicate payment searched/reused | Current | None | Medium; batch/concurrency/crash handling incomplete |
| BR-019 | Run failure retry | PROCESSED or FAILED-with-type and no providerRef may retry | Current | None | High; cannot distinguish safe retry after ambiguous provider outcome |
| BR-020 | Extra-run billing | BASIC includes 3, PRO 4; later PAYING/PAID sequence billed $10/$8 | Current | None | High code; copy/race/entitlement truth needs product decision |
| BR-021 | Remittance source | Every company PayHistory row grouped by pay-date month/quarter | Current | None | High; should use finalized eligible snapshots only |
| BR-022 | Employer CPP/EI | CPP equals employee amount; EI is employee amount * 1.4 | Current | None | High code; caps/exceptions/refunds need verification/snapshot |
| BR-023 | Remittance due | All monthly and accelerated types -> next-month 15th; quarterly analogous | Current | None | High; accelerated implementation explicitly placeholder |
| BR-024 | Remittance status | paid >= positive payable -> PAID; positive partial -> PARTIALLY_PAID; else due-date based | Current | None | High; overpayment/refund/void semantics absent |
| BR-025 | Remittance payment dedup | Same remittance/date/rounded amount updates existing row | Current | None | High; two legitimate same-day equal payments collapse |
| BR-026 | T4 source | Every PayHistory in local-calendar tax year | Current | None | High; no finalized/voided filter or frozen tax rules |
| BR-027 | T4 employer totals | Employee deductions summed; employer CPP equal, EI *1.4; CPP2 zero | Current | None | High; legally incomplete/unverified |
| BR-028 | T4 contractor fields | contractor pensionable/insurable earnings zero and exempt codes 1 | Current | None | High code; source payroll still deducted CPP/EI |
| BR-029 | Dental benefit code mapping | coverage enum -> codes 1-5 | Current | None | Medium; mapping requires CRA verification |
| BR-030 | YTD API | only SENT/EMAIL_SENT with `paidAt != null` | Current | None | High; new Trolley flow never establishes these consistently |
| BR-031 | Plan entitlement | most features require only non-null currentPlan; CRA actions require PRO | Current | None | High; subscription/payment state not consistently enforced |

## Unsupported cases that must block or escalate

Weekly/semi-monthly/custom schedules; Québec or non-Ontario payroll; CPP2; YTD max crossings/opening balances; bonus/commission/retroactive pay; taxable benefits; pensions/RRSP/union dues/garnishments; reduced EI; leaves/partial periods; multiple employments; termination pay; adjustments/reversals/off-cycle; returned payments; overpayments; amended/cancelled T4s; accelerated remitter rules; EHT/WSIB liability; and any case not covered by validated tax-year rules.

The product must surface these as unsupported rather than silently applying the periodic default formula.
