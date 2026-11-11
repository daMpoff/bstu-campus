import type { ActivityKind } from './api';

export const formatPoints = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format;
export const pointLabels = { AR: 'АР', BUA: 'БУА', BOA: 'БОА' };
export const activityPointLabel = (kind: ActivityKind) => pointLabels[kind === 'PUBLIC' ? 'BOA' : 'BUA'];
