import type { ReactNode } from 'react';

import { AppControls } from '@/components/app-controls';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="relative mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-6 p-6">
      {/* Absolutely positioned, not in flow: this column is vertically centred, so an
          in-flow control row would ride down with the card and sit in the middle of the
          screen instead of reading as page chrome. */}
      <div className="absolute top-4 right-4">
        <AppControls />
      </div>
      {children}
    </main>
  );
}
