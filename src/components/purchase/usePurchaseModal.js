import { useContext } from "react";
import { PurchaseModalContext } from "./PurchaseModalContext";

export function usePurchaseModal() {
  const value = useContext(PurchaseModalContext);
  if (!value) throw new Error("usePurchaseModal must be used within PurchaseModalProvider");
  return value;
}
