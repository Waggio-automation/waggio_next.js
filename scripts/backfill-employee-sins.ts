import { PrismaClient } from "@prisma/client";
import { runSinBackfill, type SinBackfillRepository } from "../src/lib/sin-backfill.ts";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const allowProduction = args.has("--allow-production");
const confirmation = process.argv.find((arg) => arg.startsWith("--confirm="))?.slice("--confirm=".length);
const batchSizeArgument = process.argv.find((arg) => arg.startsWith("--batch-size="))?.slice("--batch-size=".length);
const batchSize = batchSizeArgument ? Number(batchSizeArgument) : 100;

if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
  process.stderr.write("Invalid --batch-size (expected an integer from 1 to 1000)\n");
  process.exit(2);
}

if (apply && confirmation !== "ENCRYPT_PLAINTEXT_SINS") {
  process.stderr.write("Apply mode requires --confirm=ENCRYPT_PLAINTEXT_SINS\n");
  process.exit(2);
}

if (apply && process.env.NODE_ENV === "production" && !allowProduction) {
  process.stderr.write("Production apply is blocked unless --allow-production is explicitly provided\n");
  process.exit(2);
}

const prisma = new PrismaClient();

const repository: SinBackfillRepository = {
  readBatch: ({ afterId, take }) => prisma.employee.findMany({
    where: afterId ? { id: { gt: afterId } } : undefined,
    orderBy: { id: "asc" },
    take,
    select: { id: true, sin: true },
  }),
  updateIfUnchanged: async ({ id, previous, encrypted }) => {
    const result = await prisma.$transaction((tx) => tx.employee.updateMany({
      where: { id, sin: previous },
      data: { sin: encrypted },
    }));
    return result.count === 1;
  },
};

try {
  process.stdout.write(`${JSON.stringify({ mode: apply ? "apply" : "dry-run", batchSize })}\n`);
  const counts = await runSinBackfill({
    repository,
    apply,
    batchSize,
    onReport: (row) => process.stdout.write(`${JSON.stringify(row)}\n`),
  });
  process.stdout.write(`${JSON.stringify({ summary: counts })}\n`);
} catch {
  process.stderr.write("SIN backfill failed; no sensitive record values were printed\n");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
