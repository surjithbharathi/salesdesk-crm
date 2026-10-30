// The look the person chose: our own, one with the Salesmax palette, one with the TeleCRM palette. Kept per browser.
export const SKINS = [
  { id: "salesdesk", name: "Salesdesk", note: "Our own look: iron grey, oil yellow and paper." },
  { id: "salesmax", name: "Salesmax style", note: "Indigo and white, with the palette Salesmax uses." },
  { id: "telecrm", name: "TeleCRM style", note: "Deep purple and white, with the palette TeleCRM uses." },
];

export function readSkin() {
  try {
    const id = localStorage.getItem("salesdesk-skin");
    return SKINS.some((s) => s.id === id) ? id : "salesdesk";
  } catch {
    return "salesdesk";
  }
}

export function applySkin(id) {
  const root = document.documentElement;
  if (id === "salesdesk") root.removeAttribute("data-skin");
  else root.setAttribute("data-skin", id);
  try {
    id === "salesdesk" ? localStorage.removeItem("salesdesk-skin") : localStorage.setItem("salesdesk-skin", id);
  } catch {
    /* storage can be blocked; the choice then lasts for this visit only */
  }
}
