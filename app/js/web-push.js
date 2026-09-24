// Live-mode browser Web Push helpers (Push API + push-only service worker).
// No-ops when not live or when VAPID public key is unset.

import { isLive, supabase } from "./config.js";

const SW_URL = "/app/push-sw.js";

function vapidPublicKey() {
  if (typeof window === "undefined") return "";
  return String(window.VAPID_PUBLIC_KEY || "").trim();
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export function webPushSupported() {
  return typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

async function registration() {
  if (!webPushSupported()) throw new Error("Web push is not supported in this browser.");
  return navigator.serviceWorker.register(SW_URL, { scope: "/app/" });
}

export async function syncWebPushSubscription({ enabled } = {}) {
  if (!isLive() || !supabase) return { ok: true, skipped: "local" };
  if (!webPushSupported()) {
    if (enabled) throw new Error("Web push needs a supported browser (and HTTPS).");
    return { ok: true, skipped: "unsupported" };
  }
  if (!enabled) {
    try {
      const reg = await navigator.serviceWorker.getRegistration("/app/");
      const sub = await reg?.pushManager?.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe().catch(() => {});
        await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
      }
    } catch (_err) {
      /* best-effort unsubscribe */
    }
    return { ok: true, disabled: true };
  }

  const publicKey = vapidPublicKey();
  if (!publicKey) {
    throw new Error("Web push is not configured yet (missing VAPID public key).");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Browser notification permission was not granted.");
  }

  const reg = await registration();
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }
  const json = sub.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    throw new Error("Unable to read push subscription keys.");
  }
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const profileId = userData?.user?.id;
  if (!profileId) throw new Error("Not signed in");

  const { error } = await supabase.from("push_subscriptions").upsert({
    profile_id: profileId,
    endpoint,
    p256dh,
    auth,
    user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "endpoint" });
  if (error) throw error;
  return { ok: true, endpoint };
}
