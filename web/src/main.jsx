import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/catamaran/400";
import "@fontsource/catamaran/600";
import "@fontsource/catamaran/700";
import "@fontsource/big-shoulders-display/latin-800";
import App from "./App.jsx";
import { ToastProvider } from "./toast.jsx";
import "./styles.css";
import "./settings.css";
import "./game.css";
import "./skins.css";

createRoot(document.getElementById("root")).render(
  <ToastProvider>
    <App />
  </ToastProvider>,
);
