import type { ReactNode } from 'react';

import { AppControls } from '@/components/app-controls';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col gap-6 p-6">
      <div className="flex justify-end">
        <AppControls />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-6">
        {children}
      </div>
    </main>
  );
}
