'use client';
import { format, parse } from 'date-fns';
import { enUS, tr } from 'date-fns/locale';
import { ChevronDownIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useState } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/**
 * Owner Bookings date jump: click to open a calendar and go to ANY day in one
 * action (the ‹/› arrows on either side still step by a single day). The value
 * is a bare club-local calendar date (yyyy-MM-dd), so we parse/format without a
 * timezone — the picked day is used verbatim as the `?date=` query.
 */
export function DateJump({ dateISO }: { dateISO: string }) {
  const router = useRouter();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const selected = parse(dateISO, 'yyyy-MM-dd', new Date());
  const dfLocale = locale === 'tr' ? tr : enUS;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={buttonVariants({ variant: 'outline', size: 'sm' })}>
        <span className="font-heading font-semibold">{format(selected, 'd MMM yyyy', { locale: dfLocale })}</span>
        <ChevronDownIcon className="opacity-60" />
      </PopoverTrigger>
      <PopoverContent align="center" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          locale={dfLocale}
          onSelect={(day) => {
            if (!day) return;
            setOpen(false);
            router.push(`/manage/bookings?date=${format(day, 'yyyy-MM-dd')}`);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
