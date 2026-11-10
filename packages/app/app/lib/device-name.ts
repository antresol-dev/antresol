function detectOs(ua: string): string | null {
  if (/Android/i.test(ua)) return 'Android'
  if (/iPhone|iPad/i.test(ua)) return 'iOS'
  if (/Windows/i.test(ua)) return 'Windows'
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macOS'
  if (/Linux/i.test(ua)) return 'Linux'
  return null
}

function detectBrowser(ua: string): string | null {
  if (/Edg\//.test(ua)) return 'Edge'
  if (/SamsungBrowser/i.test(ua)) return 'Samsung Internet'
  if (/Chrome\/|CriOS/.test(ua)) return 'Chrome'
  if (/Firefox\/|FxiOS/.test(ua)) return 'Firefox'
  if (/Safari\//.test(ua)) return 'Safari'
  return null
}

export function defaultDeviceName(userAgent: string): string {
  const os = detectOs(userAgent)
  const browser = detectBrowser(userAgent) ?? 'Browser'
  return os ? `${os} · ${browser}` : browser
}
