import { useEffect, useState } from "react";

// The look the person chose: our own, one with the Salesmax palette, one with the TeleCRM palette and layout. Kept per browser.
export const SKINS = [
  { id: "salesdesk", name: "Salesdesk", note: "Our own look: iron grey, oil yellow and paper." },
  { id: "salesmax", name: "Salesmax style", note: "White top menu, purple page bar, tiles and a work pipeline, like the Salesmax web app." },
  { id: "telecrm", name: "TeleCRM style", note: "Deep purple and white, with the TeleCRM palette and dashboard layout." },
];
let chosen = null;

export function readSkin() {
  if (chosen) return chosen;
  try {
    const id = localStorage.getItem("salesdesk-skin");
    return SKINS.some((s) => s.id === id) ? id : "salesdesk";
  } catch {
    return "salesdesk";
  }
}

export function applySkin(id) {
  chosen = id;
  const root = document.documentElement;
  if (id === "salesdesk") root.removeAttribute("data-skin");
  else root.setAttribute("data-skin", id);
  try {
    id === "salesdesk" ? localStorage.removeItem("salesdesk-skin") : localStorage.setItem("salesdesk-skin", id);
  } catch {
    /* storage can be blocked; the choice then lasts for this visit only */
  }
  window.dispatchEvent(new Event("salesdesk-skin"));
}

// Re-renders the caller when the skin changes.
export function useSkin() {
  const [id, setId] = useState(readSkin);
  useEffect(() => {
    const on = () => setId(readSkin());
    window.addEventListener("salesdesk-skin", on);
    return () => window.removeEventListener("salesdesk-skin", on);
  }, []);
  return id;
}
