import { createHmac } from "node:crypto";
import { inspect } from "node:util";

const DEFAULT_TROLLEY_BASE_URL = "https://api.trolley.com";
const API_VERSION_PREFIX = "/v1";

export type CountryCode = string;
export type CurrencyCode = string;
export type RecipientType = "individual" | "business";
export type RecipientAccountType = "bank-transfer" | "paypal";
export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface TrolleyAddress {
  street1?: string;
  street2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: CountryCode;
  phone?: string;
}

interface RecipientBaseInput {
  email: string;
  address?: TrolleyAddress;
  referenceId?: string;
  tags?: string[];
}

export interface CreateIndividualRecipientInput extends RecipientBaseInput {
  type: "individual";
  firstName: string;
  lastName: string;
}

export interface CreateBusinessRecipientInput extends RecipientBaseInput {
  type: "business";
  name: string;
}

export type CreateRecipientInput =
  | CreateIndividualRecipientInput
  | CreateBusinessRecipientInput;

export type UpdateRecipientInput = Partial<CreateRecipientInput> & {
  email?: string;
  address?: TrolleyAddress;
  tags?: string[];
};

export interface ListRecipientsParams {
  page?: number;
  pageSize?: number;
  search?: string;
  email?: string;
  type?: RecipientType;
}

interface RecipientBaseRecord {
  id: string;
  type: RecipientType;
  email: string;
  address?: TrolleyAddress;
  referenceId?: string;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface IndividualRecipient extends RecipientBaseRecord {
  type: "individual";
  firstName: string;
  lastName: string;
}

export interface BusinessRecipient extends RecipientBaseRecord {
  type: "business";
  name: string;
}

export type Recipient = IndividualRecipient | BusinessRecipient;

interface RecipientAccountBaseInput {
  type: RecipientAccountType;
  primary?: boolean;
}

export interface BankTransferRecipientAccountInput extends RecipientAccountBaseInput {
  type: "bank-transfer";
  country: CountryCode;
  currency: CurrencyCode;
  accountHolderName: string;
  accountNum: string;
  bankId?: string;
  branchId?: string;
  iban?: string;
  swiftBic?: string;
}

export interface PaypalRecipientAccountInput extends RecipientAccountBaseInput {
  type: "paypal";
  currency: CurrencyCode;
  emailAddress: string;
}

export type CreateRecipientAccountInput =
  | BankTransferRecipientAccountInput
  | PaypalRecipientAccountInput;

export interface RecipientAccount {
  id: string;
  recipientId?: string;
  type: RecipientAccountType;
  primary?: boolean;
  currency?: CurrencyCode;
  country?: CountryCode;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface CreateBatchInput {
  name: string;
  sourceCurrency: CurrencyCode;
  description?: string;
  externalId?: string;
  metadata?: Record<string, string>;
  tags?: string[];
}

export interface Batch {
  id: string;
  name?: string;
  sourceCurrency?: CurrencyCode;
  status?: string;
  description?: string;
  externalId?: string;
  metadata?: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface CreatePaymentInput {
  recipient: {
    id?: string;
    email?: string;
    referenceId?: string;
  };
  amount: string;
  currency: CurrencyCode;
  description?: string;
  externalId?: string;
  metadata?: Record<string, string>;
  tags?: string[];
}

export interface Payment {
  id: string;
  batchId?: string;
  recipientId?: string;
  recipientAccountId?: string;
  amount?: string;
  currency?: CurrencyCode;
  status?: string;
  externalId?: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface BatchProcessingResult {
  id?: string;
  batchId?: string;
  status?: string;
  startedAt?: string;
  [key: string]: unknown;
}

export interface TrolleyPaginatedResponse<TItem> {
  items: TItem[];
  page?: number;
  pageSize?: number;
  totalCount?: number;
  hasMore?: boolean;
  [key: string]: unknown;
}

type QueryValue = string | number | boolean | undefined;
type QueryParams = Record<string, QueryValue>;

interface TrolleyClientOptions {
  accessKey?: string;
  secretKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class TrolleyApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;
  readonly requestId?: string | null;

  constructor(params: {
    message: string;
    status: number;
    code?: string;
    details?: unknown;
    requestId?: string | null;
  }) {
    super(params.message);
    this.name = "TrolleyApiError";
    this.status = params.status;
    this.code = params.code;
    this.details = params.details;
    this.requestId = params.requestId;
  }
}

function getEnvOrThrow(name: "TROLLEY_ACCESS_KEY" | "TROLLEY_SECRET_KEY") {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
}

function normalizeBaseUrl(baseUrl?: string) {
  return (baseUrl ?? process.env.TROLLEY_BASE_URL ?? DEFAULT_TROLLEY_BASE_URL).replace(
    /\/+$/,
    ""
  );
}

function normalizeCountryCode(countryCode?: string) {
  return countryCode?.toUpperCase();
}

function normalizeCurrencyCode(currencyCode?: string) {
  return currencyCode?.toUpperCase();
}

function buildQueryString(params?: QueryParams) {
  if (!params) return "";

  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    searchParams.set(key, String(value));
  }

  const serialized = searchParams.toString();
  return serialized.length > 0 ? `?${serialized}` : "";
}

function assertRecipientInput(input: CreateRecipientInput) {
  const type = input.type;

  if (type === "individual") {
    if (!input.firstName || !input.lastName || !input.email) {
      throw new Error("Individual recipients require firstName, lastName, and email");
    }
  }

  if (type === "business") {
    if (!input.name || !input.email) {
      throw new Error("Business recipients require name and email");
    }
  }
}

function assertRecipientUpdateInput(input: UpdateRecipientInput) {
  if (input.type === "individual") {
    if ("firstName" in input && !input.firstName) {
      throw new Error("Individual recipient updates require a non-empty firstName");
    }
    if ("lastName" in input && !input.lastName) {
      throw new Error("Individual recipient updates require a non-empty lastName");
    }
    if ("email" in input && !input.email) {
      throw new Error("Individual recipient updates require a non-empty email");
    }
  }

  if (input.type === "business") {
    if ("name" in input && !input.name) {
      throw new Error("Business recipient updates require a non-empty name");
    }
    if ("email" in input && !input.email) {
      throw new Error("Business recipient updates require a non-empty email");
    }
  }
}

function assertRecipientAccountInput(input: CreateRecipientAccountInput) {
  if (input.type === "bank-transfer") {
    if (
      !input.country ||
      !input.currency ||
      !input.accountHolderName ||
      !input.accountNum
    ) {
      throw new Error(
        "Bank-transfer accounts require country, currency, accountHolderName, and accountNum"
      );
    }

    const country = normalizeCountryCode(input.country);
    if (country === "CA" && !input.bankId) {
      throw new Error("Canadian bank-transfer accounts require bankId");
    }
    if (country === "CA" && !input.branchId) {
      throw new Error("Canadian bank-transfer accounts require branchId");
    }
  }

  if (input.type === "paypal") {
    if (!input.currency || !input.emailAddress) {
      throw new Error("PayPal accounts require currency and emailAddress");
    }
  }
}

function sanitizeRecipientInput<T extends CreateRecipientInput | UpdateRecipientInput>(input: T): T {
  const next = {
    ...input,
    address: input.address
      ? {
          ...input.address,
          country: normalizeCountryCode(input.address.country),
        }
      : undefined,
  };

  return next;
}

function sanitizeRecipientAccountInput<T extends CreateRecipientAccountInput>(input: T): T {
  if (input.type === "bank-transfer") {
    return {
      ...input,
      country: normalizeCountryCode(input.country) ?? input.country,
      currency: normalizeCurrencyCode(input.currency) ?? input.currency,
    };
  }

  return {
    ...input,
    currency: normalizeCurrencyCode(input.currency) ?? input.currency,
  };
}

function sanitizeBatchInput(input: CreateBatchInput): CreateBatchInput {
  return {
    ...input,
    sourceCurrency: normalizeCurrencyCode(input.sourceCurrency) ?? input.sourceCurrency,
  };
}

function sanitizePaymentInput(input: CreatePaymentInput): CreatePaymentInput {
  return {
    ...input,
    currency: normalizeCurrencyCode(input.currency) ?? input.currency,
  };
}

function extractResource<T>(payload: unknown, keys: string[]): T {
  if (!payload || typeof payload !== "object") {
    return payload as T;
  }

  for (const key of keys) {
    if (key in payload) {
      return (payload as Record<string, unknown>)[key] as T;
    }
  }

  return payload as T;
}

function summarizeForLog(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const record = payload as Record<string, unknown>;
  const nested =
    (typeof record.recipient === "object" && record.recipient) ||
    (typeof record.account === "object" && record.account) ||
    (typeof record.recipientAccount === "object" && record.recipientAccount) ||
    (typeof record.batch === "object" && record.batch) ||
    (typeof record.payment === "object" && record.payment) ||
    (typeof record.data === "object" && record.data) ||
    record;

  if (!nested || typeof nested !== "object") {
    return payload;
  }

  const next = nested as Record<string, unknown>;

  return {
    id: typeof next.id === "string" ? next.id : undefined,
    status: typeof next.status === "string" ? next.status : undefined,
    type: typeof next.type === "string" ? next.type : undefined,
    message:
      typeof record.message === "string"
        ? record.message
        : typeof record.error === "string"
          ? record.error
          : typeof next.message === "string"
            ? next.message
            : undefined,
    errors: Array.isArray(record.errors) ? record.errors : undefined,
    raw: "raw" in record ? record.raw : undefined,
    recipientId:
      typeof next.recipientId === "string"
        ? next.recipientId
        : typeof next.recipient === "string"
          ? next.recipient
          : undefined,
    batchId:
      typeof next.batchId === "string"
        ? next.batchId
        : typeof next.batch === "string"
          ? next.batch
          : undefined,
    paymentId:
      typeof next.paymentId === "string"
        ? next.paymentId
        : typeof next.payment === "string"
          ? next.payment
          : undefined,
  };
}

function logTrolleyResponse(label: string, payload: Record<string, unknown>) {
  console.log(`[trolley] ${label} ${inspect(payload, { depth: 10, colors: false, compact: false })}`);
}

export class TrolleyClient {
  private readonly accessKey: string;
  private readonly secretKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TrolleyClientOptions = {}) {
    this.accessKey = options.accessKey ?? getEnvOrThrow("TROLLEY_ACCESS_KEY");
    this.secretKey = options.secretKey ?? getEnvOrThrow("TROLLEY_SECRET_KEY");
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private createSignature(timestamp: string, method: HttpMethod, requestPath: string, body: string) {
    const payload = `${timestamp}\n${method}\n${requestPath}\n${body}\n`;

    return createHmac("sha256", this.secretKey).update(payload, "utf8").digest("hex");
  }

  private async signedRequest<TResponse, TBody extends object | undefined = undefined>(params: {
    method: HttpMethod;
    path: string;
    query?: QueryParams;
    body?: TBody;
  }): Promise<TResponse> {
    const requestPath = `${API_VERSION_PREFIX}${params.path}${buildQueryString(params.query)}`;
    const body = params.body ? JSON.stringify(params.body) : "";
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = this.createSignature(timestamp, params.method, requestPath, body);

    const response = await this.fetchImpl(`${this.baseUrl}${requestPath}`, {
      method: params.method,
      headers: {
        Authorization: `prsign ${this.accessKey}:${signature}`,
        "X-PR-Timestamp": timestamp,
        "Content-Type": "application/json",
      },
      body: body || undefined,
      cache: "no-store",
    });

    const requestId = response.headers.get("x-request-id");
    const text = await response.text();
    const data = text.length > 0 ? safeJsonParse(text) : null;

    if (!response.ok) {
      const errorPayload =
        data && typeof data === "object" ? (data as Record<string, unknown>) : undefined;

      logTrolleyResponse("error response", {
        method: params.method,
        path: requestPath,
        status: response.status,
        requestId,
        body: summarizeForLog(data),
      });

      throw new TrolleyApiError({
        status: response.status,
        requestId,
        code:
          typeof errorPayload?.code === "string"
            ? errorPayload.code
            : typeof errorPayload?.errorCode === "string"
              ? errorPayload.errorCode
              : undefined,
        message:
          typeof errorPayload?.message === "string"
            ? errorPayload.message
            : typeof errorPayload?.error === "string"
              ? errorPayload.error
              : typeof errorPayload?.raw === "string"
                ? errorPayload.raw
              : `Trolley API request failed with status ${response.status}`,
        details: data,
      });
    }

    logTrolleyResponse("response", {
      method: params.method,
      path: requestPath,
      status: response.status,
      requestId,
      body: summarizeForLog(data),
    });

    return data as TResponse;
  }

  async createRecipient(input: CreateRecipientInput): Promise<Recipient> {
    assertRecipientInput(input);

    const payload = sanitizeRecipientInput(input);
    const response = await this.signedRequest<unknown, CreateRecipientInput>({
      method: "POST",
      path: "/recipients",
      body: payload,
    });

    return extractResource<Recipient>(response, ["recipient", "data"]);
  }

  async getRecipient(recipientId: string): Promise<Recipient> {
    const response = await this.signedRequest<unknown>({
      method: "GET",
      path: `/recipients/${recipientId}`,
    });

    return extractResource<Recipient>(response, ["recipient", "data"]);
  }

  async updateRecipient(recipientId: string, input: UpdateRecipientInput): Promise<Recipient> {
    assertRecipientUpdateInput(input);

    const payload = sanitizeRecipientInput(input);
    const response = await this.signedRequest<unknown, UpdateRecipientInput>({
      method: "PATCH",
      path: `/recipients/${recipientId}`,
      body: payload,
    });

    return extractResource<Recipient>(response, ["recipient", "data"]);
  }

  async deleteRecipient(recipientId: string): Promise<{ id?: string; deleted?: boolean }> {
    const response = await this.signedRequest<unknown>({
      method: "DELETE",
      path: `/recipients/${recipientId}`,
    });

    return extractResource<{ id?: string; deleted?: boolean }>(response, ["recipient", "data"]);
  }

  async listRecipients(params: ListRecipientsParams = {}): Promise<TrolleyPaginatedResponse<Recipient>> {
    const response = await this.signedRequest<unknown>({
      method: "GET",
      path: "/recipients",
      query: {
        page: params.page,
        pageSize: params.pageSize,
        search: params.search,
        email: params.email,
        type: params.type,
      },
    });

    const payload = (response ?? {}) as Record<string, unknown>;
    const items =
      Array.isArray(payload.items)
        ? (payload.items as Recipient[])
        : Array.isArray(payload.recipients)
          ? (payload.recipients as Recipient[])
          : Array.isArray(payload.data)
            ? (payload.data as Recipient[])
            : [];

    return {
      ...payload,
      items,
    };
  }

  async createRecipientAccount(
    recipientId: string,
    input: CreateRecipientAccountInput
  ): Promise<RecipientAccount> {
    assertRecipientAccountInput(input);

    const payload = sanitizeRecipientAccountInput(input);
    const response = await this.signedRequest<unknown, CreateRecipientAccountInput>({
      method: "POST",
      path: `/recipients/${recipientId}/accounts`,
      body: payload,
    });

    return extractResource<RecipientAccount>(response, ["account", "recipientAccount", "data"]);
  }

  async createBatch(input: CreateBatchInput): Promise<Batch> {
    const payload = sanitizeBatchInput(input);
    const response = await this.signedRequest<unknown, CreateBatchInput>({
      method: "POST",
      path: "/batches",
      body: payload,
    });

    return extractResource<Batch>(response, ["batch", "data"]);
  }

  async createPayment(batchId: string, input: CreatePaymentInput): Promise<Payment> {
    const payload = sanitizePaymentInput(input);
    const response = await this.signedRequest<unknown, CreatePaymentInput>({
      method: "POST",
      path: `/batches/${batchId}/payments`,
      body: payload,
    });

    return extractResource<Payment>(response, ["payment", "data"]);
  }

  async startBatchProcessing(batchId: string): Promise<BatchProcessingResult> {
    const response = await this.signedRequest<unknown>({
      method: "POST",
      path: `/batches/${batchId}/start-processing`,
    });

    return extractResource<BatchProcessingResult>(response, ["batch", "data"]);
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

let trolleyClient: TrolleyClient | null = null;

export function getTrolleyClient() {
  trolleyClient ??= new TrolleyClient();
  return trolleyClient;
}

export const createRecipient = (input: CreateRecipientInput) =>
  getTrolleyClient().createRecipient(input);

export const getRecipient = (recipientId: string) =>
  getTrolleyClient().getRecipient(recipientId);

export const updateRecipient = (recipientId: string, input: UpdateRecipientInput) =>
  getTrolleyClient().updateRecipient(recipientId, input);

export const deleteRecipient = (recipientId: string) =>
  getTrolleyClient().deleteRecipient(recipientId);

export const listRecipients = (params?: ListRecipientsParams) =>
  getTrolleyClient().listRecipients(params);

export const createRecipientAccount = (
  recipientId: string,
  input: CreateRecipientAccountInput
) => getTrolleyClient().createRecipientAccount(recipientId, input);

export const createBatch = (input: CreateBatchInput) =>
  getTrolleyClient().createBatch(input);

export const createPayment = (batchId: string, input: CreatePaymentInput) =>
  getTrolleyClient().createPayment(batchId, input);

export const startBatchProcessing = (batchId: string) =>
  getTrolleyClient().startBatchProcessing(batchId);
