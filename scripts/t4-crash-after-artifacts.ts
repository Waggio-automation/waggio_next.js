import { generateT4Package } from "../src/lib/cra.ts";

const companyId = process.env.T4_CRASH_COMPANY_ID;
const taxYear = Number(process.env.T4_CRASH_TAX_YEAR);
if (!companyId || !Number.isInteger(taxYear)) {
  throw new Error("T4 crash fixture requires company and tax year");
}

await generateT4Package(BigInt(companyId), taxYear, {
  afterArtifactsWritten: async () => {
    process.exit(17);
  },
});
