// Push-only service worker. No asset caching / offline shell.
// Scope: /app/

self.addEventListener("push", (event) => {
  let payload = { title: "Island Training Club", body: "", url: "/app/#/notifications" };
  try {
    if (event.data) {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    }
  } catch (_err) {
    try {
      const text = event.data?.text?.() || "";
      if (text) payload.body = text;
    } catch (_err2) {
      /* ignore */
    }
  }
  const title = String(payload.title || "Island Training Club");
  const options = {
    body: String(payload.body || ""),
    data: { url: String(payload.url || "/app/#/notifications") },
    icon: "/assets/itc/logo-favicon.png",
    badge: "/assets/itc/favicon-48.png",
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = String(event.notification?.data?.url || "/app/#/notifications");
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of all) {
      if ("focus" in client) {
        await client.focus();
        if ("navigate" in client) {
          try { await client.navigate(target); } catch (_err) { /* ignore */ }
        }
        return;
      }
    }
    if (clients.openWindow) await clients.openWindow(target);
  })());
});
