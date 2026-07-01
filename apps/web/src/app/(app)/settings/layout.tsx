import type { ReactNode } from 'react';
import { SettingsTabs } from '@/components/settings/settings-tabs';

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
      <SettingsTabs />
      {children}
    </div>
  );
}
