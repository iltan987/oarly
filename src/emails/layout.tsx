import type { ReactNode } from 'react';
import { Body, Container, Head, Html, Preview } from 'react-email';

export type EmailLayoutProps = {
  preview: string;
  locale: string;
  children: ReactNode;
};

/**
 * Shared shell for transactional emails. Keeps styles inline and minimal —
 * email clients have wildly inconsistent CSS support, so we avoid anything
 * that relies on external stylesheets, custom fonts, or `prefers-color-scheme`.
 */
export function EmailLayout({ preview, locale, children }: EmailLayoutProps) {
  return (
    <Html lang={locale}>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>{children}</Container>
      </Body>
    </Html>
  );
}

const main = {
  backgroundColor: '#f4f4f5',
  fontFamily: 'Helvetica, Arial, sans-serif',
  padding: '24px 0',
};

const container = {
  backgroundColor: '#ffffff',
  borderRadius: '8px',
  margin: '0 auto',
  padding: '32px',
  maxWidth: '480px',
};
