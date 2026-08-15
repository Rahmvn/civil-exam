import { useEffect, useEffectEvent, useRef } from "react";

const INTERACTIVE_SELECTOR = [
  "button",
  "a",
  "input",
  "select",
  "textarea",
  "summary",
  "[role='button']",
  "[contenteditable='true']",
  "[data-mobile-sheet-no-drag]",
].join(", ");

function createDragState() {
  return {
    axis: null,
    lastTime: 0,
    lastY: 0,
    offsetY: 0,
    pointerId: null,
    startX: 0,
    startY: 0,
    velocityY: 0,
  };
}

function hasScrolledAncestor(target, sheet) {
  let element = target instanceof Element ? target : null;

  while (element && element !== sheet) {
    if (element.scrollHeight > element.clientHeight + 1 && element.scrollTop > 0) return true;
    element = element.parentElement;
  }

  return sheet.scrollHeight > sheet.clientHeight + 1 && sheet.scrollTop > 0;
}

export function useMobileSheetDrag({
  disabled = false,
  mediaQuery = "(max-width: 680px)",
  onDismiss,
  open = true,
}) {
  const sheetRef = useRef(null);
  const dragRef = useRef(createDragState());
  const dismissTimerRef = useRef(null);
  const suppressClickRef = useRef(false);
  const handleNativeTouchStart = useEffectEvent(onTouchStart);
  const handleNativeTouchMove = useEffectEvent(onTouchMove);
  const handleNativeTouchEnd = useEffectEvent(onTouchEnd);
  const handleNativeTouchCancel = useEffectEvent(onTouchCancel);

  useEffect(() => () => {
    if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const sheet = sheetRef.current;
    if (!sheet) return undefined;

    sheet.addEventListener("touchstart", handleNativeTouchStart, { passive: true });
    sheet.addEventListener("touchmove", handleNativeTouchMove, { passive: false });
    sheet.addEventListener("touchend", handleNativeTouchEnd);
    sheet.addEventListener("touchcancel", handleNativeTouchCancel);

    return () => {
      sheet.removeEventListener("touchstart", handleNativeTouchStart);
      sheet.removeEventListener("touchmove", handleNativeTouchMove);
      sheet.removeEventListener("touchend", handleNativeTouchEnd);
      sheet.removeEventListener("touchcancel", handleNativeTouchCancel);
    };
  }, [open]);

  function isEnabled() {
    return !disabled && window.matchMedia(mediaQuery).matches;
  }

  function setOffset(offsetY) {
    sheetRef.current?.style.setProperty("--mobile-sheet-drag-y", `${Math.max(0, offsetY)}px`);
  }

  function reset() {
    sheetRef.current?.classList.remove("is-mobile-sheet-dragging", "is-mobile-sheet-dismissing");
    setOffset(0);
    dragRef.current = createDragState();
  }

  function dismiss() {
    const sheet = sheetRef.current;
    dragRef.current = createDragState();

    if (!sheet || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onDismiss();
      return;
    }

    sheet.classList.remove("is-mobile-sheet-dragging");
    sheet.classList.add("is-mobile-sheet-dismissing");
    setOffset(Math.max(window.innerHeight, sheet.getBoundingClientRect().height + 48));

    if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = window.setTimeout(() => {
      dismissTimerRef.current = null;
      onDismiss();
    }, 190);
  }

  function onPointerDown(event) {
    if (!isEnabled() || !event.isPrimary) return;
    if (event.pointerType === "touch") return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const target = event.target;
    const isGrabber = target?.closest?.("[data-mobile-sheet-grabber='true']");
    if (!isGrabber && target?.closest?.(INTERACTIVE_SELECTOR)) return;
    if (!isGrabber && hasScrolledAncestor(target, event.currentTarget)) return;

    const now = performance.now();
    dragRef.current = {
      axis: null,
      lastTime: now,
      lastY: event.clientY,
      offsetY: 0,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      velocityY: 0,
    };
  }

  function onPointerMove(event) {
    if (event.pointerType === "touch") return;
    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.axis && Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= 7) {
      drag.axis = Math.abs(deltaY) > Math.abs(deltaX) ? "vertical" : "horizontal";
      if (drag.axis === "horizontal" || deltaY < 0) {
        dragRef.current = createDragState();
        return;
      }
      event.currentTarget.setPointerCapture?.(event.pointerId);
      suppressClickRef.current = true;
      sheetRef.current?.classList.remove("is-mobile-sheet-dismissing");
      sheetRef.current?.classList.add("is-mobile-sheet-dragging");
    }

    if (drag.axis !== "vertical") return;

    const now = performance.now();
    const elapsed = Math.max(now - drag.lastTime, 1);
    const movementY = event.clientY - drag.lastY;
    const nextOffset = Math.max(0, deltaY);
    drag.velocityY = movementY / elapsed;
    drag.lastTime = now;
    drag.lastY = event.clientY;
    drag.offsetY = nextOffset;
    setOffset(nextOffset);
    event.preventDefault();
  }

  function onPointerUp(event) {
    if (event.pointerType === "touch") return;
    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (drag.axis !== "vertical") {
      dragRef.current = createDragState();
      return;
    }

    const sheetHeight = sheetRef.current?.getBoundingClientRect().height ?? 0;
    const distanceThreshold = Math.min(180, Math.max(96, sheetHeight * 0.22));
    const fastDownwardFlick = drag.offsetY >= 36 && drag.velocityY >= 0.7;
    if (drag.offsetY >= distanceThreshold || fastDownwardFlick) dismiss();
    else reset();
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }

  function onPointerCancel(event) {
    if (event.pointerType === "touch") return;
    if (dragRef.current.pointerId !== event.pointerId) return;
    reset();
    suppressClickRef.current = false;
  }

  function onClickCapture(event) {
    if (!suppressClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function onTouchStart(event) {
    if (!isEnabled() || event.touches.length !== 1) return;

    const target = event.target;
    const isGrabber = target?.closest?.("[data-mobile-sheet-grabber='true']");
    if (!isGrabber && target?.closest?.(INTERACTIVE_SELECTOR)) return;
    if (!isGrabber && hasScrolledAncestor(target, event.currentTarget)) return;

    const touch = event.touches[0];
    const now = performance.now();
    dragRef.current = {
      axis: null,
      lastTime: now,
      lastY: touch.clientY,
      offsetY: 0,
      pointerId: "touch",
      startX: touch.clientX,
      startY: touch.clientY,
      velocityY: 0,
    };
  }

  function onTouchMove(event) {
    const drag = dragRef.current;
    if (drag.pointerId !== "touch" || event.touches.length !== 1) return;

    const touch = event.touches[0];
    const deltaX = touch.clientX - drag.startX;
    const deltaY = touch.clientY - drag.startY;
    if (!drag.axis && Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= 7) {
      drag.axis = Math.abs(deltaY) > Math.abs(deltaX) ? "vertical" : "horizontal";
      if (drag.axis === "horizontal" || deltaY < 0) {
        dragRef.current = createDragState();
        return;
      }
      suppressClickRef.current = true;
      sheetRef.current?.classList.remove("is-mobile-sheet-dismissing");
      sheetRef.current?.classList.add("is-mobile-sheet-dragging");
    }

    if (drag.axis !== "vertical") return;

    const now = performance.now();
    const elapsed = Math.max(now - drag.lastTime, 1);
    drag.velocityY = (touch.clientY - drag.lastY) / elapsed;
    drag.lastTime = now;
    drag.lastY = touch.clientY;
    drag.offsetY = Math.max(0, deltaY);
    setOffset(drag.offsetY);
    event.preventDefault();
  }

  function onTouchEnd() {
    const drag = dragRef.current;
    if (drag.pointerId !== "touch") return;

    if (drag.axis !== "vertical") {
      dragRef.current = createDragState();
      return;
    }

    const sheetHeight = sheetRef.current?.getBoundingClientRect().height ?? 0;
    const distanceThreshold = Math.min(180, Math.max(96, sheetHeight * 0.22));
    const fastDownwardFlick = drag.offsetY >= 36 && drag.velocityY >= 0.7;
    if (drag.offsetY >= distanceThreshold || fastDownwardFlick) dismiss();
    else reset();
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }

  function onTouchCancel() {
    if (dragRef.current.pointerId !== "touch") return;
    reset();
    suppressClickRef.current = false;
  }

  function setSheetRef(node) {
    sheetRef.current = node;
  }

  return [setSheetRef, sheetRef, {
    onClickCapture,
    onPointerCancel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  }];
}
