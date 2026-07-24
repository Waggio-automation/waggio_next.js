import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePayrollApiAuth } from "@/lib/payroll-api-auth";
import { generateAndStorePaystubPdf } from "@/lib/paystub-pdf";
import { sendPaystubEmail } from "@/lib/email";

export const runtime = "nodejs";

const cad = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });

function formatPayDate(date: Date): string {
  return date.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// Generates the paystub PDF and emails it to the employee. The two steps are
// tracked independently on PayHistory (pdfUrl vs emailSentAt/deliveryStatus)
// so a later retry can tell which step failed.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requirePayrollApiAuth();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: "Invalid paystub id" }, { status: 400 });
    }
    const payHistoryId = BigInt(id);

    // Ownership + recipient details in one query.
    const payHistory = await prisma.payHistory.findUnique({
      where: { id: payHistoryId },
      select: {
        employee: {
          select: { companyId: true, email: true, firstName: true, lastName: true },
        },
      },
    });
    if (!payHistory) {
      return NextResponse.json({ error: "Paystub not found" }, { status: 404 });
    }
    if (payHistory.employee.companyId !== auth.company.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const recipient = payHistory.employee.email?.trim();
    if (!recipient) {
      return NextResponse.json(
        { error: "Employee has no email address on file" },
        { status: 422 }
      );
    }

    // Step 1: PDF generation (recorded via pdfUrl inside the helper).
    const pdf = await generateAndStorePaystubPdf({ payHistoryId, companyId: auth.company.id });
    if (!pdf.ok) {
      return NextResponse.json(
        { pdf: { ok: false, error: pdf.error }, email: { ok: false, error: "skipped" } },
        { status: pdf.status }
      );
    }

    // Step 2: email delivery (recorded separately so PDF success is not lost
    // if the email fails).
    const employeeName = `${payHistory.employee.firstName} ${payHistory.employee.lastName}`.trim();
    try {
      const emailResult = await sendPaystubEmail({
        to: recipient,
        employeeName,
        companyName: pdf.data.company.name,
        payDateLabel: formatPayDate(pdf.data.payDate),
        netPayLabel: cad.format(pdf.data.netPay),
        pdf: pdf.pdfBuffer,
        pdfFilename: `paystub-${id}.pdf`,
      });

      await prisma.payHistory.update({
        where: { id: payHistoryId },
        data: {
          emailSentAt: new Date(),
          deliveryStatus: "SENT",
          emailProvider: emailResult.previewUrl ? "ethereal-dev" : "smtp",
        },
      });

      return NextResponse.json({
        ok: true,
        pdf: { ok: true },
        email: { ok: true, previewUrl: emailResult.previewUrl },
      });
    } catch (emailError) {
      console.error("Failed to send paystub email", emailError);
      await prisma.payHistory.update({
        where: { id: payHistoryId },
        data: { deliveryStatus: "FAILED" },
      });
      // PDF succeeded, so report 502 for the email step without discarding it.
      return NextResponse.json(
        { pdf: { ok: true }, email: { ok: false, error: "Failed to send email" } },
        { status: 502 }
      );
    }
  } catch (error: unknown) {
    console.error("Failed to generate and send paystub", error);
    return NextResponse.json({ error: "Failed to generate and send paystub" }, { status: 500 });
  }
}
