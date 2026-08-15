import { escapeHtml } from "../layout.ts";

function value(input: unknown, fallback = "Not provided") {
  const normalized = String(input ?? "").trim();
  return normalized || fallback;
}

function categoryLabel(input: unknown) {
  const category = value(input, "support");
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export function adminSupportRequestTemplate(details: Record<string, unknown>) {
  const subject = value(details.subject, "New support request");
  const category = categoryLabel(details.category);
  const requester = value(details.requester_name, "PromotionSure candidate");
  const requesterEmail = value(details.requester_email);
  const description = value(details.description);
  const moduleName = value(details.subject_name, "");
  const paymentReference = value(details.payment_reference, "");
  const adminPath = value(details.admin_path, "/admin/help");
  const optionalRows = [
    moduleName ? `Module: ${moduleName}` : "",
    paymentReference ? `Payment reference: ${paymentReference}` : "",
  ].filter(Boolean);

  return {
    subject: `[Support] ${category}: ${subject}`,
    preheader: `${requester} sent a new support request that needs attention.`,
    text: [
      "A new PromotionSure support request needs attention.", "",
      `Requester: ${requester}`,
      `Email: ${requesterEmail}`,
      `Category: ${category}`,
      `Subject: ${subject}`,
      ...optionalRows,
      "",
      "Message:",
      description,
      "",
      `Open the admin support queue: ${adminPath}`,
    ].join("\n"),
    bodyHtml: `<p>A new support request needs attention.</p>
      <p><strong>Requester:</strong> ${escapeHtml(requester)}<br>
      <strong>Email:</strong> ${escapeHtml(requesterEmail)}<br>
      <strong>Category:</strong> ${escapeHtml(category)}<br>
      <strong>Subject:</strong> ${escapeHtml(subject)}
      ${moduleName ? `<br><strong>Module:</strong> ${escapeHtml(moduleName)}` : ""}
      ${paymentReference ? `<br><strong>Payment reference:</strong> ${escapeHtml(paymentReference)}` : ""}</p>
      <p><strong>Message:</strong><br>${escapeHtml(description).replaceAll("\n", "<br>")}</p>
      <p>Sign in and open <strong>${escapeHtml(adminPath)}</strong> to review and take action.</p>`,
  };
}
