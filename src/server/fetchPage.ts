import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const MAX_BYTES = 2_000_000
const MAX_CHARS = 20_000
const MAX_REDIRECTS = 3

/** Blocks loopback, private, link-local and metadata addresses so a delivery link can't probe our network. */
function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase()
    if (v === '::1' || v === '::') return true
    if (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v)
    return mapped ? isPrivateAddress(mapped[1]) : false
  }
  const [a, b] = ip.split('.').map(Number)
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  )
}

async function assertPublic(url: URL) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http and https links are supported')
  const addresses = await lookup(url.hostname, { all: true })
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) throw new Error('Link points to a private address')
}

function htmlToText(html: string) {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim()
  const description = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1]
  const alts = [...html.matchAll(/<img[^>]+alt=["']([^"']+)["']/gi)].map((m) => m[1]).slice(0, 30)
  const body = html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article|header|footer)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
  return [
    title && `Title: ${title}`,
    description && `Meta description: ${description}`,
    alts.length ? `Image alt texts: ${alts.join(' | ')}` : null,
    body,
  ]
    .filter(Boolean)
    .join('\n')
}

export async function fetchPageText(link: string): Promise<{ status: string; text: string }> {
  try {
    let url = new URL(link)
    let res: Response | undefined
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      await assertPublic(url)
      res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
        headers: { 'User-Agent': 'HandshakeReviewer/1.0 (+delivery verification)', Accept: 'text/html,text/plain;q=0.9,*/*;q=0.5' },
      })
      const location = res.headers.get('location')
      if (res.status >= 300 && res.status < 400 && location) {
        url = new URL(location, url)
        continue
      }
      break
    }
    if (!res) throw new Error('No response')
    if (!res.ok) return { status: `http_${res.status}`, text: `The link returned HTTP ${res.status}.` }

    const type = res.headers.get('content-type') ?? ''
    if (!/text\/|html|json|xml/.test(type)) return { status: 'unsupported', text: `The link serves "${type}", which cannot be read as a page.` }

    const reader = res.body?.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    while (reader) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      chunks.push(value)
      if (size > MAX_BYTES) {
        await reader.cancel()
        break
      }
    }
    const raw = new TextDecoder().decode(Buffer.concat(chunks))
    const text = (type.includes('html') ? htmlToText(raw) : raw).slice(0, MAX_CHARS)
    return { status: 'ok', text: `Final URL: ${url.href}\n${text}` }
  } catch (err) {
    return { status: 'unreachable', text: `The link could not be opened: ${(err as Error).message}` }
  }
}
