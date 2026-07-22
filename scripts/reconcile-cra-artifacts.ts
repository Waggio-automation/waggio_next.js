import { reconcileCraArtifactStorage } from "../src/lib/cra.ts";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const allowProduction = args.has("--allow-production");
const confirmation = process.argv.find((arg) => arg.startsWith("--confirm="))?.slice("--confirm=".length);

if (apply && confirmation !== "REMOVE_UNPUBLISHED_CRA_ARTIFACTS") {
  process.stderr.write("Apply mode requires --confirm=REMOVE_UNPUBLISHED_CRA_ARTIFACTS\n");
  process.exit(2);
}
if (apply && process.env.NODE_ENV === "production" && !allowProduction) {
  process.stderr.write("Production cleanup is blocked unless --allow-production is explicitly provided\n");
  process.exit(2);
}

try {
  const result = await reconcileCraArtifactStorage({ apply });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch {
  process.stderr.write("CRA artifact reconciliation failed\n");
  process.exitCode = 1;
}
