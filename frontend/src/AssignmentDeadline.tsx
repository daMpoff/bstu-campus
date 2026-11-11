import { useSyncExternalStore } from 'react';
import type { Status } from './api';
import s from './deadline.module.css';

const subscribers = new Set<() => void>();
let clock = Date.now();
let interval: number | undefined;

function tick() {
  clock = Date.now();
  subscribers.forEach(update => update());
}

function subscribe(update: () => void) {
  subscribers.add(update);
  if (interval === undefined) {
    clock = Date.now();
    interval = window.setInterval(tick, 1000);
  }
  return () => {
    subscribers.delete(update);
    if (subscribers.size === 0) {
      window.clearInterval(interval);
      interval = undefined;
    }
  };
}

const snapshot = () => clock;

export function useDeadlineClock() {
  return useSyncExternalStore(subscribe, snapshot);
}

export function canSubmitWork(status: Status) {
  return status === 'OPEN' || status === 'OVERDUE' || status === 'RETURNED';
}

export function remainingPenalty(limit: number, deducted: number, rating: number) {
  return Math.max(0, Math.min(rating, limit - deducted));
}

export function formatRemainingPenalty(amount: number) {
  return amount > 0 ? `до ${amount} АР` : '0 АР';
}

function formatDuration(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds / 3600) % 24;
  const minutes = Math.floor(seconds / 60) % 60;
  const remainder = seconds % 60;
  if (days) return `${days} д ${hours} ч`;
  if (hours) return `${hours} ч ${minutes} мин`;
  if (minutes) return `${minutes} мин ${String(remainder).padStart(2, '0')} с`;
  return `${remainder} с`;
}

export type AssignmentPenalty = { deducted: number; limit: number; rating: number };

export function DeadlineIndicator({ deadline, status, allSubmitted = false, penalty }: {
  deadline: string; status?: Status; allSubmitted?: boolean; penalty?: AssignmentPenalty;
}) {
  if (status === 'ACCEPTED') return null;
  return <DeadlineCountdown deadline={deadline} status={status} allSubmitted={allSubmitted} penalty={penalty} />;
}

function DeadlineCountdown({ deadline, status, allSubmitted, penalty }: {
  deadline: string; status?: Status; allSubmitted: boolean; penalty?: AssignmentPenalty;
}) {
  const now = useDeadlineClock();
  const time = Date.parse(deadline);
  if (!Number.isFinite(time)) return null;

  const open = status ? canSubmitWork(status) : !allSubmitted;
  const overdue = status === 'OVERDUE' || now >= time;
  const seconds = overdue
    ? Math.max(0, Math.floor((now - time) / 1000))
    : Math.ceil((time - now) / 1000);
  const tone = open && overdue ? 'overdue' : open && seconds <= 86400 ? 'soon' : 'normal';
  const label = overdue ? 'Время просрочки' : 'До дедлайна';

  return <span className={s.deadline} data-tone={tone}>
    {overdue && !open ? <span>Дедлайн прошёл</span> : <span role="timer" aria-label={label}>
      {overdue ? 'Просрочка' : 'Осталось'} <strong>{formatDuration(seconds)}</strong>
    </span>}
    {overdue && open && penalty && <PenaltyAmounts {...penalty} />}
  </span>;
}

export function PenaltyAmounts({ deducted, limit, rating }: AssignmentPenalty) {
  return <span className={s.penalty}>
    <span>Списано <strong>{deducted} АР</strong></span>
    <span>Ещё <strong>{formatRemainingPenalty(remainingPenalty(limit, deducted, rating))}</strong></span>
  </span>;
}
