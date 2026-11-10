"use client";

import { useEffect } from "react";

/** Registers the offline-shell service worker in production only. */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* non-critical */
    });
  }, []);
  return null;
}
