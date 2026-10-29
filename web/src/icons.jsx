import React from "react";

// Small line icons (24px grid). Drawn here so there is no icon font to load and nothing needs inline styles.
const PATHS = {
  drop: "M12 3c3.5 4.2 6 7.2 6 10.2A6 6 0 0 1 6 13.2C6 10.2 8.5 7.2 12 3z",
  dashboard: "M4 13h6V4H4v9zm0 7h6v-5H4v5zm10 0h6v-9h-6v9zm0-16v5h6V4h-6z",
  leads: "M4 6h16M4 12h16M4 18h10",
  report: "M5 20V10m7 10V4m7 16v-7",
  phone: "M6.6 3.5l2.4-.6 1.8 4.4-1.7 1.5a11 11 0 0 0 5.6 5.6l1.5-1.7 4.4 1.8-.6 2.4a2.4 2.4 0 0 1-2.5 1.8A16.6 16.6 0 0 1 4.8 6a2.4 2.4 0 0 1 1.8-2.5z",
  chat: "M4 5h16v11H9l-5 4V5z",
  copy: "M8 8h11v12H8V8zm-3 8V4h11",
  close: "M6 6l12 12M18 6L6 18",
  sun: "M12 4V2m0 20v-2M4 12H2m20 0h-2M6 6L4.6 4.6m14.8 14.8L18 18M6 18l-1.4 1.4M19.4 4.6L18 6M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  moon: "M20 14.5A8 8 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z",
  external: "M14 4h6v6m0-6L10 14M18 14v6H4V6h6",
  check: "M5 12.5l4.5 4.5L19 7.5",
  swap: "M7 7h12l-3-3m3 13H7l3 3",
  note: "M5 4h10l4 4v12H5V4zm9 0v5h5",
  task: "M5 5h14v14H5V5zm3 7l3 3 5-6",
  pin: "M12 21s6-5.6 6-11a6 6 0 0 0-12 0c0 5.4 6 11 6 11zm0-8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  again: "M4 12a8 8 0 0 1 14-5.3L20 9m0-5v5h-5M20 12a8 8 0 0 1-14 5.3L4 15m0 5v-5h5",
  dot: "M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  spark: "M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6z",
  people: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm-6 9a6 6 0 0 1 12 0M17 11a3 3 0 1 0 0-6m2 15a5 5 0 0 0-3-4.6",
};

export default function Icon({ name, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name] || PATHS.dot} />
    </svg>
  );
}
