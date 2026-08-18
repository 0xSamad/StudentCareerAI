"use client";

import { useLayoutEffect } from "react";

const KEY = "student-career-ai:theme";
const LEGACY_KEY = "student-career-ai:theme";

function applyTheme() {
  try {
    const stored = localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY);
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const useDark = stored === "dark" || (!stored && prefersDark);

    document.documentElement.classList.toggle("dark", useDark);
    document.documentElement.classList.toggle("light", stored === "light");

    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", useDark ? "#0a0a0a" : "#f7f6f3");
  } catch {
    document.documentElement.classList.add("dark");
  }
}

/** Applies saved/system theme on mount — no <script> tag (React 19 safe). */
export function ThemeInit() {
  useLayoutEffect(() => {
    applyTheme();
  }, []);

  return null;
}
