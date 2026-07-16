import { describe, expect, it } from 'vitest';

import config from '../../drizzle.config';

describe('drizzle config', () => {
  it('targets postgresql and the schema barrel', () => {
    expect(config.dialect).toBe('postgresql');
    expect(config.schema).toBe('./src/db/schema/index.ts');
    expect(config.out).toBe('./drizzle');
  });
});
