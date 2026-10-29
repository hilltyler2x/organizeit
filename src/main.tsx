import { Capacitor } from "@capacitor/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { startReviews } from "./lib/appReview";
import { App } from "./ui/App";
import "./ui/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

startReviews();

if ("serviceWorker" in navigator && import.meta.env.PROD && !Capacitor.isNativePlatform()) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
