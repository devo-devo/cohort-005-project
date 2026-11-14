# Research: SSE delivery pattern for React Router v8

Resolves [devo-devo/cohort-005-project#3](https://github.com/devo-devo/cohort-005-project/issues/3).

**Question:** What is the right pattern for serving a Server-Sent Events endpoint from
Cadence (React Router v8 framework mode, single Node process, cookie sessions) and
consuming it client-side, so in-app notifications arrive while a user sits on a page?

**Recommended pattern in one sentence:** A resource route (`app/routes/api.notifications.events.ts`,
registered in `app/routes.ts`) whose `loader` returns a raw `new Response(stream, { headers })`
with `Content-Type: text/event-stream`, streaming from a module-scope in-process pub/sub
(`node:events` EventEmitter keyed by user ID) in an `app/lib/events.server.ts` module, and a
client-side `useEventSource` hook wrapping the browser's built-in `EventSource`.

> **Where this file lives:** there is no research-notes convention in this repo, so this file
> is placed at `docs/research/sse-react-router.md` (new directory). If a convention is
> established later, this file can be moved.

Every claim below is cited to a primary source: the repo's own code and installed dependency
source (read from `node_modules`), the React Router v8 official docs, MDN, or the WHATWG HTML
specification (which defines `EventSource`).

---

## 1. How Cadence's server is actually configured

Evidence from the repo:

| Fact | Source |
| --- | --- |
| Dev: `react-router dev` (Vite-based dev server). Prod: `react-router-serve ./build/server/index.js` | `package.json` `scripts.dev` / `scripts.start` |
| No custom server entry, no custom `express`/`hono` app in the repo; `react-router.config.ts` has `ssr: true` | `react-router.config.ts`, `vite.config.ts` |
| `@react-router/serve` 8.3.0 is an **Express 5** app: it calls `app.use(compression())` before the React Router handler, plus `morgan` and `express.static` | `node_modules/@react-router/serve/dist/cli.js:111-126` |
| `@react-router/dev`'s dev server has **no compression middleware** — it is a fetch-based HTTP server (`@remix-run/node-fetch-server` `createRequest`/`sendResponse`) | `node_modules/@react-router/dev/dist/vite.js:27`, no `compression`/`gzip`/`zlib` match anywhere in `@react-router/dev/dist` |
| The installed `compression` middleware's default filter marks `text/event-stream` as compressible (`compressible`'s fallback regexp is `/^text\//`) and would gzip the stream unless skipped | `node_modules/compressible/index.js:12-14,29-50`, `node_modules/compression/index.js:299-308` |

**Implication:** there is nothing to "wire up" — an SSE endpoint is just a **resource route**
(routes can "serve resources instead of rendering components"; a route with a `loader` and no
default export is a resource route, and resource routes return raw `Response` instances) —
[React Router docs, "Resource Routes"](https://reactrouter.com/how-to/resource-routes).
Return a `Response` directly, **not** `data()` ("If you're using resource routes intended for
external consumption, return `Response` instances").

---

## 2. The recommended pattern

### 2a. Server: in-process pub/sub module

Cadence is a single Node process (`npm start` runs one `react-router-serve`; dev runs one
`react-router dev`), so a module-scope `EventEmitter` is sufficient — no Redis, no WebSocket
server, no queue. Follow the repo's existing `.server.ts` convention
(`app/lib/mailer.server.ts`, `app/lib/refunds.server.ts`).

```ts
// app/lib/events.server.ts
import { EventEmitter } from "node:events";

export type Notification = { userId: number; kind: string; message: string };

const emitter = new EventEmitter();
emitter.setMaxListeners(100); // default 10 is too low when N tabs/devices connect

/** Called from wherever a notification is created (e.g. after a db.insert). */
export function publishNotification(n: Notification): void {
  emitter.emit("notification", n);
}

/** Returns an unsubscribe function. */
export function subscribeToUser(
  userId: number,
  handler: (n: Notification) => void
): () => void {
  const listener = (n: Notification) => {
    if (n.userId === userId) handler(n);
  };
  emitter.on("notification", listener);
  return () => emitter.off("notification", listener);
}
```

Fan-out is then trivially per-user because each connected loader filters by the session's
`userId`. The publishing side stays a one-liner next to the DB write (Cadence's DB layer is
synchronous `better-sqlite3`, so emit-after-write is synchronous too).

### 2b. Server: the resource route

```ts
// app/routes/api.notifications.events.ts
import type { Route } from "./+types/api.notifications.events";
import { getCurrentUserId } from "~/lib/session";
import { subscribeToUser, type Notification } from "~/lib/events.server";

export function loader({ request }: Route.LoaderArgs) {
  // No default export -> resource route (React Router docs, "Resource Routes").
  // 401 with a plain status; a non-200 response makes EventSource *stop*
  // reconnecting (see §4), which is what you want for unauthenticated hits.
  return getCurrentUserId(request).then((userId) => {
    if (!userId) return new Response(null, { status: 401 });

    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream({
      start(controller) {
        const send = (line: string) =>
          controller.enqueue(encoder.encode(line + "\n\n"));

        // Deliver after headers, before any event, so the client's `open` fires.
        send("retry: 3000"); // reconnect delay hint (WHATWG §9.2.6 "retry" field)
        send(": connected"); // comment line: ignored by parsers (WHATWG §9.2.6)

        unsubscribe = subscribeToUser(userId, (n: Notification) => {
          send(`event: notification\nid: ${Date.now()}\ndata: ${JSON.stringify(n)}`);
        });

        // Keep-alive comment line. WHATWG authoring note: "authors can include a
        // comment line ... every 15 seconds" to survive proxies that drop idle
        // connections (https://html.spec.whatwg.org/multipage/server-sent-events.html#authoring-notes)
        heartbeat = setInterval(() => send(": ping"), 15_000);

        // The Express adapter and the dev server both abort `request.signal`
        // when the client disconnects (see §5), so this fires reliably.
        request.signal.addEventListener("abort", cleanup);
        function cleanup() {
          unsubscribe?.();
          if (heartbeat) clearInterval(heartbeat);
          try { controller.close(); } catch { /* already closed */ }
        }
      },
      cancel() { // belt-and-braces if the stream is cancelled another way
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        // REQUIRED pair — see §5:
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // Belt-and-braces for any nginx-style proxy (MDN SSE example sets this):
        "X-Accel-Buffering": "no",
      },
    });
  });
}
```

Register it in `app/routes.ts` alongside the other `api/*` resource routes
(`route("api/notifications/events", "routes/api.notifications.events.ts")`).

### 2c. Client: `useEventSource` hook

```tsx
// app/lib/use-event-source.ts
import { useEffect, useState } from "react";

export function useNotifications(enabled = true) {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    if (!enabled) return;
    // Same-origin GET: the `cadence_session` cookie is attached automatically
    // (see §4) — no `withCredentials` needed, and no way to add headers at all.
    const source = new EventSource("/api/notifications/events");

    source.addEventListener("notification", (e) => {
      setNotifications((prev) => [...prev, JSON.parse((e as MessageEvent).data)]);
    });

    source.onerror = () => {
      // Automatic reconnection is built into EventSource (WHATWG §9.2.3
      // "reestablish the connection"); the server's `retry:` hint sets the delay.
      // Nothing to do here unless you want to surface connection state.
    };

    // Cleanup: close() aborts the underlying fetch and stops reconnection
    // (WHATWG §9.2.2). Without it, navigating between pages leaks a
    // server-side connection per mount.
    return () => source.close();
  }, [enabled]);

  return notifications;
}
```

Mount it once in a long-lived layout route (e.g. `app/routes/layout.app.tsx`) rather than in
individual pages — one connection per page session, shared across that layout's children.

---

## 3. Client-side `EventSource` behavior (verified against the spec)

All from the [WHATWG HTML Standard §9.2](https://html.spec.whatwg.org/multipage/server-sent-events.html#the-eventsource-interface) ("The `EventSource` interface", "Processing model", "The `Last-Event-ID` header") and [MDN: Using server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events):

- **Auto-reconnect is the default.** When the connection closes, the user agent "reestablish[es]
  the connection" — sets `readyState` to `CONNECTING`, fires `error`, waits the reconnection
  time, and re-fetches the same URL (§9.2.3). The reconnection time is implementation-defined
  "probably in the region of a few seconds" but can be set server-side with a `retry:` field
  (§9.2.6). You do not need (and cannot reliably implement, because `EventSource` gives you no
  access to the HTTP layer) manual reconnect logic.
- **`Last-Event-ID` on reconnect.** If you send `id:` fields, the browser stores the last event
  ID and sends a `Last-Event-ID` header on the automatic reconnect (§9.2.4). For Cadence's
  notifications this is optional: if a notification is also persisted in SQLite, a reconnecting
  client can catch up via a normal data fetch; if it is ephemeral, missing one event during a
  reconnect is acceptable. Either way, the server-side loader can read
  `request.headers.get("Last-Event-ID")` if the spec wants gapless delivery.
- **204 stops the loop.** Responding `204 No Content` tells the client to stop reconnecting;
  a non-200 status (or wrong `Content-Type`) "fail[s] the connection" and the agent "does *not*
  attempt to reconnect" (§9.2.3). So a 401 for logged-out users is the correct shape — it
  terminates cleanly instead of retrying forever.
- **Cleanup.** `close()` "aborts any instances of the fetch algorithm … and sets
  `readyState` to CLOSED" (§9.2.2). Call it in the effect cleanup. The spec also notes the
  browser holds a strong reference to an open `EventSource`, so a dropped (never-closed) source
  keeps the connection alive for the page's lifetime.
- **Stream format.** `data:`/`event:`/`id:`/`retry:` fields, blank line dispatches the event,
  `:`-prefixed lines are ignored comments usable as keep-alives (§9.2.5-9.2.6; MDN "Event
  stream format"). Multiple `data:` lines concatenate with `\n`, so JSON-encode payloads to one
  line (or send `JSON.stringify` of the whole object as a single `data:` line, as in the sketch).

---

## 4. Cookie-session auth lifecycle

Verified for Cadence's cookie (`app/lib/session.ts`): `createCookieSessionStorage` with
`name: "cadence_session"`, `httpOnly: true`, `sameSite: "lax"`, `path: "/"`.

- **`EventSource` sends same-origin cookies by default.** The constructor creates its request
  with credentials mode "same-origin" — `withCredentials: true` is only what sets credentials
  mode to "include", i.e. a *cross-origin* concern (WHATWG §9.2.2 constructor steps, and the
  `EventSourceInit` dictionary). Since the SSE route is served from the same origin that served
  the page, the `cadence_session` cookie (including its `httpOnly` value, which browsers attach
  to outgoing requests regardless of JS visibility) is sent on the initial request **and on
  every automatic reconnect**, because the reconnect is a fresh `fetch` of the same URL with the
  same credentials mode (§9.2.3).
- **`sameSite: "lax"` does not block it.** SameSite controls *cross-site* sending; a same-origin
  request (dev server and prod serve are the same origin as the page) always carries the cookie.
- **Re-auth is automatic.** When the session expires and the browser reconnects, the loader's
  `getCurrentUserId` runs again; returning 401 (non-200) cleanly ends reconnection instead of
  spinning (§9.2.3).
- **No custom headers are possible.** `EventSource` cannot set `Authorization` headers or use
  POST — cookie auth is exactly the model that works here (WHATWG exposes no request-init
  hook beyond `withCredentials`).

---

## 5. Platform gotchas (verified where possible against installed code)

1. **Production `react-router-serve` wraps everything in `compression()`** (`@react-router/serve/dist/cli.js:113`). Its default filter gzips `text/event-stream` (`compressible`'s
   fallback regexp `/^text\//` matches it — `node_modules/compressible/index.js:14,41-50`).
   Two mitigations, both in the route's headers (no framework changes needed):
   - `Cache-Control: no-cache, no-transform` — `compression`'s `shouldTransform` explicitly
     skips responses whose `Cache-Control` contains `no-transform`
     (`node_modules/compression/index.js:44,315-322`). This is the clean fix: the stream is
     never compressed at all.
   - Even if compressed, React Router's response writer calls `writable.flush()` after **every**
     chunk (`node_modules/@react-router/node/dist/index.js:107-122`), and `compression` defines
     `res.flush()` to flush its zlib stream (`node_modules/compression/index.js:93-97`) — so
     events still arrive per-write, just at wasted CPU/bandwidth.
   - Also see the Remix changelog note in `@react-router/node/CHANGELOG.md:918`: "Flush Node
     streams to address issues with libraries like `compression`".
2. **Express adapter has explicit SSE support.** `sendRemixResponse` calls `res.flushHeaders()`
   when the response `Content-Type` matches `/text\/event-stream/i`
   (`node_modules/@react-router/express/dist/index.js:63`) — headers go out immediately, so the
   client's `open` event fires before any event data.
3. **Client disconnect aborts `request.signal` in both dev and prod.** Express adapter:
   `res.on("close", () => controller?.abort())` (`@react-router/express/dist/index.js:47-48`).
   Dev server (fetch-based): `res.once('close', () => controller?.abort())`
   (`@remix-run/node-fetch-server/dist/lib/request-listener.js:175`). So `request.signal`
   `abort`-cleanup is portable between `npm run dev` and `npm start` — **but you must actually
   subscribe to it**, otherwise the per-connection listener and interval leak for the life of
   the process (single-process app = leaks accumulate).
4. **Idle-connection drops by proxies.** WHATWG authoring note: "Legacy proxy servers … drop
   HTTP connections after a short timeout. To protect against such proxy servers, authors can
   include a comment line (one starting with `:`) every 15 seconds or so" (§9.2.7). Send the
   heartbeat (sketch above). The repo's `request-logger/proxy.ts` is not in the app's request
   path (it proxies LLM API traffic, not app traffic — `request-logger/proxy.ts:1-17`), so it is
   irrelevant here, but any future deployment reverse proxy (nginx, Cloudflare) should get
   `X-Accel-Buffering: no` and disabled response buffering for `text/event-stream`.
5. **HTTP/1.1 6-connections-per-origin limit.** MDN: without HTTP/2, SSE "suffers from a
   limitation to the maximum number of open connections … per browser and … set to a very low
   number (6)" — shared across *all tabs* to the same origin. Cadence in dev (`react-router
   dev`) is plain HTTP/1.1, so a user with 7+ tabs open on `localhost` can starve. Mitigations:
   keep to **one** `EventSource` per page (mount in the app layout), and behind an HTTP/2
   reverse proxy in production the limit becomes ~100 streams.
6. **Vite dev-server specifics.** `react-router dev` has no compression middleware (verified,
   §1), so no buffering in dev; but module-scope server state (the `events.server.ts` emitter)
   is re-instantiated when Vite re-runs server modules on config/HMR reload — connected clients
   will see the stream die and reconnect (auto-reconnect covers it), just be aware that dev
   reloads reset the pub/sub. Never cache the `EventSource` outside of an effect you can clean
   up; on Fast Refresh an effect that doesn't clean up leaks connections.
7. **Do not use `data()`/loaders' normal return path.** Resource routes should return `Response`
   instances for external consumption (React Router docs, "Resource Routes" — keeps encoding
   explicit). Also do not link to the SSE URL with `<Link>`; it must be opened by `EventSource`
   (the docs note plain fetch/`<Link>` misuse triggers client-side routing behavior).
8. **No `Content-Length`.** The stream is unbounded; compression already removes
   `Content-Length` when compressing, but with `no-transform` you simply never set it.

---

## 6. Cleanup on server shutdown

Verified: `react-router-serve` registers `SIGTERM`/`SIGINT` handlers that call `server.close()`
(`@react-router/serve/dist/cli.js:128-130`). `server.close()` stops *new* connections but
Node's default behavior waits for **open** keep-alive/SSE connections before the process exits,
so long-lived SSE streams can hold up shutdown.

Recommended in `app/lib/events.server.ts` (single-process app, module scope is fine):

```ts
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
function shutdown() {
  emitter.removeAllListeners();          // drop all subscriber closures
  emitter.emit("shutdown");              // let any custom cleanup run
  // Ending in-flight streams: each loader's cleanup runs when its
  // request.signal aborts as sockets close, but to be explicit you can
  // track active controllers and `controller.close()` each on shutdown.
}
```

In practice for Cadence: `server.close()` + the dev server's `SIGTERM` handling already close
sockets on exit; the important part is that the **per-connection interval heartbeat does not
keep the process alive** — `setInterval` timers keep the event loop active, so the `abort`
cleanup's `clearInterval` matters for fast exit, and `emitter.removeAllListeners()` prevents
stale subscriber closures from resurrecting work during shutdown. If graceful drain of
in-flight streams is required by the spec, keep a registry of active `ReadableStreamController`s
in `events.server.ts` and close them all on `SIGTERM` before the process exits.

---

## 7. Dev/prod parity checklist

| Concern | Dev (`react-router dev`) | Prod (`react-router-serve`) |
| --- | --- | --- |
| Compression | None | `compression()` active — needs `no-transform` |
| Headers flushed early for SSE | Via fetch-server (`sendResponse`) | `res.flushHeaders()` (express adapter) |
| `request.signal` abort on disconnect | Yes (node-fetch-server) | Yes (express adapter) |
| Cookies | Same origin, sent automatically | Same |
| HTTP/2 | No — watch the 6-connection limit | Only behind a reverse proxy |

## 8. Sources

- Repo: `package.json`, `vite.config.ts`, `react-router.config.ts`, `app/routes.ts`,
  `app/lib/session.ts`, `app/lib/mailer.server.ts`, `request-logger/proxy.ts`.
- Installed dependency source (read from `node_modules`): `@react-router/serve@8.3.0`
  (`dist/cli.js`), `@react-router/express@8.3.0` (`dist/index.js`),
  `@react-router/node@8.3.0` (`dist/index.js`, `CHANGELOG.md`),
  `@react-router/dev@8.3.0` (`dist/vite.js`),
  `@remix-run/node-fetch-server` (`dist/lib/request-listener.js`),
  `compression` (`index.js`), `compressible` (`index.js`).
- React Router v8 official docs: [Resource Routes](https://reactrouter.com/how-to/resource-routes)
  (framework mode; verified against the live docs).
- WHATWG HTML Standard §9.2 [Server-sent events / The EventSource interface](https://html.spec.whatwg.org/multipage/server-sent-events.html#the-eventsource-interface)
  (constructor credentials mode, reconnection, `Last-Event-ID`, stream format, authoring notes).
- MDN: [EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource) and
  [Using server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)
  (6-connection HTTP/1.1 limit, keep-alive comments, `retry`/`id` fields, `close()`).
