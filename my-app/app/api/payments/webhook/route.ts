import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { syncCompanySettingsFromAccount } from "@/lib/company-settings";
import { constructWebhookEvent } from "@/lib/payments/stripe";
import {
  mapExternalPaymentEventToInternal,
  toPrismaEmployeePayoutStatus,
  toPrismaPayrollFailureType,
  toPrismaPayrollRunStatus,
} from "@/lib/payments/status-mapping";

function getPayrollRunSelector(event: Stripe.Event):
  | { id: bigint }
  | { providerRef: string }
  | null {
  const object = event.data.object as { id?: string; metadata?: Record<string, string> };
  const metadata = object.metadata;
  const payrollRunId = metadata?.payrollRunId;

  if (typeof payrollRunId === "string" && payrollRunId.length > 0) {
    try {
      return { id: BigInt(payrollRunId) };
    } catch {
      return null;
    }
  }

  const providerRef = object?.id;
  if (typeof providerRef === "string" && providerRef.length > 0) {
    return { providerRef };
  }

  return null;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  let event: Stripe.Event;
  try {
    event = constructWebhookEvent(rawBody, signature);
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid webhook signature" },
      { status: 400 }
    );
  }

  if (event.type === "account.updated") {
    const account = event.data.object as Stripe.Account;
    const metadataCompanyId = account.metadata?.companyId;
    let companyId: bigint | null = null;

    if (metadataCompanyId) {
      try {
        companyId = BigInt(metadataCompanyId);
      } catch {
        companyId = null;
      }
    }

    if (!companyId && account.id) {
      const settings = await prisma.companySettings.findFirst({
        where: { stripeAccountId: account.id },
        select: { companyId: true },
      });
      companyId = settings?.companyId ?? null;
    }

    if (companyId && account.id) {
      // Keep company onboarding status in sync from Stripe account truth.
      await syncCompanySettingsFromAccount({
        companyId,
        stripeAccountId: account.id,
        account: account as unknown as Record<string, unknown>,
      });
    }
  }

  const mapped = mapExternalPaymentEventToInternal(
    event as unknown as {
      type: string;
      account?: string;
      data?: { object?: Record<string, unknown> };
    }
  );

  if (mapped.employee) {
    const accountId = mapped.employee.stripeAccountId || event.account || undefined;

    if (accountId) {
      await prisma.employee.updateMany({
        where: { stripeAccountId: accountId },
        data: {
          payoutSetupStatus: toPrismaEmployeePayoutStatus(mapped.employee.payoutSetupStatus),
          payoutEnabled: mapped.employee.payoutEnabled,
        },
      });
    }
  }

  if (mapped.payrollRun) {
    const selector = getPayrollRunSelector(event);

    if (selector) {
      await prisma.payrollRun.updateMany({
        where: selector,
        data: {
          status: toPrismaPayrollRunStatus(mapped.payrollRun.status),
          failureType: toPrismaPayrollFailureType(mapped.payrollRun.failureType),
          failureReason: mapped.payrollRun.failureReason ?? null,
          providerRef:
            typeof (event.data.object as { id?: string })?.id === "string"
              ? (event.data.object as { id: string }).id
              : undefined,
        },
      });
    }
  }

  return NextResponse.json({ ok: true });
}
