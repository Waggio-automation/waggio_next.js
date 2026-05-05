type Address = {
  line1: string;
  line2?: string | null;
  city: string;
  provinceCode: string;
  countryCode: string;
  postalCode: string;
};

type Contact = {
  name: string;
  phoneAreaCode: string;
  phoneNumber: string;
  extension?: string | null;
  email?: string | null;
};

export type T4SlipData = {
  employee: {
    firstName: string;
    lastName: string;
    initial?: string | null;
    sin: string;
    address: Address;
  };
  payrollAccountNumber: string;
  rppDpspRegistrationNumber?: string | null;
  reportTypeCode: "O" | "A" | "C";
  provinceOfEmployment: string;
  cppExemptCode: "0" | "1";
  eiExemptCode: "0" | "1";
  dentalBenefitsCode: "1" | "2" | "3" | "4" | "5";
  employmentIncome: string;
  cppContributions: string;
  cpp2Contributions: string;
  eiPremiums: string;
  incomeTaxDeducted: string;
  eiInsurableEarnings: string;
  pensionableEarnings: string;
  pensionAdjustment?: string | null;
};

export type T4SummaryData = {
  payrollAccountNumber: string;
  employerName: string;
  employerAddress: Address;
  contact: Contact;
  taxYear: number;
  slipCount: number;
  reportTypeCode: "O" | "A";
  totals: {
    employmentIncome: string;
    employeeCpp: string;
    employeeCpp2: string;
    employeeEi: string;
    rppContributions: string;
    incomeTaxDeducted: string;
    pensionAdjustment: string;
    employerCpp: string;
    employerCpp2: string;
    employerEi: string;
  };
};

export type T4SubmissionData = {
  transmitterAccountNumber?: string | null;
  transmitterRepId?: string | null;
  submissionReferenceId: string;
  summaryCount: number;
  languageCode: "E" | "F";
  transmitterName: string;
  transmitterCountryCode: string;
  transmitterContact: Contact;
  slips: T4SlipData[];
  summary: T4SummaryData;
};

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function xmlTag(name: string, value?: string | null) {
  if (!value) return "";
  return `<${name}>${escapeXml(value)}</${name}>`;
}

function xmlAmountTag(name: string, value: string) {
  return `<${name}>${value}</${name}>`;
}

function renderAddress(tagName: string, address: Address) {
  return `<${tagName}>
${xmlTag("addr_l1_txt", address.line1)}
${xmlTag("addr_l2_txt", address.line2 ?? undefined)}
${xmlTag("cty_nm", address.city)}
${xmlTag("prov_cd", address.provinceCode)}
${xmlTag("cntry_cd", address.countryCode)}
${xmlTag("pstl_cd", address.postalCode)}
</${tagName}>`;
}

function renderContact(contact: Contact) {
  return `<CNTC>
${xmlTag("cntc_nm", contact.name)}
${xmlTag("cntc_area_cd", contact.phoneAreaCode)}
${xmlTag("cntc_phn_nbr", contact.phoneNumber)}
${xmlTag("cntc_extn_nbr", contact.extension ?? undefined)}
</CNTC>`;
}

function renderTransmitterContact(contact: Contact) {
  return `<CNTC>
${xmlTag("cntc_nm", contact.name)}
${xmlTag("cntc_area_cd", contact.phoneAreaCode)}
${xmlTag("cntc_phn_nbr", contact.phoneNumber)}
${xmlTag("cntc_extn_nbr", contact.extension ?? undefined)}
${xmlTag("cntc_email_area", contact.email ?? undefined)}
</CNTC>`;
}

function renderTransmitterAccountNumber(value?: string | null) {
  if (!value) return "";

  if (/^\d{9}$/.test(value)) {
    return `<TransmitterAccountNumber>${xmlTag("bn9", value)}</TransmitterAccountNumber>`;
  }

  if (/^\d{9}[A-Z]{2}\d{4}$/.test(value)) {
    return `<TransmitterAccountNumber>${xmlTag("bn15", value)}</TransmitterAccountNumber>`;
  }

  if (/^[A-Z]\d{8}$/.test(value)) {
    return `<TransmitterAccountNumber>${xmlTag("trust", value)}</TransmitterAccountNumber>`;
  }

  if (/^[A-Z]{3}\d{6}$/.test(value)) {
    return `<TransmitterAccountNumber>${xmlTag("nr4", value)}</TransmitterAccountNumber>`;
  }

  return `<TransmitterAccountNumber>${xmlTag("bn15", value)}</TransmitterAccountNumber>`;
}

function renderSlip(slip: T4SlipData) {
  return `<T4Slip>
<EMPE_NM>
${xmlTag("snm", slip.employee.lastName)}
${xmlTag("gvn_nm", slip.employee.firstName)}
${xmlTag("init", slip.employee.initial ?? undefined)}
</EMPE_NM>
${renderAddress("EMPE_ADDR", slip.employee.address)}
${xmlTag("sin", slip.employee.sin)}
${xmlTag("bn", slip.payrollAccountNumber)}
${xmlTag("rpp_dpsp_rgst_nbr", slip.rppDpspRegistrationNumber ?? undefined)}
${xmlTag("cpp_qpp_xmpt_cd", slip.cppExemptCode)}
${xmlTag("ei_xmpt_cd", slip.eiExemptCode)}
${xmlTag("rpt_tcd", slip.reportTypeCode)}
${xmlTag("empt_prov_cd", slip.provinceOfEmployment)}
${xmlTag("empr_dntl_ben_rpt_cd", slip.dentalBenefitsCode)}
<T4_AMT>
${xmlAmountTag("empt_incamt", slip.employmentIncome)}
${xmlAmountTag("cpp_cntrb_amt", slip.cppContributions)}
${xmlAmountTag("cppe_cntrb_amt", slip.cpp2Contributions)}
${xmlAmountTag("empe_eip_amt", slip.eiPremiums)}
${xmlAmountTag("itx_ddct_amt", slip.incomeTaxDeducted)}
${xmlAmountTag("ei_insu_ern_amt", slip.eiInsurableEarnings)}
${xmlAmountTag("cpp_qpp_ern_amt", slip.pensionableEarnings)}
${slip.pensionAdjustment ? xmlAmountTag("padj_amt", slip.pensionAdjustment) : ""}
</T4_AMT>
</T4Slip>`;
}

export function buildT4SubmissionXml(data: T4SubmissionData) {
  const slipsXml = data.slips.map(renderSlip).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Submission xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<T619>
${renderTransmitterAccountNumber(data.transmitterAccountNumber)}
${data.transmitterRepId ? `<TransmitterRepID>${xmlTag("RepID", data.transmitterRepId)}</TransmitterRepID>` : ""}
${xmlTag("sbmt_ref_id", data.submissionReferenceId)}
${xmlTag("summ_cnt", String(data.summaryCount))}
${xmlTag("lang_cd", data.languageCode)}
<TransmitterName>
${xmlTag("l1_nm", data.transmitterName)}
</TransmitterName>
${xmlTag("TransmitterCountryCode", data.transmitterCountryCode)}
${renderTransmitterContact(data.transmitterContact)}
</T619>
<Return>
<T4>
${slipsXml}
<T4Summary>
${xmlTag("bn", data.summary.payrollAccountNumber)}
<EMPR_NM>
${xmlTag("l1_nm", data.summary.employerName)}
</EMPR_NM>
${renderAddress("EMPR_ADDR", data.summary.employerAddress)}
${renderContact(data.summary.contact)}
${xmlTag("tx_yr", String(data.summary.taxYear))}
${xmlTag("slp_cnt", String(data.summary.slipCount))}
${xmlTag("rpt_tcd", data.summary.reportTypeCode)}
<T4_TAMT>
${xmlAmountTag("tot_empt_incamt", data.summary.totals.employmentIncome)}
${xmlAmountTag("tot_empe_cpp_amt", data.summary.totals.employeeCpp)}
${xmlAmountTag("tot_empe_cppe_amt", data.summary.totals.employeeCpp2)}
${xmlAmountTag("tot_empe_eip_amt", data.summary.totals.employeeEi)}
${xmlAmountTag("tot_rpp_cntrb_amt", data.summary.totals.rppContributions)}
${xmlAmountTag("tot_itx_ddct_amt", data.summary.totals.incomeTaxDeducted)}
${xmlAmountTag("tot_padj_amt", data.summary.totals.pensionAdjustment)}
${xmlAmountTag("tot_empr_cpp_amt", data.summary.totals.employerCpp)}
${xmlAmountTag("tot_empr_cppe_amt", data.summary.totals.employerCpp2)}
${xmlAmountTag("tot_empr_eip_amt", data.summary.totals.employerEi)}
</T4_TAMT>
</T4Summary>
</T4>
</Return>
</Submission>
`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatMoneyForPdf(value: string) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(Number(value));
}

export function renderEmployeeT4SlipHtml(slip: T4SlipData, taxYear: number, employerName: string) {
  const employeeName = `${slip.employee.firstName} ${slip.employee.lastName}`.trim();
  const addressLine2 = slip.employee.address.line2 ? `<div>${escapeHtml(slip.employee.address.line2)}</div>` : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>T4 Slip ${taxYear}</title>
  <style>
    body { font-family: Helvetica, Arial, sans-serif; padding: 32px; color: #111827; }
    .header { display: flex; justify-content: space-between; margin-bottom: 24px; }
    .card { border: 1px solid #d1d5db; border-radius: 16px; padding: 20px; margin-bottom: 20px; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 20px; }
    .box { border: 1px solid #e5e7eb; border-radius: 12px; padding: 12px; }
    .label { font-size: 12px; color: #6b7280; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.04em; }
    .value { font-size: 16px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div style="font-size: 28px; font-weight: 700;">T4 Employee Copy</div>
      <div style="margin-top: 6px; color: #4b5563;">Statement of Remuneration Paid for ${taxYear}</div>
    </div>
    <div style="text-align: right;">
      <div style="font-size: 14px; color: #6b7280;">Employer</div>
      <div style="font-size: 18px; font-weight: 700;">${escapeHtml(employerName)}</div>
    </div>
  </div>

  <div class="card">
    <div style="font-size: 18px; font-weight: 700; margin-bottom: 8px;">${escapeHtml(employeeName)}</div>
    <div>${escapeHtml(slip.employee.address.line1)}</div>
    ${addressLine2}
    <div>${escapeHtml(slip.employee.address.city)}, ${escapeHtml(slip.employee.address.provinceCode)} ${escapeHtml(slip.employee.address.postalCode)}</div>
    <div>${escapeHtml(slip.employee.address.countryCode)}</div>
    <div style="margin-top: 10px; color: #4b5563;">SIN: ${escapeHtml(slip.employee.sin)}</div>
  </div>

  <div class="grid">
    <div class="box"><div class="label">Box 14 Employment Income</div><div class="value">${formatMoneyForPdf(slip.employmentIncome)}</div></div>
    <div class="box"><div class="label">Box 16 CPP Contributions</div><div class="value">${formatMoneyForPdf(slip.cppContributions)}</div></div>
    <div class="box"><div class="label">Box 16A CPP2 Contributions</div><div class="value">${formatMoneyForPdf(slip.cpp2Contributions)}</div></div>
    <div class="box"><div class="label">Box 18 EI Premiums</div><div class="value">${formatMoneyForPdf(slip.eiPremiums)}</div></div>
    <div class="box"><div class="label">Box 22 Income Tax Deducted</div><div class="value">${formatMoneyForPdf(slip.incomeTaxDeducted)}</div></div>
    <div class="box"><div class="label">Box 24 EI Insurable Earnings</div><div class="value">${formatMoneyForPdf(slip.eiInsurableEarnings)}</div></div>
    <div class="box"><div class="label">Box 26 Pensionable Earnings</div><div class="value">${formatMoneyForPdf(slip.pensionableEarnings)}</div></div>
    <div class="box"><div class="label">Box 45 Dental Benefits Code</div><div class="value">${escapeHtml(slip.dentalBenefitsCode)}</div></div>
    ${slip.rppDpspRegistrationNumber ? `<div class="box"><div class="label">Box 50 RPP/DPSP Registration Number</div><div class="value">${escapeHtml(slip.rppDpspRegistrationNumber)}</div></div>` : ""}
    ${slip.pensionAdjustment ? `<div class="box"><div class="label">Box 52 Pension Adjustment</div><div class="value">${formatMoneyForPdf(slip.pensionAdjustment)}</div></div>` : ""}
  </div>
</body>
</html>`;
}

export function renderEmployerT4SummaryHtml(
  summary: T4SummaryData,
  remittancesReported: string
) {
  const addressLine2 = summary.employerAddress.line2
    ? `<div>${escapeHtml(summary.employerAddress.line2)}</div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>T4 Summary ${summary.taxYear}</title>
  <style>
    body { font-family: Helvetica, Arial, sans-serif; padding: 32px; color: #111827; }
    .section { border: 1px solid #d1d5db; border-radius: 16px; padding: 20px; margin-bottom: 20px; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 20px; }
    .item { border: 1px solid #e5e7eb; border-radius: 12px; padding: 12px; }
    .label { font-size: 12px; color: #6b7280; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.04em; }
    .value { font-size: 16px; font-weight: 600; }
  </style>
</head>
<body>
  <div style="display: flex; justify-content: space-between; margin-bottom: 24px;">
    <div>
      <div style="font-size: 28px; font-weight: 700;">T4 Summary</div>
      <div style="margin-top: 6px; color: #4b5563;">Tax year ${summary.taxYear}</div>
    </div>
    <div style="text-align: right;">
      <div style="font-size: 14px; color: #6b7280;">Payroll account</div>
      <div style="font-size: 18px; font-weight: 700;">${escapeHtml(summary.payrollAccountNumber)}</div>
    </div>
  </div>

  <div class="section">
    <div style="font-size: 18px; font-weight: 700; margin-bottom: 8px;">${escapeHtml(summary.employerName)}</div>
    <div>${escapeHtml(summary.employerAddress.line1)}</div>
    ${addressLine2}
    <div>${escapeHtml(summary.employerAddress.city)}, ${escapeHtml(summary.employerAddress.provinceCode)} ${escapeHtml(summary.employerAddress.postalCode)}</div>
    <div>${escapeHtml(summary.employerAddress.countryCode)}</div>
    <div style="margin-top: 10px; color: #4b5563;">Contact: ${escapeHtml(summary.contact.name)}</div>
  </div>

  <div class="grid">
    <div class="item"><div class="label">Slip Count</div><div class="value">${summary.slipCount}</div></div>
    <div class="item"><div class="label">Total Employment Income</div><div class="value">${formatMoneyForPdf(summary.totals.employmentIncome)}</div></div>
    <div class="item"><div class="label">Employee CPP</div><div class="value">${formatMoneyForPdf(summary.totals.employeeCpp)}</div></div>
    <div class="item"><div class="label">Employee CPP2</div><div class="value">${formatMoneyForPdf(summary.totals.employeeCpp2)}</div></div>
    <div class="item"><div class="label">Employee EI</div><div class="value">${formatMoneyForPdf(summary.totals.employeeEi)}</div></div>
    <div class="item"><div class="label">Income Tax Deducted</div><div class="value">${formatMoneyForPdf(summary.totals.incomeTaxDeducted)}</div></div>
    <div class="item"><div class="label">Pension Adjustment</div><div class="value">${formatMoneyForPdf(summary.totals.pensionAdjustment)}</div></div>
    <div class="item"><div class="label">Employer CPP</div><div class="value">${formatMoneyForPdf(summary.totals.employerCpp)}</div></div>
    <div class="item"><div class="label">Employer EI</div><div class="value">${formatMoneyForPdf(summary.totals.employerEi)}</div></div>
    <div class="item"><div class="label">Remittances Reported</div><div class="value">${formatMoneyForPdf(remittancesReported)}</div></div>
  </div>
</body>
</html>`;
}
