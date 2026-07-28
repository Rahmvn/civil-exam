import { useEffect, useRef } from "react";

const SCRIPT_ID = "promotionsure-turnstile-script";
const SCRIPT_TIMEOUT_MS = 12_000;
let turnstilePromise;

function loadTurnstile() {
  if (window.turnstile?.render) return Promise.resolve(window.turnstile);
  if (turnstilePromise) return turnstilePromise;

  turnstilePromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID);
    const script = existing ?? document.createElement("script");
    const timeout = window.setTimeout(
      () => reject(new Error("Turnstile script timed out")),
      SCRIPT_TIMEOUT_MS,
    );
    const finish = () => {
      window.clearTimeout(timeout);
      if (window.turnstile?.render) resolve(window.turnstile);
      else reject(new Error("Turnstile API unavailable"));
    };
    const fail = () => {
      window.clearTimeout(timeout);
      reject(new Error("Turnstile script failed"));
    };

    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", fail, { once: true });
    if (!existing) {
      script.id = SCRIPT_ID;
      script.async = true;
      script.defer = true;
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      document.head.appendChild(script);
    }
  }).catch((error) => {
    turnstilePromise = undefined;
    throw error;
  });

  return turnstilePromise;
}

function getProblemMessage(errorCode) {
  const code = String(errorCode ?? "");
  if (/^(110100|110110|110200|400020|400070)/.test(code)) {
    return "The security check is not configured for this address. Please contact support.";
  }
  if (/^(200100|200500)/.test(code)) {
    return "The security check could not load. Check your connection or blocking extensions, then try again.";
  }
  return "The security check could not finish. It will retry automatically.";
}

export function AuthCaptcha({
  action,
  enabled,
  onProblem,
  onTokenChange,
  resetKey,
  siteKey,
}) {
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
        action,
        appearance: "interaction-only",
        sitekey: siteKey,
        size: "flexible",
        callback: (token) => {
          onProblem("");
          onTokenChange(token);
        },
        "expired-callback": () => onTokenChange(""),
        "error-callback": (errorCode) => {
          onTokenChange("");
          onProblem(getProblemMessage(errorCode));
        },
        "unsupported-callback": () => onProblem("This browser cannot run the security check. Please use a current browser."),
      });
    }).catch(() => onProblem(getProblemMessage("200500")));

    return () => {
      active = false;
      if (widgetRef.current != null && window.turnstile) {
        try {
          window.turnstile.remove(widgetRef.current);
        } catch {
          // The widget may already have removed itself after a navigation.
        }
      }
      widgetRef.current = null;
    };
  }, [action, enabled, onProblem, onTokenChange, siteKey]);

  useEffect(() => {
    if (enabled && widgetRef.current != null && window.turnstile) {
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
