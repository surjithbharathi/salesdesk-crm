import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/catamaran/400";
import "@fontsource/catamaran/600";
import "@fontsource/catamaran/700";
import "@fontsource/big-shoulders-display/latin-800";
import "@fontsource-variable/roboto-flex/wght.css";
import "@fontsource/roboto/latin-400.css";
import "@fontsource/roboto/latin-500.css";
import "@fontsource/roboto/latin-700.css";
import "@fontsource-variable/plus-jakarta-sans";
import App from "./App.jsx";
import { ToastProvider } from "./toast.jsx";
import "./styles.css";
import "./settings.css";
import "./game.css";
import "./skins.css";
import "./cw/shell.css";
import "./cw/dashboard.css";
import "./cw/leads-grid.css";
import "./cw/views.css";
import "./cw/more.css";
import "./cw/detail.css";
import "./cw/extra.css";
import "./cwt/tokens.css";
import "./cwt/crm.css";
import "./cwt/shell.css";
import "./cwt/dashboard.css";
import "./cwt/views.css";
import "./cwt/lead-detail.css";
import "./cwt/pages.css";
import "./cwt/extra.css";
import "./cwt/polish.css";
import "./cwt/r-shell.css";
import "./cwt/r-leads.css";
import "./cwt/r-dash.css";
import "./cwt/r-pages.css";
import "./cwt/r-msg.css";
import "./cwt/dark.css";

createRoot(document.getElementById("root")).render(
  <ToastProvider>
    <App />
  </ToastProvider>,
);
