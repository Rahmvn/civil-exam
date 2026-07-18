import { normalizeOtp } from "../../lib/authFlow";

export function OtpInput({ disabled = false, id, label, onChange, value }) {
  const digits = Array.from({ length: 6 }, (_, index) => value[index] ?? "");

  return (
    <div className="auth-otp-field">
      <label className="auth-otp-label" htmlFor={id}>{label}</label>
      <div className="auth-otp-control">
        <input
          aria-describedby={`${id}-hint`}
          autoComplete="one-time-code"
          className="auth-otp-input"
          disabled={disabled}
          id={id}
          inputMode="numeric"
          maxLength={6}
          name="one-time-code"
          onChange={(event) => onChange(normalizeOtp(event.target.value))}
          pattern="[0-9]{6}"
          required
          type="text"
          value={value}
        />
        <div aria-hidden="true" className="auth-otp-cells">
          {digits.map((digit, index) => (
            <span className={`auth-otp-cell ${digit ? "is-filled" : ""}`} key={index}>{digit}</span>
          ))}
        </div>
      </div>
      <small id={`${id}-hint`}>Enter the six digits from the latest email.</small>
    </div>
  );
}
