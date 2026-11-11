import { apiResponse, type Status } from './api';

type Period = 'active' | 'this_week' | 'next_week' | 'next_7_days';

export type AssistantDeadline = {
  id: number;
  title: string;
  deadline: string;
  status: Status;
  deducted: number;
};

export type StudentAssistantResult = {
  period: { startDate: string; endDate: string } | null;
  rating: number;
  assignments: AssistantDeadline[];
  overdue: AssistantDeadline[];
  ratingHistory: {
    amount: number;
    recordedAt: string;
    assignmentTitle: string | null;
    semesterStart: string | null;
  }[];
  assignmentsTotal: number;
  overdueTotal: number;
};

export function studentAssistantPeriod(question: string): Period | null {
  const words = question.toLowerCase().replaceAll('ё', 'е').match(/[\p{L}\p{N}]+/gu)?.join(' ') ?? '';
  const personal = /(?:^| )(?:у меня|мне|меня|мой|моя|мое|мои|моих|моим)(?= |$)/u.test(words);
  const tasks = /(?:^| )(?:задани\p{L}*|задач\p{L}*)(?= |$)/u.test(words);
  const work = tasks || /дедлайн|срок сдачи|просроч/u.test(words);
  const list = /^(?:покажи|напомни|скажи|перечисли|какие|какой|каков|когда|есть ли|у меня есть|сколько)(?= |$)/u.test(words);
  const nextWeek = /(?:следующ|будущ)\p{L}* недел/u.test(words);
  const nextSevenDays = /(?:ближайш\p{L}*|следующ\p{L}*|через) (?:7|семь) дн/u.test(words);
  const week = nextWeek || nextSevenDays || /эт\p{L}* недел|на недел/u.test(words);
  const toSubmit = /^что (?:(?:мне|надо|нужно|осталось|еще) )*сда(?:ть|вать)(?= |$)/u.test(words);
  const upcoming = /ближайш\p{L}* (?:учебн\p{L}* )?(?:задани|задач|дедлайн)/u.test(words);
  const myWork = /^(?:мои|мой|моя|мое) (?:задани|задач|дедлайн)/u.test(words);
  const taskList = /^(?:(?:покажи|перечисли) )?(?:активные )?(?:задачи|задания)$/u.test(words)
    || (tasks && (myWork || (personal && list)));
  const myRating = /^(?:мой|мои) (?:академическ\p{L}* )?(?:рейтинг|ар(?= |$))/u.test(words)
    || (personal && list && /(?:^| )(?:рейтинг\p{L}*|ар)(?= |$)/u.test(words));
  const deductions = /^сколько /u.test(words) && /(?:^| )(?:списали|списано|сняли)(?= |$)/u.test(words);
  if (!taskList && !toSubmit && !upcoming && !myWork && !myRating && !deductions && !(work && list && (personal || week))) return null;
  if (nextWeek) return 'next_week';
  if (nextSevenDays || (upcoming && !week)) return 'next_7_days';
  if (!week && (taskList || toSubmit)) return 'active';
  return 'this_week';
}

const protocolVersion = '2025-11-25';
const failure = 'Не удалось получить ваши задания и рейтинг. Попробуйте ещё раз.';

function rpc(method: string, params: object, signal: AbortSignal, id?: number, version?: string) {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
  };
  if (version) headers['MCP-Protocol-Version'] = version;
  return apiResponse('/student/mcp', {
    method: 'POST', headers, signal, cache: 'no-store',
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
}

async function rpcResult<T>(response: Response, id: number): Promise<T> {
  const reply = await response.json().catch(() => null) as { jsonrpc: string; id: number; result?: T } | null;
  if (reply?.jsonrpc !== '2.0' || reply.id !== id || reply.result == null) throw new Error(failure);
  return reply.result;
}

export async function getStudentAssistantSummary(period: Period, signal: AbortSignal): Promise<StudentAssistantResult> {
  const initialization = await rpcResult<{ protocolVersion: string }>(await rpc('initialize', {
    protocolVersion, capabilities: {}, clientInfo: { name: 'bstu-campus', version: '0.1.0' },
  }, signal, 1), 1);
  const version = initialization.protocolVersion;
  if (version !== protocolVersion && version !== '2025-06-18') throw new Error(failure);

  await rpc('notifications/initialized', {}, signal, undefined, version);
  const result = await rpcResult<{ isError?: boolean; structuredContent?: StudentAssistantResult }>(await rpc('tools/call', {
    name: 'get_my_deadlines_and_rating', arguments: { period },
  }, signal, 2, version), 2);
  const summary = result.structuredContent;
  const range = summary?.period;
  const validPeriod = period === 'active' ? range === null
    : range && Number.isFinite(Date.parse(range.startDate)) && Number.isFinite(Date.parse(range.endDate));
  if (result.isError || !summary || !validPeriod || !Number.isFinite(summary.rating)
    || !Array.isArray(summary.assignments) || !Array.isArray(summary.overdue) || !Array.isArray(summary.ratingHistory)) {
    throw new Error(failure);
  }
  return summary;
}
