'use client';
import { ChevronsUpDownIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { useDebouncedCallback } from 'use-debounce';

import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import { type MemberHit, searchClubMembersAction } from './actions';

/**
 * Owner member picker: type-to-search over the club's approved members via a
 * server action (name / email / phone), so a large club never loads or renders
 * its whole roster. Selection is lifted to the parent form as `selected` (its
 * `userId` is the FormData source of truth). email + phone are shown to tell
 * apart members who share a name.
 */
export function MemberCombobox({ slug, selected, onSelect }: {
  slug: string;
  selected: MemberHit | null;
  onSelect: (m: MemberHit) => void;
}) {
  const t = useTranslations('manage.bookings');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MemberHit[]>([]);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  // Debounce the server search (use-debounce auto-cancels its timer on unmount).
  // The reqId guard drops out-of-order responses so a slow earlier query can't
  // overwrite a newer one.
  const runSearch = useDebouncedCallback((q: string) => {
    const id = ++reqId.current;
    void (async () => {
      try {
        const hits = await searchClubMembersAction(slug, q);
        if (id === reqId.current) setResults(hits);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    })();
  }, 250);

  function onQueryChange(value: string) {
    setQuery(value);
    const q = value.trim();
    if (q.length < 2) {
      runSearch.cancel();
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    runSearch(q);
  }

  const sub = (m: MemberHit) => [m.email, m.phone].filter(Boolean).join(' · ');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        className={cn(
          'flex h-8 min-w-48 flex-1 items-center justify-between gap-2 rounded-lg border border-input bg-background px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
          !selected && 'text-muted-foreground',
        )}
      >
        <span className="min-w-0 truncate">{selected ? selected.name : t('selectMember')}</span>
        <ChevronsUpDownIcon className="size-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="p-2">
          <Input autoFocus value={query} onChange={(e) => onQueryChange(e.target.value)} placeholder={t('searchMemberPlaceholder')} />
        </div>
        <div className="max-h-64 overflow-y-auto px-1 pb-1">
          {query.trim().length < 2 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">{t('searchMemberHint')}</p>
          ) : loading ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">{t('searching')}</p>
          ) : results.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">{t('noResults')}</p>
          ) : (
            <ul className="flex flex-col">
              {results.map((m) => (
                <li key={m.userId}>
                  <button
                    type="button"
                    onClick={() => { onSelect(m); setOpen(false); }}
                    className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    <span className="font-medium">{m.name}</span>
                    {sub(m) && <span className="text-xs text-muted-foreground">{sub(m)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
