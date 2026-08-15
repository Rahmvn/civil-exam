const SUPPORT_EMAIL = "promotionsureapp@gmail.com";
const BRAND_HOME_URL = "https://promotionsure.com.ng";
const BRAND_LOGO_URL = `${BRAND_HOME_URL}/logo/promotionsure-lockup.png`;

export function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderEmailLayout({
  preheader,
  bodyHtml,
  footerHtml,
}: {
  preheader: string;
  bodyHtml: string;
  footerHtml?: string;
}) {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body style="margin:0;background:#f7f7f4;color:#10233d;font-family:Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f7f4;padding:24px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #dce3e0;">
          <tr><td style="padding:24px 28px 12px;">
            <a href="${BRAND_HOME_URL}" style="display:inline-block;text-decoration:none;" target="_blank">
              <img src="${BRAND_LOGO_URL}" width="220" alt="PromotionSure" style="display:block;width:220px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;">
            </a>
          </td></tr>
          <tr><td style="padding:8px 28px 24px;font-size:15px;line-height:1.6;">${bodyHtml}</td></tr>
          <tr><td style="border-top:1px solid #e6ebe8;padding:18px 28px;font-size:12px;line-height:1.5;color:#63716d;">
            Need help? Email <a href="mailto:${SUPPORT_EMAIL}" style="color:#0d6546;">${SUPPORT_EMAIL}</a>.
            ${footerHtml ? `<div style="margin-top:10px;">${footerHtml}</div>` : ""}
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export { BRAND_HOME_URL, BRAND_LOGO_URL, SUPPORT_EMAIL };
