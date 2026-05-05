import {
  CreateBatchInput,
  CreatePaymentInput,
  CreateRecipientAccountInput,
  CreateRecipientInput,
  getTrolleyClient,
} from "@/lib/trolley";

export async function createIndividualBankTransferPayoutExample() {
  const trolley = getTrolleyClient();

  const recipientInput: CreateRecipientInput = {
    type: "individual",
    firstName: "Avery",
    lastName: "Martin",
    email: "avery.martin@example.com",
    address: {
      street1: "123 King St W",
      city: "Toronto",
      region: "ON",
      postalCode: "M5H 1J9",
      country: "CA",
      phone: "+14165550123",
    },
    referenceId: "employee-123",
    tags: ["payroll", "employee"],
  };

  const recipient = await trolley.createRecipient(recipientInput);

  const accountInput: CreateRecipientAccountInput = {
    type: "bank-transfer",
    primary: true,
    country: "CA",
    currency: "CAD",
    accountHolderName: "Avery Martin",
    accountNum: "1234567",
    bankId: "001",
    branchId: "12345",
  };

  const account = await trolley.createRecipientAccount(recipient.id, accountInput);

  const batchInput: CreateBatchInput = {
    name: "Payroll 2026-03-31",
    sourceCurrency: "CAD",
    description: "Bi-weekly payroll",
    externalId: "payroll-run-2026-03-31",
    metadata: {
      payrollRunId: "981",
    },
  };

  const batch = await trolley.createBatch(batchInput);

  const paymentInput: CreatePaymentInput = {
    recipientId: recipient.id,
    recipientAccountId: account.id,
    amount: "1850.75",
    currency: "CAD",
    description: "Net payroll for Avery Martin",
    externalId: "payhistory-456",
    metadata: {
      employeeId: "123",
      payrollRunId: "981",
    },
  };

  const payment = await trolley.createPayment(batch.id, paymentInput);
  const processing = await trolley.startBatchProcessing(batch.id);

  return { recipient, account, batch, payment, processing };
}

export async function addPaypalRecipientAccountExample(recipientId: string) {
  const trolley = getTrolleyClient();

  const paypalAccountInput: CreateRecipientAccountInput = {
    type: "paypal",
    primary: true,
    currency: "USD",
    emailAddress: "payee@example.com",
  };

  return trolley.createRecipientAccount(recipientId, paypalAccountInput);
}
