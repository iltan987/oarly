import './globals.css';

import type { Metadata } from 'next';
import { Manrope, Space_Grotesk } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';

import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';

const heading = Space_Grotesk({ subsets: ['latin'], display: 'swap', variable: '--font-heading-face' });
const body = Manrope({ subsets: ['latin'], display: 'swap', variable: '--font-body' });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('common');
  return { title: t('appName'), description: t('appDescription') };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} suppressHydrationWarning className={`${heading.variable} ${body.variable}`}>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <NextIntlClientProvider>{children}</NextIntlClientProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
