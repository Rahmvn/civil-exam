import { renderEmailLayout } from "./layout.ts";
import {
  paymentAccessIssueTemplate,
  paymentReviewTemplate,
  paymentSuccessTemplate,
} from "./templates/payment.ts";
import { adminCampaignTemplate } from "./templates/admin-campaign.ts";
import { adminSupportRequestTemplate } from "./templates/admin-support-request.ts";

export function renderApplicationEmail(
  templateKey: string,
  payload: Record<string, unknown>,
  options: { unsubscribeUrl?: string } = {},
) {
  const message = templateKey === "admin_campaign"
    ? adminCampaignTemplate(payload, options)
    : templateKey === "admin_support_request"
    ? adminSupportRequestTemplate(payload)
    : templateKey === "payment_success"
    ? paymentSuccessTemplate(payload)
    : templateKey === "payment_access_issue"
      ? paymentAccessIssueTemplate(payload)
      : paymentReviewTemplate(payload, templateKey);

  if (!["admin_campaign", "admin_support_request", "payment_success", "payment_access_issue", "refund_pending", "refund_processed", "refund_failed", "payment_disputed", "payment_dispute_resolved"].includes(templateKey)) {
    throw new Error(`Unsupported application email template: ${templateKey}`);
  }

  return {
    ...message,
    html: renderEmailLayout({
      preheader: message.preheader,
      bodyHtml: message.bodyHtml,
      footerHtml: message.footerHtml,
    }),
  };
}
