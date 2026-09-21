/**
 * Component-test double for `next/navigation`.
 *
 * Playwright CT renders outside the Next app router, where `useRouter()` and
 * friends throw ("invariant expected app router to be mounted"). Mounted
 * components only need inert navigation (nothing under test navigates), so
 * this returns no-op implementations with a fixed root pathname.
 */
export function useRouter() {
  return {
    push: () => {},
    replace: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
    prefetch: async () => {},
  };
}

export function usePathname(): string {
  return "/";
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams();
}

export function useParams(): Record<string, string> {
  return {};
}
