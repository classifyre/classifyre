"use client";

import * as React from "react";

/**
 * Fill the viewport below wherever the element starts (app header, banners):
 * the case board's and Explore's canvas pages, which scroll inside rather
 * than with the page.
 */
export function useFullBleedHeight(ref: React.RefObject<HTMLElement | null>) {
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      el.style.height = `calc(100dvh - ${Math.max(0, Math.round(top))}px)`;
    };
    apply();
    window.addEventListener("resize", apply);
    const observer = new ResizeObserver(apply);
    if (el.parentElement) observer.observe(el.parentElement);
    return () => {
      window.removeEventListener("resize", apply);
      observer.disconnect();
    };
  }, [ref]);
}
