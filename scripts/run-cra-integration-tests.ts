import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const configured = process.env.CRA_INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!configured) throw new Error("CRA integration database URL is not configured");

const databaseUrl = new URL(configured);
if (!process.env.CRA_INTEGRATION_DATABASE_URL) {
  databaseUrl.pathname = "/waggio_cra_integration";
}
const isLocal = ["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname);
const databaseName = databaseUrl.pathname.slice(1);
if (!databaseName.endsWith("_integration")) {
  throw new Error("Integration database name must end with _integration");
}
if (!isLocal && process.env.CRA_INTEGRATION_ALLOW_REMOTE !== "1") {
  throw new Error("Remote integration database requires CRA_INTEGRATION_ALLOW_REMOTE=1");
}

const artifactDirectory = mkdtempSync(path.join(tmpdir(), "waggio-cra-integration-"));
try {
  const migrationEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl.toString(),
    DIRECT_URL: databaseUrl.toString(),
    ENCRYPTION_KEY: "11".repeat(32),
    CRA_GENERATED_DIR: artifactDirectory,
  };
  const resetToPreviousMigration = spawnSync(
    "npx",
    [
      "prisma",
      "db",
      "execute",
      "--schema",
      "src/prisma/schema.prisma",
      "--file",
      "src/tests/fixtures/reset-dedicated-integration-schema.sql",
    ],
    { cwd: process.cwd(), env: migrationEnvironment, stdio: "inherit" }
  );
  if (resetToPreviousMigration.status !== 0) {
    throw new Error("Failed to reset the dedicated integration database");
  }

  const deployCleanSchema = spawnSync(
    "npx",
    ["prisma", "migrate", "deploy", "--schema", "src/prisma/schema.prisma"],
    { cwd: process.cwd(), env: migrationEnvironment, stdio: "inherit" }
  );
  if (deployCleanSchema.status !== 0) {
    throw new Error("Failed to migrate the clean dedicated integration database");
  }

  const rollbackProviderVerificationMigration = spawnSync(
    "npx",
    [
      "prisma",
      "db",
      "execute",
      "--schema",
      "src/prisma/schema.prisma",
      "--file",
      "src/tests/fixtures/rollback-provider-verification-migration.sql",
    ],
    { cwd: process.cwd(), env: migrationEnvironment, stdio: "inherit" }
  );
  if (rollbackProviderVerificationMigration.status !== 0) {
    throw new Error("Failed to restore the provider verification migration boundary");
  }

  const providerVerificationMigrationTest = spawnSync(
    process.execPath,
    [
      "--test",
      "--experimental-strip-types",
      "src/tests/provider-verification-migration.integration.test.ts",
    ],
    { cwd: process.cwd(), env: migrationEnvironment, stdio: "inherit" }
  );
  if (providerVerificationMigrationTest.status !== 0) {
    throw new Error("Provider verification migration integration test failed");
  }

  const rollbackLatestMigration = spawnSync(
    "npx",
    [
      "prisma",
      "db",
      "execute",
      "--schema",
      "src/prisma/schema.prisma",
      "--file",
      "src/tests/fixtures/rollback-legacy-cra-quarantine-migration.sql",
    ],
    { cwd: process.cwd(), env: migrationEnvironment, stdio: "inherit" }
  );
  if (rollbackLatestMigration.status !== 0) {
    throw new Error("Failed to restore the previous migration boundary");
  }

  const legacyMigrationTest = spawnSync(
    process.execPath,
    ["--test", "--experimental-strip-types", "src/tests/cra-legacy-migration.integration.test.ts"],
    { cwd: process.cwd(), env: migrationEnvironment, stdio: "inherit" }
  );
  if (legacyMigrationTest.status !== 0) {
    throw new Error("Legacy CRA migration integration test failed");
  }

  const migrate = spawnSync(
    "npx",
    ["prisma", "migrate", "deploy", "--schema", "src/prisma/schema.prisma"],
    {
      cwd: process.cwd(),
      env: migrationEnvironment,
      stdio: "inherit",
    }
  );
  if (migrate.status !== 0) throw new Error("Failed to deploy integration migrations");

  const result = spawnSync(
    process.execPath,
    ["--test", "--experimental-strip-types", "src/tests/cra-security.integration.test.ts"],
    {
      cwd: process.cwd(),
      env: migrationEnvironment,
      stdio: "inherit",
    }
  );
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(artifactDirectory, { recursive: true, force: true });
}
