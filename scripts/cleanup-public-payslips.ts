// One-off cleanup: delete legacy PUBLIC paystub blobs (payslip_<id>.pdf).
// These were stored with predictable names and public access — anyone could
// enumerate them. New paystubs live under paystubs/<companyId>/ with
// access: "private".
//
// Run AFTER the private pipeline is deployed and verified (Day 3 integrated
// deploy), because deleting these breaks any previously emailed links:
//
//   npx dotenv -e .env.local -- npx tsx scripts/cleanup-public-payslips.ts        # dry run
//   npx dotenv -e .env.local -- npx tsx scripts/cleanup-public-payslips.ts --run  # actually delete

import { del, list } from "@vercel/blob";

async function main() {
  const apply = process.argv.includes("--run");
  let cursor: string | undefined;
  let found = 0;
  let deleted = 0;

  do {
    const page = await list({ cursor, limit: 100 });
    const legacy = page.blobs.filter((b) => /^payslip_\d+\.pdf$/.test(b.pathname));
    for (const blob of legacy) {
      found += 1;
      console.log(`${apply ? "DELETE" : "would delete"}: ${blob.pathname} (${blob.size}B)`);
      if (apply) {
        await del(blob.url);
        deleted += 1;
      }
    }
    cursor = page.cursor;
  } while (cursor);

  console.log(
    apply
      ? `Done. Deleted ${deleted}/${found} legacy public paystub blobs.`
      : `Dry run. Found ${found} legacy public paystub blobs. Re-run with --run to delete.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
