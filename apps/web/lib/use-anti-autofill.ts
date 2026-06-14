"use client";

import * as React from "react";

const INPUT_SELECTOR = "input, textarea";

const SKIP_TYPES = new Set(["checkbox", "radio", "submit", "button", "hidden"]);

function applyInputProtection(input: HTMLInputElement | HTMLTextAreaElement) {
  if (SKIP_TYPES.has(input.type)) return;

  input.readOnly = true;

  const release = () => {
    input.readOnly = false;
    input.removeEventListener("focus", release);
    input.removeEventListener("pointerdown", release);
  };

  input.addEventListener("focus", release, { once: true });
  input.addEventListener("pointerdown", release, { once: true });
}

export function removeInputProtection(element: Element) {
  const inputs = element.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    INPUT_SELECTOR,
  );
  inputs.forEach((input) => {
    input.readOnly = false;
  });
}

export function useAntiAutofill(
  formRef: React.RefObject<HTMLFormElement | null>,
) {
  React.useEffect(() => {
    const form = formRef.current;
    if (!form) return;

    const scan = () => {
      const inputs =
        form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          INPUT_SELECTOR,
        );
      inputs.forEach(applyInputProtection);
    };

    scan();

    const observer = new MutationObserver(scan);
    observer.observe(form, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      removeInputProtection(form);
    };
  }, [formRef]);
}
