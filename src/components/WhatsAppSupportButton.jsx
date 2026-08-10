import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  buildWhatsAppSupportUrl,
  isWhatsAppSupportRoute,
  resolveWhatsAppSupportConfig,
} from "../lib/whatsappSupport";

const SUPPORT_CONFIG = resolveWhatsAppSupportConfig(import.meta.env);
const WHATSAPP_DOCK_SIDE_KEY = "promotionsure.whatsappSupportDockSide";
const DRAG_THRESHOLD_PX = 7;

function getSavedDockSide() {
  if (typeof window === "undefined") return "right";
  return window.localStorage.getItem(WHATSAPP_DOCK_SIDE_KEY) === "left" ? "left" : "right";
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function WhatsAppSupportButton({ avoidBottomNav = false }) {
  const location = useLocation();
  const [dockSide, setDockSide] = useState(getSavedDockSide);
  const [dragLeft, setDragLeft] = useState(null);
  const [dragWidth, setDragWidth] = useState(46);
  const [isDragging, setIsDragging] = useState(false);
  const buttonRef = useRef(null);
  const avoidedElementRef = useRef(null);
  const dragStateRef = useRef(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handleViewportChange = () => {
      setDragLeft(null);
      setIsDragging(false);
      dragStateRef.current = null;
    };

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("orientationchange", handleViewportChange);
    window.visualViewport?.addEventListener("resize", handleViewportChange);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("orientationchange", handleViewportChange);
      window.visualViewport?.removeEventListener("resize", handleViewportChange);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    let animationFrame = 0;
    const clearAvoidedElement = () => {
      avoidedElementRef.current?.removeAttribute("data-floating-support-clearance");
      avoidedElementRef.current = null;
    };
    const updateAvoidedElement = () => {
      animationFrame = 0;
      const button = buttonRef.current;
      if (!button || !window.matchMedia("(max-width: 720px)").matches) {
        clearAvoidedElement();
        return;
      }

      const buttonRect = button.getBoundingClientRect();
      const candidates = [...document.querySelectorAll('[data-floating-support-avoid="true"]')];
      const nextElement = candidates.find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.bottom > buttonRect.top + 4 && rect.top < buttonRect.bottom - 4;
      }) ?? null;

      if (avoidedElementRef.current !== nextElement) clearAvoidedElement();
      if (nextElement) {
        if (nextElement.getAttribute("data-floating-support-clearance") !== dockSide) {
          nextElement.setAttribute("data-floating-support-clearance", dockSide);
        }
        avoidedElementRef.current = nextElement;
      }
    };
    const scheduleUpdate = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(updateAvoidedElement);
    };

    scheduleUpdate();
    const observer = new MutationObserver(scheduleUpdate);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("scroll", scheduleUpdate, { passive: true, capture: true });
    window.addEventListener("resize", scheduleUpdate);
    window.visualViewport?.addEventListener("resize", scheduleUpdate);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      window.removeEventListener("scroll", scheduleUpdate, { capture: true });
      window.removeEventListener("resize", scheduleUpdate);
      window.visualViewport?.removeEventListener("resize", scheduleUpdate);
      clearAvoidedElement();
    };
  }, [dockSide, location.pathname]);

  function handlePointerDown(event) {
    if (!event.isPrimary) return;

    const rect = event.currentTarget.getBoundingClientRect();
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      currentLeft: rect.left,
      width: rect.width,
      moved: false,
    };
    setDragWidth(rect.width);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    const distance = Math.hypot(deltaX, deltaY);
    if (!dragState.moved && distance < DRAG_THRESHOLD_PX) return;

    dragState.moved = true;
    setIsDragging(true);
    suppressClickRef.current = true;
    const maxLeft = window.innerWidth - dragState.width - 14;
    const nextLeft = clamp(dragState.startLeft + deltaX, 14, maxLeft);
    dragState.currentLeft = nextLeft;
    setDragLeft(nextLeft);
    event.preventDefault();
  }

  function finishPointerInteraction(event) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    event.currentTarget.releasePointerCapture?.(event.pointerId);

    if (dragState.moved) {
      const centerX = dragState.currentLeft + dragState.width / 2;
      const nextDockSide = centerX < window.innerWidth / 2 ? "left" : "right";
      setDockSide(nextDockSide);
      window.localStorage.setItem(WHATSAPP_DOCK_SIDE_KEY, nextDockSide);
      setDragLeft(null);
      setIsDragging(false);
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }

    dragStateRef.current = null;
  }

  function handleClick(event) {
    if (!suppressClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
  }

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
      ref={buttonRef}
      aria-label="Chat on WhatsApp with PromotionSure support (opens in a new tab)"
      className={`whatsapp-support-button${avoidBottomNav ? " avoid-bottom-nav" : ""}`}
      data-dock-side={dockSide}
      data-dragging={isDragging ? "true" : "false"}
      draggable="false"
      href={supportUrl}
      onClick={handleClick}
      onPointerCancel={finishPointerInteraction}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerInteraction}
      rel="noopener noreferrer"
      style={dragLeft === null ? undefined : {
        "--whatsapp-drag-left": `${dragLeft}px`,
        "--whatsapp-drag-width": `${dragWidth}px`,
      }}
      target="_blank"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
      </svg>
      <span>Chat on WhatsApp</span>
    </a>
  );
}
