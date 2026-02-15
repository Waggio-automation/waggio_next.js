const STRIPE_API_BASE = "https://api.stripe.com/v1";

function getSecretKey() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  return key;
}

async function stripeFormRequest<T>(
  path: string,
  body: URLSearchParams,
  method: "POST" | "GET" = "POST"
): Promise<T> {
  const res = await fetch(`${STRIPE_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getSecretKey()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: method === "GET" ? undefined : body.toString(),
    cache: "no-store",
  });

  const payload = await res.json();
  if (!res.ok) {
    const message = payload?.error?.message ?? "Payment provider request failed";
    throw new Error(message);
  }

  return payload as T;
}

type StripeAccount = {
  id: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  disabled_reason: string | null;
  requirements?: {
    currently_due?: string[];
  };
};

export async function createConnectedAccount(params: {
  employeeId: string;
  email: string;
  country?: string;
  companyId?: string;
}) {
  const body = new URLSearchParams();
  body.set("type", "express");
  body.set("email", params.email);
  body.set("country", params.country ?? "CA");
  body.set("capabilities[transfers][requested]", "true");
  body.set("metadata[employee_id]", params.employeeId);
  if (params.companyId) {
    body.set("metadata[company_id]", params.companyId);
  }

  return stripeFormRequest<StripeAccount>("/accounts", body);
}

export async function createCompanyConnectedAccount(params: {
  email: string;
  country?: string;
  companyName?: string;
  companyId?: string;
}) {
  const body = new URLSearchParams();
  body.set("type", "express");
  body.set("email", params.email);
  body.set("country", params.country ?? "CA");
  body.set("business_type", "company");
  body.set("capabilities[transfers][requested]", "true");
  body.set("metadata[company_account]", "true");
  if (params.companyId) {
    body.set("metadata[company_id]", params.companyId);
  }
  if (params.companyName) {
    body.set("company[name]", params.companyName);
  }

  return stripeFormRequest<StripeAccount>("/accounts", body);
}

export async function retrieveConnectedAccount(accountId: string) {
  return stripeFormRequest<StripeAccount>(`/accounts/${accountId}`, new URLSearchParams(), "GET");
}

export async function createOnboardingLink(params: {
  accountId: string;
  refreshUrl: string;
  returnUrl: string;
}) {
  const body = new URLSearchParams();
  body.set("account", params.accountId);
  body.set("type", "account_onboarding");
  body.set("refresh_url", params.refreshUrl);
  body.set("return_url", params.returnUrl);

  return stripeFormRequest<{ url: string }>("/account_links", body);
}
