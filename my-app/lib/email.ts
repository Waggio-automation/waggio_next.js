import nodemailer from "nodemailer";

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

function getTransporter() {
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

async function sendEmail(params: {
  to: string;
  subject: string;
  text: string;
  html: string;
}) {
  const transporter = getTransporter();
  await transporter.sendMail({
    from: `"${getFromName()}" <${getFromEmail()}>`,
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
  });
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
