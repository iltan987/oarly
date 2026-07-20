import { Heading, Text } from 'react-email';

import { EmailLayout } from './layout';

export type BookingNoticeProps = {
  heading: string;
  intro: string;
  rows: { label: string; value: string }[];
  locale: string;
};

/**
 * Shared presentational template for booking-related notices (confirmation,
 * waitlist promotion, cancellation). Takes already-translated strings as props
 * so the template stays i18n-agnostic, matching the auth email templates.
 */
export function BookingNoticeEmail({ heading, intro, rows, locale }: BookingNoticeProps) {
  return (
    <EmailLayout preview={heading} locale={locale}>
      <Heading style={headingStyle}>{heading}</Heading>
      <Text style={textStyle}>{intro}</Text>
      {rows.map((r) => (
        <Text key={r.label} style={rowStyle}>
          <strong>{r.label}:</strong> {r.value}
        </Text>
      ))}
    </EmailLayout>
  );
}

export default BookingNoticeEmail;

const headingStyle = { fontSize: '20px', fontWeight: 'bold' as const, color: '#18181b', margin: '0 0 16px' };
const textStyle = { fontSize: '14px', lineHeight: '22px', color: '#3f3f46', margin: '0 0 16px' };
const rowStyle = { fontSize: '14px', lineHeight: '22px', color: '#18181b', margin: '0 0 4px' };
