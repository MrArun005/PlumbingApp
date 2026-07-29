import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { SiteHeader } from '../components/SiteHeader';
import { SiteFooter } from '../components/SiteFooter';

export const metadata: Metadata = {
  title: {
    default: 'PipeFix — plumbers in Bengaluru, price agreed before work starts',
    template: '%s · PipeFix',
  },
  description:
    'Book a police-verified plumber in Bengaluru. Emergency help in 30 minutes or your money back. You approve every price, including quotes raised on site.',
  applicationName: 'PipeFix',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The only literal colours in the app. The browser chrome reads these before
  // any CSS loads, so they cannot be tokens — keep them in step with
  // --color-bg (light) and its dark override in globals.css.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eef3f2' },
    { media: '(prefers-color-scheme: dark)', color: '#0c1a1f' },
  ],
};

/**
 * Applies a saved theme choice before first paint so a dark-mode user does not
 * get a white flash. Kept tiny and dependency-free on purpose.
 */
const THEME_BOOTSTRAP = `try{var t=localStorage.getItem('pipefix.theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2 focus:font-semibold focus:text-ink focus:shadow-lift"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="mx-auto w-full max-w-5xl px-4 pb-4 pt-5">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
