export function FieldError({ children, className = "", id }) {
  if (!children) return null;

  return (
    <small className={`field-error ${className}`.trim()} id={id} role="alert">
      {children}
    </small>
  );
}

export function FeedbackMessage({ children, className = "", tone = "error" }) {
  if (!children) return null;
  const role = tone === "error" ? "alert" : "status";

  return (
    <p className={`feedback-message is-${tone} ${className}`.trim()} role={role}>
      {children}
    </p>
  );
}
