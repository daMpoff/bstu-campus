import { apiResponse, type Status } from './api';

export type StudentAssistantPeriod = 'active' | 'this_week' | 'next_week' | 'next_7_days';

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

export async function getStudentAssistantSummary(period: StudentAssistantPeriod, signal: AbortSignal): Promise<StudentAssistantResult> {
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
