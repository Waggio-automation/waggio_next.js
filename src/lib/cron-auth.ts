export function isCronRequestAuthorized(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  return Boolean(
    cronSecret && request.headers.get("authorization") === `Bearer ${cronSecret}`
  );
}
