import { Button, Heading, Text } from 'react-email';

import { EmailLayout } from './layout';

export type ClubDecisionProps = {
  heading: string;
  intro: string;
  noteLabel: string;
  note: string | null;
  button: string | null;
  url: string | null;
  locale: string;
};

/**
 * Approve / reject notice for a club request. Takes already-translated strings,
 * matching every other template in this folder — the template stays i18n-agnostic
 * and `renderClubDecision` owns the message keys.
 */
export function ClubDecisionEmail({ heading, intro, noteLabel, note, button, url, locale }: ClubDecisionProps) {
  return (
    <EmailLayout preview={heading} locale={locale}>
      <Heading style={headingStyle}>{heading}</Heading>
      <Text style={textStyle}>{intro}</Text>
      {note ? (
        <Text style={noteStyle}>
          <strong>{noteLabel}:</strong> {note}
        </Text>
      ) : null}
      {button && url ? (
        <Button href={url} style={buttonStyle}>{button}</Button>
      ) : null}
    </EmailLayout>
  );
}

export default ClubDecisionEmail;

const headingStyle = { fontSize: '20px', fontWeight: 'bold' as const, color: '#18181b', margin: '0 0 16px' };
const textStyle = { fontSize: '14px', lineHeight: '22px', color: '#3f3f46', margin: '0 0 16px' };
const noteStyle = { fontSize: '14px', lineHeight: '22px', color: '#18181b', margin: '0 0 16px' };
const buttonStyle = { backgroundColor: '#18181b', borderRadius: '6px', color: '#ffffff', display: 'inline-block', fontSize: '14px', fontWeight: 'bold' as const, padding: '12px 20px', textDecoration: 'none' };
