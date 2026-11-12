/**
 * Content Security Policy for the production build. GitHub Pages cannot send headers, so it ships as a
 * <meta http-equiv> tag (which ignores frame-ancestors, report-uri and sandbox; none are used here).
 *
 * Origins, from the code:
 * - Neon serverless driver: https://<host>/sql (neon-http) and wss://<host>/v2 (neon-ws), host from the connection string.
 * - Uploadcare: uploads POST to upload.uploadcare.com; photos come from ucarecdn.com and *.ucarecd.net (see photo-url.ts).
 * - Cloudinary: uploads POST to api.cloudinary.com, photos come from res.cloudinary.com. Imgur: api.imgur.com, i.imgur.com.
 * - Device photos are blob: object URLs.
 *
 * @param scriptHashes quoted CSP sources for the executable inline scripts, e.g. `'sha256-...'`
 */
export function cspFor(scriptHashes: readonly string[]): string {
  return [
    "default-src 'self'",
    ['script-src', "'self'", ...scriptHashes].join(' '),
    // Reka, Tailwind and vue-sonner set inline styles.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://ucarecdn.com https://*.ucarecd.net https://res.cloudinary.com https://i.imgur.com",
    "connect-src 'self' https://*.neon.tech wss://*.neon.tech https://upload.uploadcare.com https://api.cloudinary.com https://api.imgur.com",
    "font-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
}
