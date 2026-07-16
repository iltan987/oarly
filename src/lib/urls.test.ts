import { describe, it, expect } from 'vitest';
import { parseAppOrigin, clubUrl, apexUrl } from './urls';

describe('parseAppOrigin', () => {
  it('parses a prod https origin', () => {
    expect(parseAppOrigin('https://oarly.sbs')).toEqual({ protocol: 'https:', rootDomain: 'oarly.sbs' });
  });
  it('keeps the port for local dev', () => {
    expect(parseAppOrigin('http://lvh.me:3000')).toEqual({ protocol: 'http:', rootDomain: 'lvh.me:3000' });
  });
  it('ignores any path on APP_URL', () => {
    expect(parseAppOrigin('https://oarly.sbs/whatever')).toEqual({ protocol: 'https:', rootDomain: 'oarly.sbs' });
  });
});

describe('clubUrl / apexUrl', () => {
  const prod = { protocol: 'https:', rootDomain: 'oarly.sbs' };
  const dev = { protocol: 'http:', rootDomain: 'lvh.me:3000' };
  it('builds a club subdomain URL', () => {
    expect(clubUrl('demo', prod)).toBe('https://demo.oarly.sbs');
    expect(clubUrl('demo', dev)).toBe('http://demo.lvh.me:3000');
  });
  it('builds an apex URL with a path', () => {
    expect(apexUrl('/', prod)).toBe('https://oarly.sbs/');
    expect(apexUrl('/privacy', prod)).toBe('https://oarly.sbs/privacy');
  });
});
