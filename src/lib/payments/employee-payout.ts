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
import {
  buildTrolleyRecipientReferenceId,
  buildTrolleyTags,
  getOrCreateTrolleyTenantContext,
} from "@/lib/payments/trolley-tenancy";

export const bankTransferPayoutSchema = z
  .object({
    type: z.literal("bank-transfer"),
    primary: z.boolean().optional(),
    country: z.string().length(2),
    currency: z.string().length(3),
    accountHolderName: z.string().min(1),
    accountNumber: z.string().optional(),
    accountNum: z.string().optional(),
    institutionNumber: z.string().optional(),
    bankId: z.string().optional(),
    transitBranchNumber: z.string().optional(),
    branchId: z.string().optional(),
    iban: z.string().optional(),
    swiftBic: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    const accountNumber = value.accountNumber ?? value.accountNum;
    const institutionNumber = value.institutionNumber ?? value.bankId;
    const transitBranchNumber = value.transitBranchNumber ?? value.branchId;

    if (!accountNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Account Number is required for bank transfers.",
        path: ["accountNumber"],
      });
    }

    if (value.country.toUpperCase() === "CA" && !institutionNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Institution Number is required for Canadian bank transfers.",
        path: ["institutionNumber"],
      });
    } else if (value.country.toUpperCase() === "CA" && !/^\d{3}$/.test(institutionNumber ?? "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Institution Number must be exactly 3 digits for Canadian bank transfers.",
        path: ["institutionNumber"],
      });
    }

    if (value.country.toUpperCase() === "CA" && !transitBranchNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Transit / Branch Number is required for Canadian bank transfers.",
        path: ["transitBranchNumber"],
      });
    } else if (value.country.toUpperCase() === "CA" && !/^\d{5}$/.test(transitBranchNumber ?? "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Transit / Branch Number must be exactly 5 digits for Canadian bank transfers.",
        path: ["transitBranchNumber"],
      });
    }

    if (value.country.toUpperCase() === "CA" && !/^\d{7,12}$/.test(accountNumber ?? "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Account Number must be 7 to 12 digits for Canadian bank transfers.",
        path: ["accountNumber"],
      });
    }
  })
  .transform((value) => ({
    type: value.type,
    primary: value.primary,
    country: value.country,
    currency: value.currency,
    accountHolderName: value.accountHolderName,
    accountNumber: value.accountNumber ?? value.accountNum ?? "",
    institutionNumber: value.institutionNumber ?? value.bankId,
    transitBranchNumber: value.transitBranchNumber ?? value.branchId,
    iban: value.iban,
    swiftBic: value.swiftBic,
  }));

export const paypalPayoutSchema = z.object({
  type: z.literal("paypal"),
  primary: z.boolean().optional(),
  currency: z.string().length(3),
  emailAddress: z.string().email(),
});

export const employeePayoutPayloadSchema = z.union([
  bankTransferPayoutSchema,
  paypalPayoutSchema,
]);

export type EmployeePayoutPayload = z.infer<typeof employeePayoutPayloadSchema>;

function isInvalidRecipientAccountStatus(status: string | undefined) {
  if (!status) return false;
  return ["invalid", "rejected", "failed", "error"].includes(status.toLowerCase());
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

function getRecipientAccountId(account: { id?: string; recipientAccountId?: string }) {
  return account.id ?? account.recipientAccountId;
}

export async function configureEmployeePayout(params: {
  companyId: bigint;
  employeeId: bigint;
  payload: EmployeePayoutPayload;
}) {
  const employee = await prisma.employee.findUnique({
    where: { id: params.employeeId, companyId: params.companyId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      payoutSetupStatus: true,
      payoutEnabled: true,
      trolleyRecipientId: true,
      trolleyReferenceId: true,
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
    throw new Error("Employee not found");
  }

  const tenantContext = await getOrCreateTrolleyTenantContext(params.companyId);
  const recipientReferenceId =
    employee.trolleyReferenceId ??
    buildTrolleyRecipientReferenceId({
      companyId: params.companyId,
      employeeId: employee.id,
    });

  let recipientId = employee.trolleyRecipientId;
  let reusedExistingRecipient = false;
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
        referenceId: recipientReferenceId,
        tags: buildTrolleyTags(tenantContext, "recipient", ["employee", "payroll"]),
      });

      recipientId = recipient.id;
    } catch (error: unknown) {
      if (error instanceof TrolleyApiError && error.status === 400) {
        const duplicateRecipientId = extractDuplicateRecipientId(error);
        if (duplicateRecipientId) {
          recipientId = duplicateRecipientId;
          reusedExistingRecipient = true;
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
  }

  if (recipientId && !reusedExistingRecipient) {
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
      referenceId: recipientReferenceId,
      tags: buildTrolleyTags(tenantContext, "recipient", ["employee", "payroll"]),
    });
  }

  const account = await createRecipientAccount(
    recipientId,
    params.payload.type === "bank-transfer"
      ? {
          type: "bank-transfer",
          primary: params.payload.primary,
          country: params.payload.country,
          currency: params.payload.currency,
          accountHolderName: params.payload.accountHolderName,
          accountNum: params.payload.accountNumber,
          bankId: params.payload.institutionNumber,
          branchId: params.payload.transitBranchNumber,
          iban: params.payload.iban,
          swiftBic: params.payload.swiftBic,
        }
      : params.payload
  );
  if (isInvalidRecipientAccountStatus(account.status)) {
    throw new Error("The bank account details are invalid. Please check the account holder name, Institution Number, Transit / Branch Number, and Account Number.");
  }

  const accountId = getRecipientAccountId(account);
  if (!accountId) {
    throw new Error("Trolley created the recipient account but did not return an account id.");
  }

  const derived = deriveEmployeeStatusFromTrolleyRecipient({
    recipientId,
    recipientAccountId: accountId,
  });

  return prisma.employee.update({
    where: { id: employee.id, companyId: params.companyId },
    data: {
      trolleyRecipientId: recipientId,
      trolleyReferenceId: recipientReferenceId,
      trolleyRecipientAccountId: accountId,
      trolleyRecipientAccountType: params.payload.type,
      institutionNumber: params.payload.type === "bank-transfer" ? params.payload.institutionNumber ?? null : null,
      transitBranchNumber: params.payload.type === "bank-transfer" ? params.payload.transitBranchNumber ?? null : null,
      accountNumber: params.payload.type === "bank-transfer" ? params.payload.accountNumber : null,
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
}
