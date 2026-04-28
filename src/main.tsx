import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
import { open } from "@tauri-apps/plugin-shell";

// Prevent links from navigating the Tauri WebView; open in system browser instead.
document.addEventListener("click", (e) => {
  const a = (e.target as Element).closest("a");
  if (!a) return;
  const href = a.getAttribute("href");
  if (!href || href.startsWith("#")) return;
  if (href.startsWith("http://") || href.startsWith("https://")) {
    e.preventDefault();
    open(href).catch(() => {});
  }
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
