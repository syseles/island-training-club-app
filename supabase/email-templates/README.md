# Supabase Auth email templates

These email-safe Night Circuit templates are copied manually into the Supabase Dashboard. They are deployment configuration; Supabase does not load them from this directory automatically.

## Brand asset

Both templates use:

```text
https://raw.githubusercontent.com/syseles/island-training-club-app/07917dc47f5f1887c69b8fa487421fe4e905f91e/assets/itc/itc-email-logo.png
```

`assets/itc/itc-email-logo.png` is an optimized crop derived only from the approved new logo:

```text
assets/itc/ITC_NewLogo_VOLTGREEN_BlackBG_ForOnline_FINAL-v2.png
```

Do not substitute the historical `logo.webp` or `logo-header.png` assets. The URL is pinned to the immutable Git commit that introduced the crop, so it is public before the application branch is promoted. Open it in a private browser window and confirm it returns the image without authentication before activating the templates.

Move the asset to ITC's owned public host when one is available, then replace the image URL in both HTML files before copying them into Supabase.

## Confirm signup

Supabase Dashboard → Authentication → Email Templates → **Confirm signup**

Subject:

```text
Confirm your email to apply to Island Training Club
```

Paste the complete contents of `confirm-signup.html` into the message body.

## Magic Link

Supabase Dashboard → Authentication → Email Templates → **Magic Link**

Subject:

```text
Your Island Training Club sign-in link
```

Paste the complete contents of `magic-link.html` into the message body.

## Required configuration

- Email OTP expiry: `900` seconds.
- Sender name: `Island Training Club`.
- Interim sender email: `itc.admin.ops@gmail.com`.
- Custom SMTP: Gmail App Password stored only in Supabase.
- Exact local, preview, and production `/app/` URLs in the redirect allowlist.

The templates intentionally retain `{{ .ConfirmationURL }}`. Do not replace or rename it; Supabase inserts the one-time URL when sending.

## Acceptance check

Send one first-time signup and one returning-user magic link. Verify each in Gmail, Outlook, and a narrow mobile viewport:

- approved new logo displays at a useful size;
- volt-green button remains readable;
- the button and fallback URL both authenticate;
- the 15-minute statement matches the configured 900-second expiry;
- blocked images still leave useful alt text and a working CTA;
- no horizontal scrolling appears.
