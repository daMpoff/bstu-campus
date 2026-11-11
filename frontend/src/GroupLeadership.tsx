import { useState } from 'react';
import { api } from './api';
import cabinet from './cabinet.module.css';
import s from './group-approval.module.css';

type Person = { id: number; fullName: string };
export type LeadershipData = { leaderId: number | null; students: Person[]; teachers: Person[]; teacherIds: number[] };

export function GroupLeadership({ path, admin, data, error, reload }: {
  path: string; admin: boolean; data?: LeadershipData; error: string; reload: () => void;
}) {
  const [leaderDraft, setLeaderDraft] = useState<number>();
  const [teacherDraft, setTeacherDraft] = useState<number[]>();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');
  const currentLeader = data?.students.find(student => student.id === data.leaderId);
  const leaderId = leaderDraft ?? data?.leaderId ?? '';
  const selectedTeachers = teacherDraft ?? data?.teacherIds ?? [];
  const teachersChanged = data && (selectedTeachers.length !== data.teacherIds.length
    || selectedTeachers.some(id => !data.teacherIds.includes(id)));

  async function save(resource: string, body: object, message: string) {
    if (saving) return;
    setSaving(true);
    setNotice('');
    setFailure('');
    try {
      await api(`${path}/${resource}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      setNotice(message);
      reload();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Не удалось сохранить изменения.');
    } finally {
      setSaving(false);
    }
  }

  return <section className={`panel ${cabinet.section} ${s.panel}`} aria-labelledby="group-leadership-title">
    <h2 id="group-leadership-title">Управление группой</h2>
    {error && <div className={s.filterActions}>
      <p className="error" role="alert">{error}</p>
      <button type="button" className="button outline" onClick={reload}>Повторить</button>
    </div>}
    {!data && !error && <p role="status" className="muted">Загружаем состав группы…</p>}
    {data && <>
      <div className={s.leadership}>
        <label>Староста группы
          <select value={leaderId} disabled={saving || !data.students.length}
            onChange={event => setLeaderDraft(Number(event.target.value))}>
            <option value="" disabled>Выберите студента</option>
            {data.students.map(student => <option key={student.id} value={student.id}>{student.fullName}</option>)}
          </select>
        </label>
        <div className={s.filterActions}>
          <button type="button" className="button primary"
            disabled={saving || !data.students.some(student => student.id === leaderId) || leaderId === data.leaderId}
            onClick={() => void save('leader', { studentId: leaderId }, 'Староста назначен.')}>Назначить старосту</button>
          {currentLeader && <button type="button" className="button outline" disabled={saving}
            onClick={() => {
              setLeaderDraft(undefined);
              void save('leader', { studentId: null }, 'Назначение старосты снято.');
            }}>Снять старосту</button>}
        </div>
      </div>
      <p className="muted">{currentLeader ? `Текущий староста · ${currentLeader.fullName}`
        : data.students.length ? 'Староста пока не назначен.' : 'Назначить можно студента с подтверждённой группой.'}</p>
      {admin && <fieldset className={s.teachers} disabled={saving}>
        <legend>Ответственные преподаватели</legend>
        {data.teachers.length > 0 ? <>
          <div className={s.teacherOptions}>
            {data.teachers.map(teacher => <label className={s.pendingFilter} key={teacher.id}>
              <input type="checkbox" checked={selectedTeachers.includes(teacher.id)}
                onChange={event => setTeacherDraft(event.target.checked
                  ? [...selectedTeachers, teacher.id] : selectedTeachers.filter(id => id !== teacher.id))} />
              {teacher.fullName}
            </label>)}
          </div>
          <button type="button" className="button outline" disabled={!teachersChanged}
            onClick={() => void save('responsible-teachers', { teacherIds: selectedTeachers }, 'Ответственные преподаватели сохранены.')}>
            Сохранить преподавателей
          </button>
        </> : <p className="muted">Нет преподавателей с подтверждённым email.</p>}
      </fieldset>}
    </>}
    {saving && <p role="status" className="muted">Сохраняем изменения…</p>}
    {notice && <p role="status">{notice}</p>}
    {failure && <p role="alert" className="error">{failure}</p>}
  </section>;
}
