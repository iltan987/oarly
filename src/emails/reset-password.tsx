import { Button, Heading, Link, Text } from 'react-email';
import { EmailLayout } from './layout';

export type ResetPasswordEmailProps = {
  heading: string;
  body: string;
  button: string;
  url: string;
};

/**
 * Pure presentational template — takes already-translated strings as props
 * rather than a translator, so the template itself stays i18n-agnostic.
 */
export function ResetPasswordEmail({ heading, body, button, url }: ResetPasswordEmailProps) {
  return (
    <EmailLayout preview={heading}>
      <Heading style={headingStyle}>{heading}</Heading>
      <Text style={textStyle}>{body}</Text>
      <Button href={url} style={buttonStyle}>
        {button}
      </Button>
      <Text style={linkFallback}>
        <Link href={url} style={linkStyle}>
          {url}
        </Link>
      </Text>
    </EmailLayout>
  );
}

export default ResetPasswordEmail;

const headingStyle = {
  fontSize: '20px',
  fontWeight: 'bold' as const,
  color: '#18181b',
  margin: '0 0 16px',
};

const textStyle = {
  fontSize: '14px',
  lineHeight: '22px',
  color: '#3f3f46',
  margin: '0 0 24px',
};

const buttonStyle = {
  backgroundColor: '#18181b',
  borderRadius: '6px',
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: 'bold' as const,
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '12px 20px',
};

const linkFallback = {
  fontSize: '12px',
  color: '#71717a',
  margin: '24px 0 0',
  wordBreak: 'break-all' as const,
};

const linkStyle = {
  color: '#71717a',
};
