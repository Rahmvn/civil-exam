import { BRAND_DESCRIPTOR } from "../lib/brand";

export function BrandLogo({ showDescriptor = false }) {
  return (
    <span className={`brand-logo ${showDescriptor ? "brand-logo-full" : "brand-logo-compact"}`}>
      <img
        aria-hidden="true"
        className="brand-logo-lockup-image"
        src="/logo/promotionsure-lockup.png"
      />
      {showDescriptor && <span className="brand-logo-accessible-copy">{BRAND_DESCRIPTOR}</span>}
    </span>
  );
}
