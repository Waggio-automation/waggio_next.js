import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  createRecipient,
  createRecipientAccount,
  getRecipient,
  TrolleyApiError,
  updateRecipient,
} from "@/lib/trolley";
import {
  deriveEmployeeStatusFromTrolleyRecipient,
  toPrismaEmployeePayoutStatus,
} from "@/lib/payments/status-mapping";
import { getPrimaryCompany } from "@/lib/company";

const bankTransferSchema = z
  .object({
    type: z.literal("bank-transfer"),
    primary: z.boolean().optional(),
    country: z.string().length(2),
    currency: z.string().length(3),
    accountHolderName: z.string().min(1),
    accountNum: z.string().min(1),
    bankId: z.string().optional(),
    branchId: z.string().optional(),
    iban: z.string().optional(),
    swiftBic: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.country.toUpperCase() === "CA" && !value.bankId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "bankId is required for Canadian bank transfers.",
        path: ["bankId"],
      });
    } else if (value.country.toUpperCase() === "CA" && !/^\d{3}$/.test(value.bankId ?? "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "bankId must be exactly 3 digits for Canadian bank transfers.",
        path: ["bankId"],
      });
    }

    if (value.country.toUpperCase() === "CA" && !value.branchId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "branchId is required for Canadian bank transfers.",
        path: ["branchId"],
      });
    } else if (value.country.toUpperCase() === "CA" && !/^\d{5}$/.test(value.branchId ?? "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "branchId must be exactly 5 digits for Canadian bank transfers.",
        path: ["branchId"],
      });
    }
  });

const paypalSchema = z.object({
  type: z.literal("paypal"),
  primary: z.boolean().optional(),
  currency: z.string().length(3),
  emailAddress: z.string().email(),
});

const payloadSchema = z.union([bankTransferSchema, paypalSchema]);

function parseEmployeeId(id: string) {
  try {
    return BigInt(id);
  } catch {
    return null;
  }
}

function extractDuplicateRecipientId(error: TrolleyApiError) {
  const details =
    error.details && typeof error.details === "object"
      ? (error.details as Record<string, unknown>)
      : null;
  const errors = Array.isArray(details?.errors) ? details.errors : [];

  for (const issue of errors) {
    if (!issue || typeof issue !== "object") continue;
    const record = issue as Record<string, unknown>;
    if (record.code !== "duplicate" || typeof record.message !== "string") {
      continue;
    }

    const match = record.message.match(/recipient\s+([A-Za-z0-9_-]+)/i);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const employeeId = parseEmployeeId(id);

  if (!employeeId) {
    return NextResponse.json({ error: "Invalid employee id" }, { status: 400 });
  }

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      payoutSetupStatus: true,
      payoutEnabled: true,
      trolleyRecipientId: true,
      trolleyRecipientAccountId: true,
      addrLine1: true,
      addrLine2: true,
      addrCity: true,
      addrProvince: true,
      addrPostal: true,
      addrCountry: true,
      companyId: true,
    },
  });

  if (!employee) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  let payload: z.infer<typeof payloadSchema>;
  try {
    payload = payloadSchema.parse(await req.json());
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Invalid payout setup payload",
      },
      { status: 400 }
    );
  }

  try {
    let companyId = employee.companyId;
    if (!companyId) {
      const company = await getPrimaryCompany();
      if (!company) {
        return NextResponse.json(
          { error: "Company settings must be configured before setting up employee payouts." },
          { status: 400 }
        );
      }

      companyId = company.id;
      await prisma.employee.update({
        where: { id: employee.id },
        data: { companyId },
      });
    }

    let recipientId = employee.trolleyRecipientId;
    if (!recipientId) {
      try {
        const recipient = await createRecipient({
          type: "individual",
          firstName: employee.firstName,
          lastName: employee.lastName,
          email: employee.email,
          address: {
            street1: employee.addrLine1,
            street2: employee.addrLine2 ?? undefined,
            city: employee.addrCity,
            region: employee.addrProvince,
            postalCode: employee.addrPostal,
            country: employee.addrCountry,
          },
          referenceId: employee.id.toString(),
          tags: ["employee", "payroll"],
        });

        recipientId = recipient.id;
      } catch (error: unknown) {
        if (error instanceof TrolleyApiError && error.status === 400) {
          const duplicateRecipientId = extractDuplicateRecipientId(error);
          if (duplicateRecipientId) {
            recipientId = duplicateRecipientId;
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }
    }

    if (recipientId) {
      const recipient = await getRecipient(recipientId);
      await updateRecipient(recipient.id, {
        type: "individual",
        firstName: employee.firstName,
        lastName: employee.lastName,
        email: employee.email,
        address: {
          street1: employee.addrLine1,
          street2: employee.addrLine2 ?? undefined,
          city: employee.addrCity,
          region: employee.addrProvince,
          postalCode: employee.addrPostal,
          country: employee.addrCountry,
        },
      });
    }

    const account = await createRecipientAccount(recipientId, payload);
    const derived = deriveEmployeeStatusFromTrolleyRecipient({
      recipientId,
      recipientAccountId: account.id,
    });

    const updated = await prisma.employee.update({
      where: { id: employee.id },
      data: {
        trolleyRecipientId: recipientId,
        trolleyRecipientAccountId: account.id,
        trolleyRecipientAccountType: payload.type,
        payoutEnabled: derived.payoutEnabled,
        payoutSetupStatus: toPrismaEmployeePayoutStatus(derived.payoutSetupStatus),
      },
      select: {
        id: true,
        trolleyRecipientId: true,
        trolleyRecipientAccountId: true,
        trolleyRecipientAccountType: true,
        payoutEnabled: true,
        payoutSetupStatus: true,
      },
    });

    return NextResponse.json({
      ok: true,
      employeeId: updated.id.toString(),
      trolleyRecipientId: updated.trolleyRecipientId,
      trolleyRecipientAccountId: updated.trolleyRecipientAccountId,
      trolleyRecipientAccountType: updated.trolleyRecipientAccountType,
      payoutEnabled: updated.payoutEnabled,
      payoutSetupStatus: updated.payoutSetupStatus,
    });
  } catch (error: unknown) {
    if (error instanceof TrolleyApiError) {
      return NextResponse.json(
        {
          error: error.message,
          status: error.status,
          details: error.details,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to configure Trolley payout" },
      { status: 500 }
    );
  }
}
