export type Role = 'TEACHER' | 'STUDENT' | 'ADMIN';
export type Account = {
  id: number; fullName: string; role: Role; groupName: string | null; rating: number;
  facultyName: string | null; departmentName: string | null; groupVerified: boolean;
};
export type Group = { id: number; name: string };
export type RegistrationCatalog = {
  faculties: { id: number; name: string }[];
  departments: { id: number; name: string; facultyName: string }[];
  groups: (Group & { studyForm: 'очная' | 'очно-заочное' | 'заочное'; facultyId: number })[];
};
export type Status = 'OPEN' | 'OVERDUE' | 'SUBMITTED' | 'RETURNED' | 'ACCEPTED';
export type BaseAssignment = { id: number; title: string; description: string; deadline: string; penaltyLimit: number };
export type TeacherAssignment = BaseAssignment & { groups: string[]; total: number; accepted: number; waiting: number };
export type Attachment = { link: string | null; fileName: string | null };
export type PendingWork = Attachment & {
  assignmentId: number; assignmentTitle: string; studentId: number; studentName: string; groupName: string;
};
export type TeacherDashboardData = { assignments: TeacherAssignment[]; pendingWorks: PendingWork[] };
export type RankedStudent = { id: number; fullName: string; rating: number };
export type ActivityKind = 'ACADEMIC' | 'PUBLIC';
export type Activity = {
  id: number; title: string; description: string; occursAt: string; maxPoints: number;
  kind: ActivityKind; teacherName: string; groups: string[];
};
export type ParticipationLevel = 25 | 50 | 75 | 100;
export type ActivityParticipation = { participation: ParticipationLevel | null; points: number | null };
export type StudentActivity = ActivityParticipation & { activity: Activity; enrolled: boolean; canEnroll: boolean };
export type ActivityParticipant = ActivityParticipation & { studentId: number; studentName: string; groupName: string };
export type ActivityDetail = {
  activity: Activity; canConfirm: boolean; budgetMonth: string; participants: ActivityParticipant[];
  budgets: { groupId: number; groupName: string; spent: number; remaining: number; limit: number; awards: number }[];
};
export type Reward = {
  id: number; studentId: number; studentName: string; activityTitle: string; kind: ActivityKind; points: number; awardedAt: string;
};
export type RewardPage = { entries: Reward[]; nextBeforeId: number | null };
export type StudentAssignment = BaseAssignment & Attachment & { teacherName: string; status: Status; deducted: number };
export type Work = Attachment & { studentId: number; studentName: string; groupName: string; status: Status; deducted: number };
export type ProfileAssignment = Pick<StudentAssignment, 'id' | 'title' | 'deadline' | 'status'>;
export type StudentProfileData = {
  student: {
    id: number; fullName: string; facultyName: string | null; groupName: string; rating: number;
    academicActivityPoints: number; publicActivityPoints: number;
  };
  personal: {
    assignments: ProfileAssignment[];
    ratingHistory: {
      id: number; currency: 'AR' | 'BUA' | 'BOA'; assignmentTitle: string | null; semesterStart: string | null;
      activityTitle: string | null; teacherName: string | null; amount: number; recordedAt: string;
    }[];
  } | null;
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const sessionExpiredEvent = 'campus-session-expired';
let sessionVersion = 0;

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.method && init.method !== 'GET') {
    const token = await api<{ headerName: string; token: string }>('/csrf');
    headers.set(token.headerName, token.token);
  }
  const requestSessionVersion = sessionVersion;
  const response = await fetch('/api' + path, { ...init, headers });
  if (!response.ok) {
    if (response.status === 401 && path !== '/login' && requestSessionVersion === sessionVersion) {
      window.dispatchEvent(new Event(sessionExpiredEvent));
    }
    const body = await response.json().catch(() => null);
    const defaultMessage = response.status === 401 ? path === '/login' ? 'Проверьте email и пароль.' : 'Сессия завершилась. Войдите снова.'
      : response.status === 413 ? 'Файл должен быть не больше 10 МБ.'
        : 'Запрос не выполнен. Попробуйте ещё раз.';
    throw new ApiError(response.status, body?.detail || body?.message || defaultMessage);
  }
  if (path === '/login' || path === '/logout') sessionVersion += 1;
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export function post<T>(path: string, body: unknown) {
  return api<T>(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
