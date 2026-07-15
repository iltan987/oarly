import type { Metadata } from 'next';
import { Space_Grotesk, Manrope } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import { ThemeProvider } from '@/components/theme-provider';
import './globals.css';

const heading = Space_Grotesk({ subsets: ['latin'], display: 'swap', variable: '--font-heading-face' });
const body = Manrope({ subsets: ['latin'], display: 'swap', variable: '--font-body' });

export const metadata: Metadata = {
  title: 'Oarly',
  description: 'Kürek kulüpleri için seans ve rezervasyon yönetimi.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} suppressHydrationWarning className={`${heading.variable} ${body.variable}`}>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <NextIntlClientProvider>{children}</NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
