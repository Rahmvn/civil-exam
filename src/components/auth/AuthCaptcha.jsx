import { useEffect, useRef } from "react";

const SCRIPT_ID = "promotionsure-turnstile-script";

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      existing.addEventListener("load", () => resolve(window.turnstile), { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.addEventListener("load", () => resolve(window.turnstile), { once: true });
    script.addEventListener("error", reject, { once: true });
    document.head.appendChild(script);
  });
}

export function AuthCaptcha({ enabled, onProblem, onTokenChange, resetKey, siteKey }) {
  const hostRef = useRef(null);
  const widgetRef = useRef(null);

  useEffect(() => {
    if (!enabled || !siteKey) {
      onTokenChange("");
      return undefined;
    }

    let active = true;
    void loadTurnstile().then((turnstile) => {
      if (!active || !hostRef.current || !turnstile) return;
      widgetRef.current = turnstile.render(hostRef.current, {
        sitekey: siteKey,
        callback: (token) => onTokenChange(token),
        "expired-callback": () => onTokenChange(""),
        "error-callback": () => {
          onTokenChange("");
          onProblem("We could not load the security check. Please try again.");
        },
      });
    }).catch(() => onProblem("We could not load the security check. Please try again."));

    return () => {
      active = false;
      if (widgetRef.current && window.turnstile) window.turnstile.remove(widgetRef.current);
      widgetRef.current = null;
    };
  }, [enabled, onProblem, onTokenChange, siteKey]);

  useEffect(() => {
    if (enabled && widgetRef.current && window.turnstile) {
      window.turnstile.reset(widgetRef.current);
      onTokenChange("");
    }
  }, [enabled, onTokenChange, resetKey]);

  if (!enabled) return null;

  return (
    <div className="auth-captcha">
      <div aria-label="Security verification" ref={hostRef} />
    </div>
  );
}
