import nodemailer, { type Transporter } from "nodemailer";

function asNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getFromName() {
  return process.env.SMTP_FROM_NAME?.trim() || "Waggio Payroll";
}

function getFromEmail() {
  const value = process.env.SMTP_FROM_EMAIL?.trim();
  if (!value) {
    throw new Error("SMTP_FROM_EMAIL is not configured.");
  }
  return value;
}

export function isEmailConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      process.env.SMTP_FROM_EMAIL
  );
}

function getConfiguredTransporter(): Transporter {
  const host = process.env.SMTP_HOST?.trim();
  const port = asNumber(process.env.SMTP_PORT, 587);
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();

  if (!host || !user || !pass) {
    throw new Error("SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS must be configured.");
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass,
    },
  });
}

// In development without SMTP configured, fall back to an Ethereal test
// account so paystub emails can be exercised end-to-end without ever
// delivering to a real employee. Mirrors the PDF pipeline's local fallback.
let etherealTransporterPromise: Promise<Transporter> | null = null;
function getEtherealTransporter(): Promise<Transporter> {
  if (!etherealTransporterPromise) {
    etherealTransporterPromise = nodemailer.createTestAccount().then((account) =>
      nodemailer.createTransport({
        host: account.smtp.host,
        port: account.smtp.port,
        secure: account.smtp.secure,
        auth: { user: account.user, pass: account.pass },
      })
    );
  }
  return etherealTransporterPromise;
}

export type SendEmailResult = {
  /** Ethereal preview URL when the dev fallback was used; null for real SMTP. */
  previewUrl: string | null;
};

type Attachment = { filename: string; content: Buffer; contentType: string };

async function sendEmail(params: {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: Attachment[];
}): Promise<SendEmailResult> {
  if (isEmailConfigured()) {
    const transporter = getConfiguredTransporter();
    await transporter.sendMail({
      from: `"${getFromName()}" <${getFromEmail()}>`,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
      attachments: params.attachments,
    });
    return { previewUrl: null };
  }

  if (process.env.NODE_ENV !== "development") {
    throw new Error("SMTP is not configured; refusing to send email in production.");
  }

  const transporter = await getEtherealTransporter();
  const info = await transporter.sendMail({
    from: `"${getFromName()}" <no-reply@waggio.test>`,
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
    attachments: params.attachments,
  });
  const previewUrl = nodemailer.getTestMessageUrl(info) || null;
  console.info("[email:dev] Ethereal preview URL:", previewUrl);
  return { previewUrl };
}

export async function sendPasswordResetEmail(params: {
  to: string;
  resetLink: string;
}) {
  await sendEmail({
    to: params.to,
    subject: "Reset your Waggio Payroll password",
    text: `Use this link to reset your password: ${params.resetLink}`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
        <h2 style="margin-bottom: 12px;">Reset your Waggio Payroll password</h2>
        <p>Use the link below to set a new password for your account.</p>
        <p style="margin: 20px 0;">
          <a
            href="${params.resetLink}"
            style="display: inline-block; background: #111827; color: #ffffff; text-decoration: none; padding: 10px 16px; border-radius: 999px;"
          >
            Reset password
          </a>
        </p>
        <p>If you did not request this, you can ignore this email.</p>
        <p style="font-size: 12px; color: #6b7280;">This link expires in 1 hour.</p>
      </div>
    `,
  });
}

export async function sendLoginEmailReminder(params: {
  to: string;
  companyName: string;
}) {
  await sendEmail({
    to: params.to,
    subject: "Your Waggio Payroll login email",
    text: `A login email reminder was requested for ${params.companyName}. This email address is the login email for that workspace.`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
        <h2 style="margin-bottom: 12px;">Your Waggio Payroll login email</h2>
        <p>A login email reminder was requested for <strong>${params.companyName}</strong>.</p>
        <p>This email address is the login email for that workspace.</p>
        <p>If you did not request this, you can ignore this email.</p>
      </div>
    `,
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Delivers a paystub to an employee. The PDF is attached directly (employees
// have no login yet — a self-service portal is a later roadmap item), so no
// authenticated download link is exposed to the recipient.
export async function sendPaystubEmail(params: {
  to: string;
  employeeName: string;
  companyName: string;
  payDateLabel: string;
  netPayLabel: string;
  pdf: Buffer;
  pdfFilename: string;
}): Promise<SendEmailResult> {
  const employeeName = escapeHtml(params.employeeName);
  const companyName = escapeHtml(params.companyName);
  const payDateLabel = escapeHtml(params.payDateLabel);
  const netPayLabel = escapeHtml(params.netPayLabel);

  return sendEmail({
    to: params.to,
    subject: `Your ${companyName} pay statement (${payDateLabel})`,
    text:
      `Hi ${params.employeeName},\n\n` +
      `Your pay statement from ${params.companyName} for ${params.payDateLabel} is attached ` +
      `(net pay ${params.netPayLabel}).\n\n` +
      `If anything looks incorrect, contact your employer.`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
        <h2 style="margin-bottom: 12px;">Your pay statement is ready</h2>
        <p>Hi ${employeeName},</p>
        <p>Your pay statement from <strong>${companyName}</strong> for
          <strong>${payDateLabel}</strong> is attached to this email.</p>
        <p style="margin: 16px 0; font-size: 15px;">Net pay: <strong>${netPayLabel}</strong></p>
        <p style="font-size: 12px; color: #6b7280;">If anything looks incorrect, contact your employer.</p>
      </div>
    `,
    attachments: [
      {
        filename: params.pdfFilename,
        content: params.pdf,
        contentType: "application/pdf",
      },
    ],
  });
}
