import { expect, test, type APIRequestContext } from '@playwright/test';
import { verifyEmail } from './helpers/confirmation';

async function csrf(request: APIRequestContext) {
  const { headerName, token } = await (await request.get('/api/csrf')).json();
  return { [headerName]: token };
}

async function login(request: APIRequestContext, email: string, password: string) {
  const response = await request.post('/api/login', {
    headers: await csrf(request), form: { email, password },
  });
  expect(response.status()).toBe(204);
}

test('планировщик учитывает пропущенные интервалы и останавливается на нуле', async ({ playwright }, info) => {
  const teacher = await playwright.request.newContext({ baseURL: info.project.use.baseURL });
  const student = await playwright.request.newContext({ baseURL: info.project.use.baseURL });
  const admin = await playwright.request.newContext({ baseURL: info.project.use.baseURL });
  try {
    await login(teacher, 'teacher@bgtu.test', 'demo2026');
    await login(admin, 'admin@bgtu.test', 'demo2026');
    const catalog = await (await student.get('/api/registration/catalog')).json();
    const group = catalog.groups.at(-1);
    const suffix = Date.now();
    const email = `rating-audit-${suffix}@bgtu.test`;
    const password = 'rating-audit-2026';
    const registration = await student.post('/api/registration', {
      headers: await csrf(student),
      data: { email, password, fullName: 'Студент для проверки АР', role: 'STUDENT', facultyId: group.facultyId, groupId: group.id },
    });
    expect(registration.status()).toBe(204);
    await verifyEmail(student, email);
    await login(student, email, password);
    const account = async () => (await student.get('/api/me')).json();
    const me = await account();
    expect(me.rating).toBe(1000);

    const teacherHeaders = await csrf(teacher);
    const approval = await admin.post(`/api/admin/groups/${group.id}/pending-students/${me.id}`, { headers: await csrf(admin) });
    expect(approval.status()).toBe(204);
    const assign = async (title: string, minutesOverdue: number, penaltyLimit: number) => {
      const response = await teacher.post('/api/teacher/assignments', {
        headers: teacherHeaders,
        data: { title, description: 'Проверка фонового списания.', groupIds: [group.id], penaltyLimit,
          deadline: new Date(Date.now() - (minutesOverdue * 60 + 10) * 1000).toISOString() },
      });
      expect(response.status()).toBe(201);
      return (await response.json()).id as number;
    };
    const firstTitle = `Пять минут просрочки ${suffix}`;
    const firstId = await assign(firstTitle, 5, 145);
    await expect.poll(async () => (await account()).rating, { timeout: 15_000 }).toBe(900);

    const secondTitle = `Остаток АР ${suffix}`;
    const secondId = await assign(secondTitle, 55, 1000);
    await expect.poll(async () => (await account()).rating, { timeout: 15_000 }).toBe(0);
    const works = await (await student.get('/api/student/assignments')).json();
    expect(works).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: firstId, deducted: 100 }),
      expect.objectContaining({ id: secondId, deducted: 900 }),
    ]));
    const { personal } = await (await student.get(`/api/profiles/${me.id}`)).json();
    expect(personal.ratingHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ currency: 'AR', amount: -100, assignmentTitle: firstTitle }),
      expect.objectContaining({ currency: 'AR', amount: -900, assignmentTitle: secondTitle }),
    ]));
  } finally {
    await Promise.all([teacher.dispose(), student.dispose(), admin.dispose()]);
  }
});
