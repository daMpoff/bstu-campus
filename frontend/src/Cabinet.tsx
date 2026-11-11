import type { ReactNode } from 'react';
import s from './cabinet.module.css';

export function CabinetPage({ name, subtitle, themeToggle, nameHeading = true, children }: {
  name?: string; subtitle?: string; themeToggle: ReactNode; nameHeading?: boolean; children: ReactNode;
}) {
  const Title = nameHeading ? 'h1' : 'p';
  const initials = name?.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('');
  return <main className={s.page} data-cabinet-page>
    <header className={s.identity} data-cabinet-header>
      {initials && <span className={s.avatar} aria-hidden="true">{initials}</span>}
      <div className={s.identityCopy}>
        <Title className={s.identityTitle}>{name ?? 'Профиль студента'}</Title>
        {subtitle && <p className={s.subtitle}>{subtitle}</p>}
      </div>
      {themeToggle}
    </header>
    {children}
  </main>;
}

export function CabinetMetric({ label, valueClassName, children }: {
  label: string; valueClassName?: string; children: ReactNode;
}) {
  return <div className={`panel ${s.metric}`}>
    <dt>{label}</dt>
    <dd className={valueClassName}>{children}</dd>
  </div>;
}
