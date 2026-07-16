import { describe, expect, it } from 'vitest';

import { cn } from '@/lib/utils';

describe('test harness', () => {
  it('resolves the @/ alias and merges classes', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });
});
