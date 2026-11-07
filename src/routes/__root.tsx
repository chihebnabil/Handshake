/// <reference types="vite/client" />
import type { ReactNode } from 'react'
import { HeadContent, Link, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import appCss from '~/styles.css?url'
import { Logo } from '~/components/Logo'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Handshake: get paid for every piece the moment it is verified' },
      {
        name: 'description',
        content: 'Escrow for commission artists. Clients fund through PayPal, an AI judge verifies each piece with cited evidence, and every verified piece is paid right away.',
      },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500&display=swap' },
    ],
  }),
  component: () => (
    <RootDocument>
      <Outlet />
    </RootDocument>
  ),
})

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <header className="sticky top-0 z-30 print:hidden border-b border-ink-100/80 bg-white/80 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
            <Link to="/" className="flex items-center gap-2.5">
              <Logo className="h-8 w-8" />
              <span className="text-lg font-bold tracking-tight text-ink-900">Handshake</span>
            </Link>
            <nav className="flex items-center gap-2 text-sm font-medium">
              <Link to="/dashboard" className="rounded-lg px-3 py-2 text-ink-600 hover:bg-ink-50 hover:text-ink-900">
                Dashboard
              </Link>
              <Link to="/new" className="btn-primary !py-2">
                Start a Handshake
              </Link>
            </nav>
          </div>
        </header>
        <main>{children}</main>
        <footer className="print:hidden border-t border-ink-100 py-10 text-center text-sm text-ink-500">
          Payments held and released by PayPal, item by item. Deliveries reviewed by AI. Built for the PayPal AI Hackathon.
        </footer>
        <Scripts />
      </body>
    </html>
  )
}
