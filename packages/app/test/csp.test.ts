import { describe, expect, it } from 'vitest'
import { cspFor } from '../app/lib/csp'

const directive = (csp: string, name: string) =>
  csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `))

describe('cspFor', () => {
  const csp = cspFor(["'sha256-abc='", "'sha256-def='"])

  it('defaults to same-origin', () => {
    expect(directive(csp, 'default-src')).toBe("default-src 'self'")
  })

  it('lets the app reach Neon over HTTPS and WSS, and Uploadcare for uploads', () => {
    const connect = directive(csp, 'connect-src')
    expect(connect).toContain('https://*.neon.tech')
    expect(connect).toContain('wss://*.neon.tech')
    expect(connect).toContain('https://upload.uploadcare.com')
  })

  it('shows Uploadcare CDN, device blob and data images', () => {
    const img = directive(csp, 'img-src')
    expect(img).toContain('https://ucarecdn.com')
    expect(img).toContain('https://*.ucarecd.net')
    expect(img).toContain('blob:')
    expect(img).toContain('data:')
  })

  it('lets the app upload to and show photos from Cloudinary and Imgur', () => {
    const connect = directive(csp, 'connect-src')
    expect(connect).toContain('https://api.cloudinary.com')
    expect(connect).toContain('https://api.imgur.com')
    const img = directive(csp, 'img-src')
    expect(img).toContain('https://res.cloudinary.com')
    expect(img).toContain('https://i.imgur.com')
  })

  it('lets the app upload to and show photos from ImgBB', () => {
    expect(directive(csp, 'connect-src')).toContain('https://api.imgbb.com')
    expect(directive(csp, 'img-src')).toContain('https://i.ibb.co')
  })

  it('allows only the given inline script hashes', () => {
    expect(directive(csp, 'script-src')).toBe("script-src 'self' 'sha256-abc=' 'sha256-def='")
    expect(directive(cspFor([]), 'script-src')).toBe("script-src 'self'")
  })

  it('covers the service worker and manifest', () => {
    expect(directive(csp, 'worker-src')).toBe("worker-src 'self'")
    expect(directive(csp, 'manifest-src')).toBe("manifest-src 'self'")
  })

  it('never allows eval or inline scripts, and omits frame-ancestors (ignored in meta)', () => {
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).not.toContain('frame-ancestors')
    expect(directive(csp, 'script-src')).not.toContain('unsafe-inline')
  })
})
