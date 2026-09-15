import type { Metadata, Viewport } from 'next';
import { i18n } from '@/lib/i18n/server';
import { Connectivity } from '@/components/connectivity';
import { LocaleProvider } from '@/lib/i18n/provider';
import './globals.css';
export const metadata: Metadata = {
  title: { default: 'RoomieHub', template: '%s · RoomieHub' },
  description: 'RoomieHub',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg' },
  appleWebApp: { capable: true, title: 'RoomieHub' },
};
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ddefe4' },
    { media: '(prefers-color-scheme: dark)', color: '#161d1a' },
  ],
};
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, theme, t } = await i18n();
  return (
    <html lang={locale} data-theme={theme}>
      <body>
        <a className="skip" href="#main">
          {t.skip}
        </a>
        <Connectivity message={t.offline} />
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
