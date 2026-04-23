import { NextResponse } from "next/server";
import Stripe from "stripe";
import {
  findCompanyByStripeCustomerId,
  getStripeClient,
  markCompanySubscriptionCancelled,
  syncCompanyFromStripeSubscription,
  syncCompanySubscriptionFromCheckoutSession,
  updateCompanyBillingStatusByCustomer,
} from "@/lib/stripe";

function getWebhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured.");
  }
  return secret;
}

function getCustomerId(value: string | Stripe.Customer | Stripe.DeletedCustomer | null) {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

export async function POST(req: Request) {
  let body: string;
  let event: Stripe.Event;
  try {
    body = await req.text();
    const signature = req.headers.get("stripe-signature");
    if (!signature) {
      return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 });
    }

    event = getStripeClient().webhooks.constructEvent(body, signature, getWebhookSecret());
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid webhook payload." },
      { status: 400 }
    );
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const companyIdRaw = session.metadata?.companyId;
        if (session.mode === "subscription" && session.id && companyIdRaw) {
          await syncCompanySubscriptionFromCheckoutSession(session.id, BigInt(companyIdRaw));
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = getCustomerId(subscription.customer);
        const companyIdRaw = subscription.metadata?.companyId;
        await syncCompanyFromStripeSubscription({
          subscription,
          customerId,
          companyId: companyIdRaw ? BigInt(companyIdRaw) : null,
        });
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = getCustomerId(subscription.customer);
        const company =
          (customerId ? await findCompanyByStripeCustomerId(customerId) : null) ?? null;

        const companyId =
          company?.id ??
          (subscription.metadata?.companyId ? BigInt(subscription.metadata.companyId) : null);

        if (companyId) {
          await markCompanySubscriptionCancelled({
            companyId,
            customerId,
            status: subscription.status,
          });
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = getCustomerId(invoice.customer);
        if (customerId) {
          await updateCompanyBillingStatusByCustomer({
            customerId,
            subscriptionStatus: "active",
          });
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = getCustomerId(invoice.customer);
        if (customerId) {
          await updateCompanyBillingStatusByCustomer({
            customerId,
            subscriptionStatus: "past_due",
          });
        }
        break;
      }

      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Webhook handling failed." },
      { status: 500 }
    );
  }
}
