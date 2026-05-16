UPDATE "Employee"
SET
  "institutionNumber" = CASE
    WHEN "institutionNumber" IS NULL OR "institutionNumber" ~ '^\d{3}$' THEN "institutionNumber"
    ELSE NULL
  END,
  "transitBranchNumber" = CASE
    WHEN "transitBranchNumber" IS NULL OR "transitBranchNumber" ~ '^\d{5}$' THEN "transitBranchNumber"
    ELSE NULL
  END,
  "accountNumber" = CASE
    WHEN "accountNumber" IS NULL OR "accountNumber" ~ '^\d{7,12}$' THEN "accountNumber"
    ELSE NULL
  END;

ALTER TABLE "Employee"
  ADD CONSTRAINT "Employee_institutionNumber_format_check"
  CHECK ("institutionNumber" IS NULL OR "institutionNumber" ~ '^\d{3}$');

ALTER TABLE "Employee"
  ADD CONSTRAINT "Employee_transitBranchNumber_format_check"
  CHECK ("transitBranchNumber" IS NULL OR "transitBranchNumber" ~ '^\d{5}$');

ALTER TABLE "Employee"
  ADD CONSTRAINT "Employee_accountNumber_format_check"
  CHECK ("accountNumber" IS NULL OR "accountNumber" ~ '^\d{7,12}$');
