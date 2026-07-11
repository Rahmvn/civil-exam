import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

export function ScoreRing({ value = 0, label, sublabel, className = "" }) {
  const safeValue = Math.max(0, Math.min(100, Number(value) || 0));
  const ringRef = useRef(null);
  const [displayValue, setDisplayValue] = useState(0);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const node = ringRef.current;

    if (!node) {
      return undefined;
    }

    if (typeof window === "undefined" || typeof window.IntersectionObserver !== "function") {
      const fallbackTimeoutId = window.setTimeout(() => {
        setIsVisible(true);
      }, 250);

      return () => window.clearTimeout(fallbackTimeoutId);
    }

    const observer = new window.IntersectionObserver(
      (entries) => {
        const entry = entries[0];

        if (entry?.isIntersecting && entry.intersectionRatio >= 0.6) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      {
        threshold: [0.35, 0.6, 0.8],
      },
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible) {
      return undefined;
    }

    let frameId;
    let startTime;
    let startDelayTimeoutId;
    const duration = 2800;

    const animate = (time) => {
      if (startTime === undefined) startTime = time;

      const elapsed = Math.min((time - startTime) / duration, 1);
      setDisplayValue(safeValue * elapsed);

      if (elapsed < 1) {
        frameId = window.requestAnimationFrame(animate);
      }
    };

    startDelayTimeoutId = window.setTimeout(() => {
      frameId = window.requestAnimationFrame(animate);
    }, 700);

    return () => {
      window.clearTimeout(startDelayTimeoutId);
      window.cancelAnimationFrame(frameId);
    };
  }, [isVisible, safeValue]);

  const roundedDisplayValue = Math.round(displayValue);

  return (
    <div className={`score-ring-card ${className}`.trim()} ref={ringRef}>
      <div
        className="score-ring"
        style={{
          background: `conic-gradient(var(--color-primary) ${displayValue}%, var(--color-primary-soft) ${displayValue}% 100%)`,
        }}
      >
        <div className="score-ring-inner">
          <strong>{`${roundedDisplayValue}%`}</strong>
        </div>
      </div>
      {(label || sublabel) && (
        <div className="score-ring-copy">
          {label && <span>{label}</span>}
          {sublabel && <small>{sublabel}</small>}
        </div>
      )}
    </div>
  );
}

export function AnimatedProgressBar({ value = 0 }) {
  const safeValue = Math.max(0, Math.min(100, Number(value) || 0));
  const [progressScale, setProgressScale] = useState(0);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setProgressScale(safeValue / 100);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [safeValue]);

  return (
    <div className="module-progress-track" aria-hidden="true">
      <span style={{ transform: `scaleX(${progressScale})` }} />
    </div>
  );
}

export function DashboardActionButton({ action, className = "primary-action" }) {
  if (!action) return null;

  if (action.disabled) {
    return (
      <button className={className} disabled type="button">
        {action.label}
      </button>
    );
  }

  if (action.action) {
    return (
      <button className={className} onClick={action.action} type="button">
        {action.label}
      </button>
    );
  }

  return (
    <Link className={className} to={action.to}>
      {action.label}
    </Link>
  );
}

export function FreeBatchConfirmationModal({ subject, loading, onCancel, onConfirm }) {
  if (!subject) return null;

  return (
    <div className="auth-modal-backdrop" role="presentation" onClick={loading ? undefined : onCancel}>
      <section
        aria-labelledby="free-batch-modal-title"
        aria-modal="true"
        className="auth-modal-card dashboard-confirmation-modal"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="eyebrow">Free access</p>
        <h2 id="free-batch-modal-title">Start your free batch?</h2>
        <p>
          This will lock your free access to {subject.name}. You&apos;ll be able to practise Batch 1 for free, and you&apos;ll get one retry only if the first attempt fails.
        </p>
        <div className="auth-modal-actions">
          <button className="primary-action" disabled={loading} onClick={onConfirm} type="button">
            {loading ? "Starting..." : "Start free batch"}
          </button>
          <button className="ghost-button" disabled={loading} onClick={onCancel} type="button">
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}
