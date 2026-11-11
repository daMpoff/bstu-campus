import { useState } from 'react';
import { Link } from 'react-router-dom';
import { post, type Group, type PendingWork, type RankedStudent, type TeacherAssignment, type TeacherDashboardData } from './api';
import { Attachments } from './Assignments';
import { CabinetMetric } from './Cabinet';
import cabinet from './cabinet.module.css';
import { useCabinetResource } from './useCabinetResource';
import s from './teacher-cabinet.module.css';

const deadlineFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow',
});
const panel = `panel ${cabinet.section}`;

function AssignmentProgress({ total, accepted, waiting }: Pick<TeacherAssignment, 'total' | 'accepted' | 'waiting'>) {
  const width = (count: number) => total ? `${100 * count / total}%` : '0%';
  return <div className={s.progress} data-assignment-progress>
    <div className={s.progressTitle}><span>Сдали работу</span><strong>{accepted + waiting} из {total}</strong></div>
    <div className={s.progressTrack} aria-hidden="true">
      <span className={s.acceptedSegment} style={{ width: width(accepted) }} />
      <span className={s.waitingSegment} style={{ width: width(waiting) }} />
    </div>
    <div className={s.progressCounts}>
      <span className={s.accepted}>Принято <b>{accepted}</b></span>
      <span className={s.highlight}>На проверке <b>{waiting}</b></span>
      <span>Не сдали <b>{total - accepted - waiting}</b></span>
    </div>
  </div>;
}

function AssignmentRow({ assignment }: { assignment: TeacherAssignment }) {
  return <li className={s.taskRow}>
    <div className={s.taskInfo}>
      <h3><Link to={`/assignments/${assignment.id}`}>{assignment.title}</Link></h3>
      <p className={s.description}>{assignment.description}</p>
      <div className={s.taskMeta}>
        <span className={s.groups}>{assignment.groups.map(group => <span className={s.groupBadge} key={group}>{group}</span>)}</span>
        <span>до <time dateTime={assignment.deadline}>{deadlineFormatter.format(new Date(assignment.deadline))}</time> · лимит {assignment.penaltyLimit} АР</span>
      </div>
    </div>
    <AssignmentProgress {...assignment} />
  </li>;
}

function WorkInfo({ work }: { work: PendingWork }) {
  return <div className={s.workInfo}>
    <p className={s.rowTitle}>{work.studentName}</p>
    <p className={s.meta}>{work.groupName} · <Link to={`/assignments/${work.assignmentId}`}>{work.assignmentTitle}</Link></p>
  </div>;
}

export function TeacherDashboard({ reviewOnly = false }: { reviewOnly?: boolean }) {
  const { data, error, reload } = useCabinetResource<TeacherDashboardData>('/teacher/dashboard', 6000);
  const [busy, setBusy] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [notice, setNotice] = useState('');
  const assignments = data?.assignments;
  const waiting = data?.pendingWorks;
  const groups = assignments && new Set(assignments.flatMap(assignment => assignment.groups)).size;

  async function review(work: PendingWork, action: 'ACCEPTED' | 'RETURNED') {
    setBusy(true);
    setReviewError('');
    setNotice('');
    try {
      await post(`/teacher/assignments/${work.assignmentId}/review`, { action, studentIds: [work.studentId] });
      setNotice(action === 'ACCEPTED' ? 'Работа принята.' : 'Работа возвращена на доработку.');
    } catch (failure) {
      setReviewError(failure instanceof Error ? failure.message : 'Не удалось проверить работу.');
    } finally {
      setBusy(false);
      reload();
    }
  }

  return <>
    {error && <p className="error" role="alert">{error}</p>}
    {!data && !error && <p className="muted" role="status">Загружаем задания…</p>}
    {reviewOnly ? <section className={panel} aria-labelledby="teacher-review-title">
      <h2 id="teacher-review-title">Проверка работ</h2>
      {waiting?.length === 0 && <p className={s.empty}>Работ на проверке нет.</p>}
      <ul className={s.list}>
        {waiting?.map(work => <li className={s.workRow} key={`${work.assignmentId}-${work.studentId}`}>
          <WorkInfo work={work} />
          <Attachments work={work} assignmentId={work.assignmentId} studentId={work.studentId} />
          <div className={s.actions}>
            <button className="button primary" type="button" disabled={busy} onClick={() => void review(work, 'ACCEPTED')}>Принять</button>
            <button className="button outline" type="button" disabled={busy} onClick={() => void review(work, 'RETURNED')}>Вернуть на доработку</button>
          </div>
        </li>)}
      </ul>
      {notice && <p className={s.empty} role="status">{notice}</p>}
      {reviewError && <p className="error" role="alert">{reviewError}</p>}
    </section> : <>
      <dl className={cabinet.metrics} data-cabinet-metrics>
        <CabinetMetric label="Назначено заданий">{assignments?.length ?? '—'}</CabinetMetric>
        <CabinetMetric label="Работы на проверке" valueClassName={s.highlight}>{waiting?.length ?? '—'}</CabinetMetric>
        <CabinetMetric label="Учебные группы">{groups ?? '—'}</CabinetMetric>
      </dl>
      <div className={cabinet.sections} data-cabinet-sections>
        <section className={`${panel} ${cabinet.widePanel}`} aria-labelledby="teacher-assignments-title">
          <div className={s.sectionHead}>
            <h2 id="teacher-assignments-title">Задания</h2>
            <Link className="button primary" to="/assignments/new">Новое задание</Link>
          </div>
          {assignments?.length === 0 && <p className={s.empty}>Заданий пока нет.</p>}
          <ul className={s.list}>{assignments?.map(assignment => <AssignmentRow key={assignment.id} assignment={assignment} />)}</ul>
        </section>
        <section className={panel} aria-labelledby="teacher-queue-title">
          <div className={s.sectionHead}><h2 id="teacher-queue-title">На проверке</h2></div>
          {waiting?.length === 0 && <p className={s.empty}>Работ на проверке нет.</p>}
          <ul className={s.list}>{waiting?.slice(0, 3).map(work =>
            <li className={s.workRow} key={`${work.assignmentId}-${work.studentId}`}><WorkInfo work={work} /></li>)}</ul>
          {Boolean(waiting?.length) && <Link className={s.queueLink} to="/review">Все работы на проверке <span aria-hidden="true">→</span></Link>}
        </section>
      </div>
    </>}
  </>;
}

export function TeacherRating() {
  const { data: groups, error } = useCabinetResource<Group[]>('/teacher/groups');
  const [selected, setSelected] = useState('');
  const groupId = selected || groups?.[0]?.id;
  return <section className={panel} aria-labelledby="teacher-rating-title">
    <div className={s.sectionHead}>
      <h2 id="teacher-rating-title">Рейтинг студентов</h2>
      {groupId && <div className={s.groupFilter}>
        <label htmlFor="rating-group">Учебная группа</label>
        <select id="rating-group" value={groupId} onChange={event => setSelected(event.target.value)}>
          {groups?.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
        </select>
      </div>}
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {!groups && !error && <p className="muted" role="status">Загружаем группы…</p>}
    {groups?.length === 0 && <p className={s.empty}>Учебных групп пока нет.</p>}
    {groupId && <GroupRating key={groupId} groupId={groupId} />}
  </section>;
}

function GroupRating({ groupId }: { groupId: number | string }) {
  const { data, error } = useCabinetResource<RankedStudent[]>(`/teacher/groups/${groupId}/ranking`, 6000);
  return <>
    {error && <p className="error" role="alert">{error}</p>}
    {!data && !error && <p className="muted" role="status">Загружаем рейтинг…</p>}
    {data?.length === 0 && <p className={s.empty}>В этой группе пока нет студентов.</p>}
    {Boolean(data?.length) && <table className={s.ranking}>
      <thead><tr><th scope="col">Студент</th><th scope="col">АР из 1000</th></tr></thead>
      <tbody>{data?.map(student => <tr key={student.id}>
        <td><Link to={`/profiles/${student.id}`}>{student.fullName}</Link></td>
        <td>{student.rating}</td>
      </tr>)}</tbody>
    </table>}
  </>;
}
