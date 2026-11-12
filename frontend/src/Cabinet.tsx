import type { ReactNode } from 'react';
import s from './cabinet.module.css';

export function CabinetPage({ children }: { children: ReactNode }) {
  return <main className={s.page} data-cabinet-page>{children}</main>;
}

export function CabinetAvatar({ name, className }: { name: string; className?: string }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('');
  return <span className={[s.avatar, className].filter(Boolean).join(' ')} aria-hidden="true" data-cabinet-avatar>{initials}</span>;
}

export function CabinetMetric({ label, valueClassName, children }: {
  label: string; valueClassName?: string; children: ReactNode;
}) {
  return <div className={`panel ${s.metric}`}>
    <dt>{label}</dt>
    <dd className={valueClassName}>{children}</dd>
  </div>;
}
