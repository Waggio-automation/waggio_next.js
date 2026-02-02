import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  mapExternalPaymentEventToInternal,
  toPrismaEmployeePayoutStatus,
  toPrismaPayrollFailureType,
  toPrismaPayrollRunStatus,
} from "@/lib/payments/status-mapping";

type WebhookEvent = {
  account?: string;
  data?: {
    object?: {
      id?: string;
      metadata?: {
        payrollRunId?: string;
      };
    };
  };
};

function verifyWebhookSignature(rawBody: string, signature: string | null) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return true;
  if (!signature) return false;

  const parts = signature.split(",").reduce<Record<string, string>>((acc, part) => {
    const [k, v] = part.split("=");
    if (k && v) acc[k] = v;
    return acc;
  }, {});

  const timestamp = parts.t;
  const v1 = parts.v1;
  if (!timestamp || !v1) return false;

  const payloadToSign = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secret).update(payloadToSign).digest("hex");

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}

function getPayrollRunSelector(event: WebhookEvent):
  | { id: bigint }
  | { providerRef: string }
  | null {
  const metadata = event?.data?.object?.metadata;
  const payrollRunId = metadata?.payrollRunId;

  if (typeof payrollRunId === "string" && payrollRunId.length > 0) {
    try {
      return { id: BigInt(payrollRunId) };
    } catch {
      return null;
    }
  }

  const providerRef = event?.data?.object?.id;
  if (typeof providerRef === "string" && providerRef.length > 0) {
    return { providerRef };
  }

  return null;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
  }

  let event: WebhookEvent;
  try {
    event = JSON.parse(rawBody) as WebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const mapped = mapExternalPaymentEventToInternal(event);

  if (mapped.employee) {
    const accountId = mapped.employee.stripeAccountId || event.account;

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
            typeof event?.data?.object?.id === "string" ? event.data.object.id : undefined,
        },
      });
    }
  }

  return NextResponse.json({ ok: true });
}
