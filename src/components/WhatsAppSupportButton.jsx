import { useLocation } from "react-router-dom";
import {
  buildWhatsAppSupportUrl,
  isWhatsAppSupportRoute,
  resolveWhatsAppSupportConfig,
} from "../lib/whatsappSupport";

const SUPPORT_CONFIG = resolveWhatsAppSupportConfig(import.meta.env);

export function WhatsAppSupportButton({ avoidBottomNav = false }) {
  const location = useLocation();

  if (!SUPPORT_CONFIG.enabled || !isWhatsAppSupportRoute(location.pathname)) return null;

  const searchParams = new URLSearchParams(location.search);
  const paymentReference = searchParams.get("reference") ?? searchParams.get("trxref") ?? "";
  const supportUrl = buildWhatsAppSupportUrl({
    number: SUPPORT_CONFIG.number,
    pathname: location.pathname,
    paymentReference,
  });

  if (!supportUrl) return null;

  return (
    <a
      aria-label="Chat with PromotionSure support on WhatsApp"
      className={`whatsapp-support-button${avoidBottomNav ? " avoid-bottom-nav" : ""}`}
      href={supportUrl}
      rel="noopener noreferrer"
      target="_blank"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M20.5 11.8a8.5 8.5 0 0 1-12.6 7.4L3.5 20.5l1.3-4.2A8.5 8.5 0 1 1 20.5 11.8Z" />
        <path d="M9 7.7c.2-.4.4-.4.7-.4h.5c.2 0 .4.1.5.5l.8 1.8c.1.3.1.5-.1.7l-.6.8c-.2.2-.1.4 0 .6.7 1.2 1.7 2.1 3 2.7.2.1.4.1.6-.1l.9-1.1c.2-.2.4-.3.7-.1l1.8.8c.3.1.5.3.5.5 0 .3-.2 1.5-.8 2-.5.5-1.3.8-2.1.7-1.1-.1-2.5-.5-4.4-1.6-2.6-1.6-4.3-4.2-4.4-4.4-.1-.2-1.1-1.5-1.1-2.9 0-1.4.7-2.1 1-2.4Z" />
      </svg>
      <span>Support</span>
    </a>
  );
}
