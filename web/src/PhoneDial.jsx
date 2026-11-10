import { useEffect, useRef } from "react";
import { useCrm } from "./crm.jsx";
import { crmGet, crmSend } from "./api.js";
import { useToast } from "./toast.jsx";

// On a computer a "Call" link (tel:) only asks Windows which app should open it. Here the call goes to the person's own
// phone instead: the Salesdesk app dials it from the SIM ("Call from web CRM" in the app's settings). On a phone's browser
// the tel: link already opens the dialer, so it is left alone.
const last10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);

export function PhoneDial() {
  const crm = useCrm(), notify = useToast(), leads = useRef([]), busy = useRef(false);
  leads.current = crm?.leads || [];
  useEffect(() => {
    const onClick = async (e) => {
      const link = e.target.closest?.('a[href^="tel:"]');
      if (!link || e.defaultPrevented || window.matchMedia("(pointer: coarse)").matches) return;
      e.preventDefault();
      if (busy.current) return;
      const digits = last10(link.getAttribute("href").slice(4));
      const lead = digits.length === 10 && leads.current.find((l) => last10(l.phoneKey || l.phone) === digits);
      if (!lead) return notify("This number is not a lead in the CRM, so it cannot be sent to your phone.");
      busy.current = true;
      try {
        const phones = (await crmGet("click-to-call/devices")).filter((d) => d.ready);
        if (!phones.length) return notify("Your phone is not ready. In the Salesdesk app, open Settings and turn on \"Call from web CRM\".");
        await crmSend("POST", "click-to-call/request", { leadId: lead.id, deviceId: phones[0].id, requestId: crypto.randomUUID(), confirmed: true });
        notify(`Calling ${lead.name || lead.phone} on ${phones[0].name || "your phone"}…`);
      } catch (err) {
        notify(err.message);
      } finally {
        busy.current = false;
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [notify]);
  return null;
}
