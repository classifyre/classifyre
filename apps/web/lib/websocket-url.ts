/**
 * Where the browser opens Socket.IO connections: the web app's own origin,
 * which forwards `/socket.io` to the API (a rewrite in `next.config.mjs`, the
 * same way `/api` and `/iam` are forwarded). That keeps one address for every
 * device and hostname — localhost, a LAN IP or a hostname — with no
 * separate API port to expose. `NEXT_PUBLIC_WS_URL` points at a socket
 * server elsewhere; an absolute `NEXT_PUBLIC_API_URL` is honoured as before.
 */
export function getWebSocketUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) {
    return process.env.NEXT_PUBLIC_WS_URL;
  }
  if (typeof window !== "undefined") {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (apiUrl && !apiUrl.startsWith("/")) {
      return apiUrl;
    }
    return window.location.origin;
  }
  // Server-side render: nothing connects there.
  return "http://localhost:8000";
}
