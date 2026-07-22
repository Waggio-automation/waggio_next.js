import Stripe from "stripe";
import { type Company, type CompanyPlan } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getDateOnlyParts, getUtcDateOnlyMonthRange } from "@/lib/date-only";

const BASE_MONTHLY_PRICE: Record<CompanyPlan, number> = {
  BASIC: 1900,
  PRO: 3900,
};

const EMPLOYEE_MONTHLY_PRICE: Record<CompanyPlan, number> = {
  BASIC: 400,
  PRO: 600,
};

const INCLUDED_RUNS_PER_MONTH: Record<CompanyPlan, number> = {
  BASIC: 3,
  PRO: 4,
};

const EXTRA_RUN_FEE_CENTS: Record<CompanyPlan, number> = {
  BASIC: 1000,
  PRO: 800,
};

function getStripeSecretKey() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not configured.");
  }
  return key;
}

export function isStripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

let stripeClient: Stripe | null = null;

export function getStripeClient() {
  if (!stripeClient) {
    stripeClient = new Stripe(getStripeSecretKey(), {
      apiVersion: "2026-04-22.dahlia",
    });
  }
  return stripeClient;
}

export function getBillingOrigin() {
  const explicit =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_SITE_URL;

  const fromVercel = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : undefined;

  const origin = explicit ?? fromVercel ?? "http://localhost:3000";
  return origin.replace(/\/$/, "");
}

function getPlanDisplayName(plan: CompanyPlan) {
  return plan === "PRO" ? "Pro" : "Basic";
}

function getBillingMonthKey(date: Date) {
  const { year, monthIndex } = getDateOnlyParts(date);
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

function normalizeCurrentPeriodEnd(unixSeconds: number | null | undefined) {
  if (!unixSeconds) return null;
  return new Date(unixSeconds * 1000);
}

function getSubscriptionCurrentPeriodEnd(subscription: Stripe.Subscription) {
  const timestamps = subscription.items.data
    .map((item) => item.current_period_end)
    .filter((value): value is number => typeof value === "number");

  if (timestamps.length === 0) {
    return null;
  }

  return Math.max(...timestamps);
}

async function ensureStripeCustomer(company: Company) {
  const stripe = getStripeClient();

  if (company.stripeCustomerId) {
    return company.stripeCustomerId;
  }

  const customer = await stripe.customers.create({
    email: company.adminEmail,
    name: company.name ?? company.adminEmail,
    metadata: {
      companyId: company.id.toString(),
    },
  });

  await prisma.company.update({
    where: { id: company.id },
    data: {
      stripeCustomerId: customer.id,
    },
  });

  return customer.id;
}

function buildSubscriptionLineItems(plan: CompanyPlan, employeeCount: number) {
  const items = [
    {
      price_data: {
        currency: "cad",
        product_data: {
          name: `Waggio ${getPlanDisplayName(plan)} base plan`,
        },
        recurring: {
          interval: "month" as const,
        },
        unit_amount: BASE_MONTHLY_PRICE[plan],
      },
      quantity: 1,
    },
  ];

  if (employeeCount > 0) {
    items.push({
      price_data: {
        currency: "cad",
        product_data: {
          name: `Waggio ${getPlanDisplayName(plan)} employee seats`,
        },
        recurring: {
          interval: "month" as const,
        },
        unit_amount: EMPLOYEE_MONTHLY_PRICE[plan],
      },
      quantity: employeeCount,
    });
  }

  return items;
}

async function createProduct(params: { key: string; name: string }) {
  const stripe = getStripeClient();
  return stripe.products.create({
    name: params.name,
    metadata: {
      key: params.key,
    },
  });
}

async function getOrCreateCatalogProduct(productKey: "employee_seat" | "extra_payroll_run", plan?: CompanyPlan) {
  const stripe = getStripeClient();
  const key = plan ? `${productKey}_${plan}` : productKey;
  const search = await stripe.products.search({
    query: `metadata['key']:'${key}'`,
    limit: 1,
  });
  if (search.data[0]) {
    return search.data[0];
  }

  const label =
    productKey === "employee_seat"
      ? `Waggio ${getPlanDisplayName(plan!)} employee seats`
      : `Waggio ${getPlanDisplayName(plan!)} extra payroll run`;

  return createProduct({
    key,
    name: label,
  });
}

export async function createPlanCheckoutSession(params: {
  company: Company;
  plan: CompanyPlan;
  employeeCount: number;
}) {
  const stripe = getStripeClient();
  const customerId = await ensureStripeCustomer(params.company);
  const origin = getBillingOrigin();

  return stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    success_url: `${origin}/company-settings/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/company-settings?setup=billing_cancelled`,
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    line_items: buildSubscriptionLineItems(params.plan, params.employeeCount),
    metadata: {
      companyId: params.company.id.toString(),
      plan: params.plan,
      employeeCount: String(params.employeeCount),
    },
    subscription_data: {
      metadata: {
        companyId: params.company.id.toString(),
        plan: params.plan,
      },
    },
  });
}

async function upsertSubscriptionState(params: {
  companyId: bigint;
  customerId: string | null;
  subscription: Stripe.Subscription;
}) {
  await prisma.company.update({
    where: { id: params.companyId },
    data: {
      stripeCustomerId: params.customerId ?? undefined,
      stripeSubscriptionId: params.subscription.id,
      stripeSubscriptionStatus: params.subscription.status,
      stripeCurrentPeriodEnd: normalizeCurrentPeriodEnd(
        getSubscriptionCurrentPeriodEnd(params.subscription)
      ),
      currentPlan:
        params.subscription.metadata.plan === "PRO" ? "PRO" : params.subscription.metadata.plan === "BASIC" ? "BASIC" : undefined,
      planSelectedAt: new Date(),
    },
  });
}

export async function syncCompanySubscriptionFromCheckoutSession(sessionId: string, companyId: bigint) {
  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["subscription"],
  });

  if (!session.subscription || typeof session.subscription === "string") {
    throw new Error("Stripe checkout session does not include a subscription.");
  }

  await upsertSubscriptionState({
    companyId,
    customerId: typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
    subscription: session.subscription,
  });

  return session.subscription;
}

export async function createBillingPortalSession(company: Company) {
  if (!company.stripeCustomerId) {
    throw new Error("Stripe customer is not set for this company.");
  }

  const stripe = getStripeClient();
  return stripe.billingPortal.sessions.create({
    customer: company.stripeCustomerId,
    return_url: `${getBillingOrigin()}/company-settings`,
  });
}

async function upsertSubscriptionStateFromData(params: {
  companyId: bigint;
  customerId: string | null;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  currentPlan?: CompanyPlan | null;
  currentPeriodEnd?: Date | null;
}) {
  await prisma.company.update({
    where: { id: params.companyId },
    data: {
      stripeCustomerId: params.customerId ?? undefined,
      stripeSubscriptionId: params.subscriptionId ?? undefined,
      stripeSubscriptionStatus: params.subscriptionStatus ?? undefined,
      stripeCurrentPeriodEnd: params.currentPeriodEnd ?? undefined,
      currentPlan: params.currentPlan ?? undefined,
      ...(params.currentPlan ? { planSelectedAt: new Date() } : {}),
    },
  });
}

export async function syncCompanySubscriptionState(companyId: bigint) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
  });
  if (!company?.stripeSubscriptionId) {
    return null;
  }

  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(company.stripeSubscriptionId);

  await upsertSubscriptionState({
    companyId,
    customerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
    subscription,
  });

  return subscription;
}

export async function findCompanyByStripeCustomerId(customerId: string) {
  return prisma.company.findUnique({
    where: { stripeCustomerId: customerId },
  });
}

export async function findCompanyByStripeSubscriptionId(subscriptionId: string) {
  return prisma.company.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
  });
}

export async function syncCompanyFromStripeSubscription(params: {
  subscription: Stripe.Subscription;
  customerId?: string | null;
  companyId?: bigint | null;
}) {
  let companyId = params.companyId ?? null;
  if (!companyId) {
    const company =
      (params.customerId ? await findCompanyByStripeCustomerId(params.customerId) : null) ??
      (await findCompanyByStripeSubscriptionId(params.subscription.id));
    companyId = company?.id ?? null;
  }

  if (!companyId) {
    return null;
  }

  await upsertSubscriptionState({
    companyId,
    customerId:
      params.customerId ??
      (typeof params.subscription.customer === "string"
        ? params.subscription.customer
        : params.subscription.customer.id),
    subscription: params.subscription,
  });

  return companyId;
}

export async function markCompanySubscriptionCancelled(params: {
  companyId: bigint;
  customerId?: string | null;
  status?: string | null;
}) {
  await upsertSubscriptionStateFromData({
    companyId: params.companyId,
    customerId: params.customerId ?? null,
    subscriptionId: null,
    subscriptionStatus: params.status ?? "canceled",
    currentPeriodEnd: null,
  });
}

export async function updateCompanyBillingStatusByCustomer(params: {
  customerId: string;
  subscriptionStatus?: string | null;
}) {
  const company = await findCompanyByStripeCustomerId(params.customerId);
  if (!company) return null;

  await prisma.company.update({
    where: { id: company.id },
    data: {
      stripeSubscriptionStatus: params.subscriptionStatus ?? undefined,
    },
  });

  return company.id;
}

export async function changeCompanySubscriptionPlan(params: {
  company: Company;
  plan: CompanyPlan;
  employeeCount: number;
}) {
  if (!params.company.stripeSubscriptionId) {
    throw new Error("No Stripe subscription exists for this company.");
  }

  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(params.company.stripeSubscriptionId);
  const existingItems = subscription.items.data;

  if (existingItems.length === 0) {
    throw new Error("Stripe subscription does not contain billable items.");
  }

  const items: Stripe.SubscriptionUpdateParams.Item[] = [
    {
      id: existingItems[0].id,
      price_data: {
        currency: "cad",
        product:
          typeof existingItems[0].price.product === "string"
            ? existingItems[0].price.product
            : existingItems[0].price.product.id,
        recurring: {
          interval: "month" as const,
        },
        unit_amount: BASE_MONTHLY_PRICE[params.plan],
      },
      quantity: 1,
    },
  ];

  const seatItem = existingItems[1];
  if (params.employeeCount > 0) {
    const seatProductId = seatItem
      ? typeof seatItem.price.product === "string"
        ? seatItem.price.product
        : seatItem.price.product.id
      : (
          await getOrCreateCatalogProduct("employee_seat", params.plan)
        ).id;

    items.push({
      ...(seatItem ? { id: seatItem.id } : {}),
      price_data: {
        currency: "cad",
        product: seatProductId,
        recurring: {
          interval: "month" as const,
        },
        unit_amount: EMPLOYEE_MONTHLY_PRICE[params.plan],
      },
      quantity: params.employeeCount,
    });
  } else if (seatItem) {
    items.push({
      id: seatItem.id,
      deleted: true,
    });
  }

  const updated = await stripe.subscriptions.update(subscription.id, {
    items,
    proration_behavior: "create_prorations",
    metadata: {
      ...subscription.metadata,
      plan: params.plan,
    },
  });

  await upsertSubscriptionState({
    companyId: params.company.id,
    customerId: typeof updated.customer === "string" ? updated.customer : updated.customer.id,
    subscription: updated,
  });

  return updated;
}

export async function syncCompanyEmployeeSeatQuantity(companyId: bigint) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
  });
  if (!company?.stripeSubscriptionId || !company.currentPlan) {
    return null;
  }

  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(company.stripeSubscriptionId);
  const employeeCount = await prisma.employee.count({
    where: { companyId },
  });
  const existingItems = subscription.items.data;
  const seatItem = existingItems[1];
  const items: Stripe.SubscriptionUpdateParams.Item[] = [];

  if (seatItem && employeeCount === 0) {
    items.push({
      id: seatItem.id,
      deleted: true,
    });
  } else if (employeeCount > 0) {
    const seatProductId = seatItem
      ? typeof seatItem.price.product === "string"
        ? seatItem.price.product
        : seatItem.price.product.id
      : (await getOrCreateCatalogProduct("employee_seat", company.currentPlan)).id;

    items.push({
      ...(seatItem ? { id: seatItem.id } : {}),
      price_data: {
        currency: "cad",
        product: seatProductId,
        recurring: {
          interval: "month" as const,
        },
        unit_amount: EMPLOYEE_MONTHLY_PRICE[company.currentPlan],
      },
      quantity: employeeCount,
    });
  }

  if (items.length === 0) {
    return subscription;
  }

  const updated = await stripe.subscriptions.update(subscription.id, {
    items,
    proration_behavior: "create_prorations",
  });

  await upsertSubscriptionState({
    companyId,
    customerId: typeof updated.customer === "string" ? updated.customer : updated.customer.id,
    subscription: updated,
  });

  return updated;
}

export async function billExtraPayrollRunIfNeeded(payrollRunId: bigint) {
  const run = await prisma.payrollRun.findUnique({
    where: { id: payrollRunId },
    include: {
      company: true,
    },
  });

  if (!run?.companyId || !run.company?.currentPlan || !run.company.stripeCustomerId) {
    return { billed: false, reason: "company_not_billable" } as const;
  }

  if (run.extraRunBilledAt || run.extraRunInvoiceItemId || run.extraRunFeeCents != null) {
    return { billed: false, reason: "already_evaluated" } as const;
  }

  const plan = run.company.currentPlan;
  const monthKey = getBillingMonthKey(run.payDate);
  const billingMonthRange = getUtcDateOnlyMonthRange(run.payDate);
  const candidateRuns = await prisma.payrollRun.findMany({
    where: {
      companyId: run.companyId,
      payDate: {
        gte: billingMonthRange.start,
        lt: billingMonthRange.endExclusive,
      },
      status: {
        in: ["PAYING", "PAID"],
      },
    },
    orderBy: [{ payDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
    },
  });

  const sequence = candidateRuns.findIndex((item) => item.id === run.id) + 1;
  if (sequence <= 0) {
    return { billed: false, reason: "sequence_not_found" } as const;
  }

  const includedRuns = INCLUDED_RUNS_PER_MONTH[plan];
  const feeCents = sequence > includedRuns ? EXTRA_RUN_FEE_CENTS[plan] : 0;

  if (feeCents <= 0) {
    await prisma.payrollRun.update({
      where: { id: run.id },
      data: {
        billingMonthKey: monthKey,
        extraRunSequence: sequence,
        extraRunFeeCents: 0,
        extraRunBillingError: null,
      },
    });
    return { billed: false, reason: "within_included_runs", sequence } as const;
  }

  try {
    const stripe = getStripeClient();
    const product = await getOrCreateCatalogProduct("extra_payroll_run", plan);
    const invoiceItem = await stripe.invoiceItems.create({
      customer: run.company.stripeCustomerId,
      amount: feeCents,
      currency: "cad",
      description: `${getPlanDisplayName(plan)} extra payroll run for ${monthKey}`,
      ...(run.company.stripeSubscriptionId ? { subscription: run.company.stripeSubscriptionId } : {}),
      metadata: {
        companyId: run.company.id.toString(),
        payrollRunId: run.id.toString(),
        billingMonthKey: monthKey,
        sequence: String(sequence),
        plan,
        productId: product.id,
      },
    });

    await prisma.payrollRun.update({
      where: { id: run.id },
      data: {
        billingMonthKey: monthKey,
        extraRunSequence: sequence,
        extraRunFeeCents: feeCents,
        extraRunInvoiceItemId: invoiceItem.id,
        extraRunBilledAt: new Date(),
        extraRunBillingError: null,
      },
    });

    return { billed: true, sequence, feeCents, invoiceItemId: invoiceItem.id } as const;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to create Stripe invoice item.";
    await prisma.payrollRun.update({
      where: { id: run.id },
      data: {
        billingMonthKey: monthKey,
        extraRunSequence: sequence,
        extraRunFeeCents: feeCents,
        extraRunBillingError: message,
      },
    });
    return { billed: false, reason: "stripe_error", sequence, feeCents, error: message } as const;
  }
}
