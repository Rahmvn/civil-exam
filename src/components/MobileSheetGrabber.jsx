export function MobileSheetGrabber({ ariaLabel, disabled = false, onClose }) {
  return (
    <button
      aria-label={ariaLabel}
      className="mobile-sheet-grabber"
      data-mobile-sheet-grabber="true"
      disabled={disabled}
      onClick={onClose}
      type="button"
    />
  );
}
