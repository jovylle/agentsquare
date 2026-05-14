"use client";

import { Moon, Sun } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";

const STORAGE_KEY = "agentsquare-theme";

function getStoredTheme(): "light" | "dark" | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* ignore */
  }
  return null;
}

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyClass(theme: "light" | "dark") {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useLayoutEffect(() => {
    const stored = getStoredTheme();
    const resolved = stored ?? (systemPrefersDark() ? "dark" : "light");
    setTheme(resolved);
    applyClass(resolved);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (getStoredTheme() !== null) return;
      const next = mq.matches ? "dark" : "light";
      setTheme(next);
      applyClass(next);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const base = prev ?? (document.documentElement.classList.contains("dark") ? "dark" : "light");
      const next = base === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      applyClass(next);
      return next;
    });
  }, []);

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      className="btn btn-ghost shrink-0 px-2.5 py-2 sm:px-3"
      aria-label={theme === null ? "Theme" : isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === null ? "Theme" : isDark ? "Light mode" : "Dark mode"}
    >
      {theme === null ? (
        <span className="block h-4 w-4 rounded-sm bg-ink-500/25 dark:bg-ink-400/30" aria-hidden />
      ) : isDark ? (
        <Sun className="h-4 w-4" strokeWidth={2} aria-hidden />
      ) : (
        <Moon className="h-4 w-4" strokeWidth={2} aria-hidden />
      )}
    </button>
  );
}
