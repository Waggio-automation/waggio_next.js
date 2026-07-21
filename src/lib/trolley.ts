import { createHmac } from "node:crypto";

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
  id?: string;
  recipientAccountId?: string;
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
  batch?: { id?: string; [key: string]: unknown };
  recipientId?: string;
  recipientAccountId?: string;
  amount?: string;
  sourceAmount?: string;
  currency?: CurrencyCode;
  sourceCurrency?: CurrencyCode;
  status?: string;
  externalId?: string;
  metadata?: Record<string, string>;
  description?: string;
  processedAt?: string | null;
  returnedAt?: string | null;
  returnedReason?: unknown[];
  failureMessage?: string | null;
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

export const DEFAULT_TROLLEY_REQUEST_TIMEOUT_MS = 5_000;

interface TrolleyClientOptions {
  accessKey?: string;
  secretKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
}

export class TrolleyApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;
  readonly requestId?: string | null;
  readonly retryAfterMs?: number;

  constructor(params: {
    message: string;
    status: number;
    code?: string;
    details?: unknown;
    requestId?: string | null;
    retryAfterMs?: number;
  }) {
    super(params.message);
    this.name = "TrolleyApiError";
    this.status = params.status;
    this.code = params.code;
    this.details = params.details;
    this.requestId = params.requestId;
    this.retryAfterMs = params.retryAfterMs;
  }
}

export class TrolleyRequestTimeoutError extends Error {
  readonly code = "TROLLEY_PROVIDER_REQUEST_TIMEOUT";
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super("Trolley provider request timed out.");
    this.name = "TrolleyRequestTimeoutError";
    this.timeoutMs = timeoutMs;
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

function parseRetryAfterMs(value: string | null, nowMs = Date.now()) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return undefined;
  return Math.max(0, instant - nowMs);
}

function logTrolleyResponse(label: string, payload: { method: HttpMethod; status: number }) {
  console.log(`[trolley] ${label}`, payload);
}

export class TrolleyClient {
  private readonly accessKey: string;
  private readonly secretKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;

  constructor(options: TrolleyClientOptions = {}) {
    this.accessKey = options.accessKey ?? getEnvOrThrow("TROLLEY_ACCESS_KEY");
    this.secretKey = options.secretKey ?? getEnvOrThrow("TROLLEY_SECRET_KEY");
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMs = Math.max(1, options.requestTimeoutMs ?? DEFAULT_TROLLEY_REQUEST_TIMEOUT_MS);
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
    timeoutMs?: number;
  }): Promise<TResponse> {
    const requestPath = `${API_VERSION_PREFIX}${params.path}${buildQueryString(params.query)}`;
    const body = params.body ? JSON.stringify(params.body) : "";
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = this.createSignature(timestamp, params.method, requestPath, body);
    const timeoutMs = Math.max(1, params.timeoutMs ?? this.requestTimeoutMs);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${requestPath}`, {
        method: params.method,
        headers: {
          Authorization: `prsign ${this.accessKey}:${signature}`,
          "X-PR-Timestamp": timestamp,
          "Content-Type": "application/json",
        },
        body: body || undefined,
        cache: "no-store",
        signal: controller.signal,
      });

      const requestId = response.headers.get("x-request-id");
      const text = await response.text();
      const data = text.length > 0 ? safeJsonParse(text) : null;

      if (!response.ok) {
      const errorPayload =
        data && typeof data === "object" ? (data as Record<string, unknown>) : undefined;

      const firstError =
        errorPayload && Array.isArray(errorPayload.errors) && errorPayload.errors.length > 0
          ? (errorPayload.errors[0] as Record<string, unknown>)
          : undefined;

      logTrolleyResponse("error response", {
        method: params.method,
        status: response.status,
      });

      const extractedCode =
        typeof errorPayload?.code === "string"
          ? errorPayload.code
          : typeof errorPayload?.errorCode === "string"
            ? errorPayload.errorCode
            : typeof firstError?.code === "string"
              ? firstError.code
              : undefined;

      const extractedMessage =
        typeof errorPayload?.message === "string"
          ? errorPayload.message
          : typeof errorPayload?.error === "string"
            ? errorPayload.error
            : typeof firstError?.message === "string"
              ? firstError.message
              : typeof errorPayload?.raw === "string"
                ? errorPayload.raw
                : `Trolley API request failed with status ${response.status}`;

        throw new TrolleyApiError({
          status: response.status,
          requestId,
          code: extractedCode,
          message: extractedMessage,
          details: data,
          retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
        });
      }

      logTrolleyResponse("response", {
        method: params.method,
        status: response.status,
      });

      return data as TResponse;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new TrolleyRequestTimeoutError(timeoutMs);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
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

  async listBatchPayments(
    batchId: string,
    params: { search?: string; page?: number; pageSize?: number; timeoutMs?: number } = {}
  ): Promise<TrolleyPaginatedResponse<Payment>> {
    const response = await this.signedRequest<unknown>({
      method: "GET",
      path: `/batches/${batchId}/payments`,
      query: {
        page: params.page,
        pageSize: params.pageSize,
        search: params.search,
      },
      timeoutMs: params.timeoutMs,
    });

    const payload = (response ?? {}) as Record<string, unknown>;
    const items =
      Array.isArray(payload.items)
        ? (payload.items as Payment[])
        : Array.isArray(payload.payments)
          ? (payload.payments as Payment[])
          : Array.isArray(payload.data)
            ? (payload.data as Payment[])
            : [];

    return {
      ...payload,
      items,
    };
  }

  async listPayments(
    params: { search?: string; page?: number; pageSize?: number } = {}
  ): Promise<TrolleyPaginatedResponse<Payment>> {
    const response = await this.signedRequest<unknown>({
      method: "GET",
      path: "/payments",
      query: {
        page: params.page,
        pageSize: params.pageSize,
        search: params.search,
      },
    });

    const payload = (response ?? {}) as Record<string, unknown>;
    const items = Array.isArray(payload.payments)
      ? (payload.payments as Payment[])
      : [];

    return {
      ...payload,
      items,
    };
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

export const listBatchPayments = (
  batchId: string,
  params?: { search?: string; page?: number; pageSize?: number; timeoutMs?: number }
) => getTrolleyClient().listBatchPayments(batchId, params);

export const listPayments = (params?: {
  search?: string;
  page?: number;
  pageSize?: number;
}) => getTrolleyClient().listPayments(params);

export const startBatchProcessing = (batchId: string) =>
  getTrolleyClient().startBatchProcessing(batchId);
