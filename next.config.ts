import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// For WSL phone/LAN dev, scripts/setup-dev-env.mjs (run by `pnpm dev`) writes
// DEV_ALLOWED_ORIGIN_HOST (e.g. 192.168.1.37.nip.io) into .env.development.local
// before `next dev` boots, so Turbopack/HMR and /_next assets are allowed for
// the apex host and club subdomains. Unset in production and plain localhost
// dev — then no allowlist is added.
const devHost = process.env.DEV_ALLOWED_ORIGIN_HOST;

const nextConfig: NextConfig = {
  ...(devHost ? { allowedDevOrigins: [devHost, `**.${devHost}`] } : {}),
};

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');
export default withNextIntl(nextConfig);
