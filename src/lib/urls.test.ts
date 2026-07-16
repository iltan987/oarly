import { describe, it, expect } from 'vitest';
import { parseAppOrigin, clubUrl, apexUrl, safeRedirect } from './urls';

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

describe('safeRedirect', () => {
  const origin = parseAppOrigin('https://oarly.sbs');
  it('allows relative paths', () => {
    expect(safeRedirect('/admin', origin)).toBe('/admin');
  });
  it('allows the apex and any subdomain of the root', () => {
    expect(safeRedirect('https://oarly.sbs/x', origin)).toBe('https://oarly.sbs/x');
    expect(safeRedirect('https://demo.oarly.sbs/join', origin)).toBe('https://demo.oarly.sbs/join');
  });
  it('rejects foreign hosts and protocol-relative tricks, using the fallback', () => {
    expect(safeRedirect('https://evil.com/x', origin)).toBe('/');
    expect(safeRedirect('//evil.com', origin)).toBe('/');
    expect(safeRedirect(null, origin, '/home')).toBe('/home');
  });
});
