"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";

import {
  autoRedirectTarget,
  detectBrowserLanguage,
  localeToLanguage,
  readLocaleCookie,
} from "@/lib/locale";

/**
 * Pre-paint redirect for the initial load. The site is `output: "export"`,
 * so there is no server or middleware that could read `Accept-Language` —
 * this inline script in `<head>` is what moves a German browser from `/` to
 * `/de/` before first paint. Standalone (no imports) by necessity.
 *
 * Precedence: explicit `NEXT_LOCALE` cookie first, browser language second,
 * English fallback. `/de/…` URLs are never touched.
 */
export function LocaleRedirectHeadScript() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `(function(){try{var p=location.pathname;if(/^\\/de(\\/|$)/.test(p))return;var m=document.cookie.match(/(?:^|;\\s*)NEXT_LOCALE=([^;]*)/);var c=m&&decodeURIComponent(m[1]);var lang=null;if(c==='de'||c==='en'){lang=c;}else{var ls=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language];for(var i=0;i<ls.length;i++){var t=(ls[i]||'').split('-')[0].toLowerCase();if(t==='de'){lang='de';break;}}}if(lang!=='de')return;var rest=p===''||p==null?'/':p;if(rest.charAt(rest.length-1)!=='/')rest+='/';location.replace('/de'+rest+location.search+location.hash);}catch(e){}})();`,
      }}
    />
  );
}

/**
 * Same rule for client-side navigation after hydration: an unprefixed URL
 * carries no explicit language choice, so it follows the stored cookie, then
 * the browser language. Mirrors `apps/web/components/locale-auto-redirect`.
 */
export function LocaleRedirect() {
  const router = useRouter();
  const pathname = usePathname();

  React.useEffect(() => {
    if (!pathname) return;
    const cookie = readLocaleCookie();
    const resolved =
      cookie != null ? localeToLanguage(cookie) : detectBrowserLanguage();
    const target = autoRedirectTarget(pathname, resolved);
    if (!target) return;
    const suffix =
      typeof window === "undefined"
        ? ""
        : window.location.search + window.location.hash;
    router.replace(`${target}${suffix}`);
  }, [pathname, router]);

  return null;
}
