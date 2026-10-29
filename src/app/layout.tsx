import type { Metadata, Viewport } from 'next';
import { i18n } from '@/lib/i18n/server';
import { Connectivity } from '@/components/connectivity';
import { LocaleProvider } from '@/lib/i18n/provider';
import './globals.css';
import '../styles/system.css';
import { Pwa } from '@/components/pwa';
export const metadata: Metadata = {
  title: { default: 'RoomieHub', template: '%s · RoomieHub' },
  description: 'RoomieHub',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icons/icon-192.png' },
  appleWebApp: { capable: true, title: 'RoomieHub' },
};
export async function generateViewport(): Promise<Viewport> {
  const { theme } = await i18n();
  return {
    width: 'device-width',
    initialScale: 1,
    themeColor: theme === 'dark' ? '#111716' : '#f4f6f3',
    colorScheme: theme === 'dark' ? 'dark' : 'light',
  };
}
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, theme, t } = await i18n();
  return (
    <html lang={locale} data-theme={theme}>
      <body>
        <a className="skip" href="#main">
          {t.skip}
        </a>
        <Connectivity message={t.offline} />
        <LocaleProvider locale={locale}>
          <Pwa />
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
