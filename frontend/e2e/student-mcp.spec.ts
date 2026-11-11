import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { csrf } from './helpers/confirmation';

const endpoint = '/api/student/mcp';
const tool = 'get_my_deadlines_and_rating';

async function login(request: APIRequestContext, account: string) {
  expect((await request.post('/api/login', {
    headers: await csrf(request), form: { email: account + '@bgtu.test', password: 'demo2026' },
  })).status()).toBe(204);
}

async function rpc(request: APIRequestContext, method: string, params: object = {},
  version = '2025-11-25', origin?: string) {
  return request.post(endpoint, {
    headers: {
      ...await csrf(request), Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': version,
      ...(origin ? { Origin: origin } : {}),
    },
    data: { jsonrpc: '2.0', ...(method.startsWith('notifications/') ? {} : { id: 1 }), method, params },
  });
}

async function initialize(request: APIRequestContext) {
  const response = await rpc(request, 'initialize', {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'campus-e2e', version: '1.0.0' },
  });
  expect(response.ok()).toBeTruthy();
  expect(response.headers()['cache-control']).toContain('no-store');
  const { result } = await response.json();
  const version = result.protocolVersion as string;
  expect(version).toBe('2025-11-25');
  expect(result.capabilities).toHaveProperty('tools');
  expect((await rpc(request, 'notifications/initialized', {}, version)).status()).toBe(202);
  return version;
}

function summary(request: APIRequestContext, version: string, args: object = { period: 'this_week' }) {
  return rpc(request, 'tools/call', { name: tool, arguments: args }, version);
}

test('MCP показывает задания и АР вошедшего студента и сохраняет изоляцию личных данных', async ({ browser, request }) => {
  test.setTimeout(75_000);
  const [teacher, student, other] = await Promise.all(Array.from({ length: 3 }, () => browser.newPage()));
  try {
    await Promise.all([login(teacher.request, 'teacher'), login(student.request, 'student'), login(other.request, 'student2')]);
    const account = await (await student.request.get('/api/me')).json();
    const title = 'Личный дедлайн ' + randomUUID();
    const assignment = await teacher.request.post('/api/assistant/assignments', {
      headers: await csrf(teacher.request),
      multipart: {
        requestId: randomUUID(), recipientId: String(account.id), title,
        description: 'Проверка видимости дедлайна.', deadline: new Date(Date.now() - 180_000).toISOString(),
        penaltyLimit: '1',
      },
    });
    expect(assignment.status()).toBe(201);
    const { assignmentId, path } = await assignment.json();

    expect((await rpc(request, 'tools/list')).status()).toBe(401);
    expect((await rpc(teacher.request, 'tools/list')).status()).toBe(403);
    expect((await rpc(student.request, 'tools/list', {}, '2025-11-25', 'https://unrelated.example')).status()).toBe(403);
    expect((await student.request.post(endpoint, {
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    })).status()).toBe(403);

    const [studentVersion, otherVersion] = await Promise.all([initialize(student.request), initialize(other.request)]);
    const tools = await rpc(student.request, 'tools/list', {}, studentVersion);
    expect((await tools.json()).result.tools).toEqual([
      expect.objectContaining({ name: tool, inputSchema: expect.objectContaining({ additionalProperties: false }) }),
    ]);

    await expect.poll(async () => {
      const { result } = await (await summary(student.request, studentVersion)).json();
      return result?.structuredContent?.ratingHistory.some((item: { assignmentTitle: string; amount: number }) =>
        item.assignmentTitle === title && item.amount === -1);
    }, { timeout: 15_000 }).toBe(true);
    const own = await summary(student.request, studentVersion);
    expect(own.status()).toBe(200);
    const { result } = await own.json();
    const data = result.structuredContent;
    expect(data.period.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(data.period.startDate).getUTCDay()).toBe(1);
    expect(Date.parse(data.period.endDate) - Date.parse(data.period.startDate)).toBe(6 * 86_400_000);
    const row = expect.objectContaining({ id: assignmentId, title, status: 'OVERDUE', deducted: 1 });
    expect(data.assignments.concat(data.overdue)).toEqual(expect.arrayContaining([row]));
    expect(data.ratingHistory).toEqual(expect.arrayContaining([expect.objectContaining({ assignmentTitle: title, amount: -1 })]));
    expect(data.rating).toBe((await (await student.request.get('/api/me')).json()).rating);

    const othersResult = await (await summary(other.request, otherVersion)).json();
    const otherData = othersResult.result.structuredContent;
    expect(otherData.assignments.concat(otherData.overdue).some((item: { id: number }) => item.id === assignmentId)).toBe(false);
    expect(otherData.ratingHistory.some((item: { assignmentTitle: string }) => item.assignmentTitle === title)).toBe(false);
    const forged = await (await summary(other.request, otherVersion, { studentId: account.id, period: 'this_week' })).json();
    expect(Boolean(forged.error || forged.result?.isError)).toBe(true);
    expect(JSON.stringify(forged)).not.toContain(title);

    const nextWeek = await (await summary(student.request, studentVersion, { period: 'next_week' })).json();
    expect(Date.parse(nextWeek.result.structuredContent.period.startDate) - Date.parse(data.period.startDate))
      .toBe(7 * 86_400_000);
    expect(nextWeek.result.structuredContent.overdue).toEqual(expect.arrayContaining([row]));

    await student.setViewportSize({ width: 320, height: 800 });
    await student.goto('/profile');
    await student.getByRole('button', { name: 'Помощник', exact: true }).click();
    const panel = student.getByRole('dialog', { name: 'Помощник' });
    await panel.getByLabel('Сообщение помощнику').fill('Что мне сдавать на этой неделе?');
    const mcpResult = student.waitForResponse(response => response.url().endsWith(endpoint)
      && response.request().postDataJSON()?.method === 'tools/call');
    await panel.getByRole('button', { name: 'Отправить', exact: true }).click();
    expect((await mcpResult).status()).toBe(200);
    const assignmentLink = panel.getByRole('link', { name: title });
    await expect(assignmentLink).toHaveAttribute('href', path);
    await expect(assignmentLink).toContainText('Просрочено');
    await expect(assignmentLink).toContainText(/Списано 1\s*АР/);
    expect(await student.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await assignmentLink.click();
    await expect(student).toHaveURL(new URL(path, student.url()).href);
  } finally {
    await Promise.all([teacher.close(), student.close(), other.close()]);
  }
});
