import Stripe from "stripe";

let stripeClient: Stripe | null = null;

function getStripeClient() {
  if (stripeClient) return stripeClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  stripeClient = new Stripe(key);
  return stripeClient;
}

export async function createConnectedAccount(params: {
  employeeId: string;
  email: string;
  country?: string;
  companyId?: string;
}) {
  return getStripeClient().accounts.create({
    type: "express",
    email: params.email,
    country: params.country ?? "CA",
    capabilities: {
      transfers: { requested: true },
    },
    metadata: {
      employeeId: params.employeeId,
      ...(params.companyId ? { companyId: params.companyId } : {}),
    },
  });
}

export async function createCompanyConnectedAccount(params: {
  email: string;
  country?: string;
  companyName?: string;
  companyId?: string;
}) {
  return getStripeClient().accounts.create({
    type: "express",
    email: params.email,
    country: params.country ?? "CA",
    business_type: "company",
    capabilities: {
      transfers: { requested: true },
    },
    metadata: {
      companyAccount: "true",
      ...(params.companyId ? { companyId: params.companyId } : {}),
    },
    ...(params.companyName
      ? {
          company: {
            name: params.companyName,
          },
        }
      : {}),
  });
}

export async function retrieveConnectedAccount(accountId: string) {
  return getStripeClient().accounts.retrieve(accountId);
}

export async function createOnboardingLink(params: {
  accountId: string;
  refreshUrl: string;
  returnUrl: string;
}) {
  return getStripeClient().accountLinks.create({
    account: params.accountId,
    type: "account_onboarding",
    refresh_url: params.refreshUrl,
    return_url: params.returnUrl,
  });
}

export function constructWebhookEvent(rawBody: string, signature: string | null) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  }
  if (!signature) {
    throw new Error("Missing stripe-signature header");
  }

  return getStripeClient().webhooks.constructEvent(rawBody, signature, secret);
}
