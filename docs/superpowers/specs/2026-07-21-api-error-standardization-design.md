# API Error Response Standardization + `requireCompanyAdminOrThrow`

Status: Approved for planning
Ticket: Critical #5, #11 ([Dev·지원] API 에러 응답 표준화 + requireCompanyAdminOrThrow 헬퍼)
Reviewer: 효안

## Motivation

Several API routes under `src/app/api/**` return `error.message` (or third-party
`.details`) directly to the client in their catch blocks. This can leak internal
implementation details (Prisma error text, Trolley provider payloads, stack-adjacent
info) to callers. Separately, API routes currently reuse
`requireCompanyAdminOrRedirect`, a helper built for page/server-action contexts —
calling `redirect()` from a `Route Handler` sends the caller an HTTP redirect to an
HTML login page instead of a clean `401` JSON response, which is wrong for API
clients.

## Scope

**In scope:**
- New shared error-handling module for API routes.
- New `requireCompanyAdminOrThrow` helper (throws instead of redirecting).
- Swap `requireCompanyAdminOrRedirect` → `requireCompanyAdminOrThrow` in the 9 API
  route files that call it (10 call sites) and restructure those handlers so the
  thrown error is always caught and converted to a proper response.
- Fix the remaining raw `error.message` / provider-detail leaks in 3 more API routes
  that don't use the admin helper at all (`payroll/update-status`,
  `payroll/run`, `stripe/webhook`).

**Out of scope (explicitly, confirmed with requester):**
- Pages, layouts, and server actions that call `requireCompanyAdminOrRedirect` or
  `requireAuthenticatedCompanyUserOrRedirect` (17 call sites) — these keep
  redirecting; not touched.
- `requirePayrollApiAuth` (`src/lib/payroll-api-auth.ts`) — already a safe,
  return-based (non-throwing) pattern with correct 401/403 handling. Only its
  callers' final catch blocks (for the *other* errors in that try block) get
  routed through the new generic handler; the auth check itself is untouched.
- **Role enforcement gap**: `requireCompanyAdminOrRedirect`/`getAuthenticatedCompanyUser`
  only verify "is there a valid company session" — they do not check that the
  session's role is actually admin/owner (unlike `requirePayrollApiAuth`, which
  does and returns 403). `requireCompanyAdminOrThrow` is a 1:1 throw-based port of
  existing behavior and intentionally does **not** add a role check. This is a
  pre-existing gap, flagged here for a follow-up ticket, not fixed in this change.

## Design

### 1. `src/lib/api-error.ts` (new)

```ts
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function toErrorResponse(error: unknown, context: string): NextResponse {
  const requestId = crypto.randomUUID();

  if (error instanceof ApiError) {
    // Deliberate, safe-to-display error. Not logged as a failure — this is
    // expected control flow (auth/validation/not-found), not a bug.
    return NextResponse.json({ error: error.message, requestId }, { status: error.status });
  }

  if (error instanceof ZodError) {
    const message = error.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`).join("; ");
    return NextResponse.json({ error: message, requestId }, { status: 400 });
  }

  // Unknown/unexpected error: Prisma errors, TrolleyApiError, network failures,
  // programming bugs. Never forward `.message`/`.stack`/`.details` to the client.
  logServerError(context, requestId, error);
  return NextResponse.json(
    { error: "Something went wrong. Please try again.", requestId },
    { status: 500 }
  );
}
```

- `logServerError(context, requestId, error)` logs **only** `{ name, message, stack }`
  extracted from the error — never the raw error object, never `error.details`
  (e.g. `TrolleyApiError.details` is the raw parsed Trolley response body and can
  echo back submitted bank/routing info), never request bodies. This is a hard
  rule, not a convention: the function signature only accepts the three safe
  fields, so there's no way for a call site to accidentally spread extra
  properties into the log.
- `requestId` (a fresh UUID per error) is included in both the server log line and
  the JSON response, so a user-reported error can be correlated to a log line.

### 2. `requireCompanyAdminOrThrow` — `src/lib/company-auth.ts`

Added next to the existing `requireCompanyAdminOrRedirect`:

```ts
export async function requireCompanyAdminOrThrow() {
  const session = await getAuthenticatedCompanyUser();
  if (!session) {
    throw new ApiError(401, "Unauthorized");
  }
  return session.company;
}
```

Same underlying check as `requireCompanyAdminOrRedirect` (session-only, no role
check) — only the failure mode changes (throw vs. redirect).

### 3. Route changes

Each of the 9 files below: replace `requireCompanyAdminOrRedirect` with
`requireCompanyAdminOrThrow`, ensure the entire handler body is wrapped in one
`try { ... } catch (error) { return toErrorResponse(error, "<route>"); }`, and
remove any now-redundant manual `error.message` forwarding / duplicate
`console.error` calls in favor of the shared helper.

| File | Notes |
|---|---|
| `src/app/api/payroll/send-due/route.ts` | Already has an enclosing try/catch — swap helper + catch body. |
| `src/app/api/documents/[id]/route.ts` | No try/catch today — needs one added around the whole handler. |
| `src/app/api/payroll/preflight-check/route.ts` | Already wrapped — swap helper + catch body. |
| `src/app/api/payroll/export/route.ts` | Already wrapped; drop the redundant manual `console.error` (line 41), let the helper log. |
| `src/app/api/payroll/runs/[id]/retry-funding/route.ts` | Auth call is outside the try — move it inside / wrap fully. |
| `src/app/api/employees/[id]/ytd/route.ts` | No try/catch today — needs one added. |
| `src/app/api/employees/route.ts` | GET has no try/catch — add one. POST's existing bare `catch { ... "Unable to create employee" ... }` must route through `toErrorResponse` first, otherwise it would mask a 401 `ApiError` as a 400. |
| `src/app/api/employees/[id]/payout-setup/route.ts` | Auth call outside try — wrap fully. Keep the existing `error.message === "Employee not found"` early check (deliberate, safe message) but drop the explicit `TrolleyApiError` branch (lines 68-77) that currently forwards `.message`/`.status`/`.details` — let it fall through to the generic handler instead (genericized per confirmed decision). |
| `src/app/api/employees/[id]/payout-status/route.ts` | Auth call outside try — wrap fully. |

Three more files get their **existing** catch blocks routed through
`toErrorResponse` (no helper swap needed — they don't use
`requireCompanyAdminOrRedirect`):

| File | Notes |
|---|---|
| `src/app/api/payroll/update-status/route.ts` | Replace the final catch's raw `error.message` forwarding. |
| `src/app/api/payroll/run/route.ts` | Same. |
| `src/app/api/stripe/webhook/route.ts` | Same, for both catch blocks (signature verification failure and event-handling failure). Stripe itself receives the response, not an end user, but the same no-leak rule applies for consistency and because the endpoint is unauthenticated/public-facing. |

## Acceptance criteria (mapped to reviewer checklist)

- [ ] Client response never contains raw `error.message` for unexpected errors — only a fixed generic string, or a deliberately-authored `ApiError`/Zod message.
- [ ] No stack trace, SQL, Prisma internals, or file paths in any response body.
- [ ] Status codes: 400 (validation/Zod), 401 (`ApiError` from `requireCompanyAdminOrThrow`), 404 (existing deliberate not-found checks), 500 (generic fallback) are all exercised correctly by the affected routes. 402 (plan required) is pre-existing and untouched. 403/409 do not naturally arise in this specific set of routes today (see the role-check gap noted above as a follow-up, not fixed here).
- [ ] Every server-side error log line includes a `requestId` (also returned to the client).
- [ ] Server logs never include SIN, bank/routing info, tokens, or secrets — enforced by only ever logging `{ name, message, stack }`, never `TrolleyApiError.details` or request bodies.
- [ ] Unexpected/unhandled errors always return a generic 500 body.
- [ ] Frontend error display is unaffected — confirmed current consumers (`hours-table.tsx`, `payroll-status-block.tsx`) just render `data?.error || fallback` with no pattern-matching on message content.

## Non-goals / follow-ups

- Role-based 403 enforcement for `requireCompanyAdminOrThrow` (see Scope).
- Auditing/redacting third-party error payloads beyond dropping `TrolleyApiError.details` from logs entirely (no partial redaction/allowlisting of fields attempted — it's dropped wholesale).
- No changes to `requirePayrollApiAuth` itself.
