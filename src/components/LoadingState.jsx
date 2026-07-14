import { useEffect, useState } from "react";
import { BRAND_NAME } from "../lib/brand";

export function LoadingState({ fullPage = false }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setVisible(true), 180);
    return () => window.clearTimeout(timeoutId);
  }, []);

  const Element = fullPage ? "main" : "section";

  return (
    <Element
      aria-busy="true"
      aria-live="polite"
      className={`app-loading-state ${fullPage ? "is-full-page" : "is-page"} ${visible ? "is-visible" : ""}`}
    >
      <div className="app-loading-content" role="status">
        {fullPage && <strong>{BRAND_NAME}</strong>}
        <span className="app-loading-rail" aria-hidden="true"><i /></span>
        <p>Loading...</p>
      </div>
    </Element>
  );
}
