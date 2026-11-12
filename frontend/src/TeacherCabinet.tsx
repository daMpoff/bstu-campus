import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { post, type Group, type PendingWork, type RankedStudent, type TeacherAssignment, type TeacherDashboardData } from './api';
import { DeadlineIndicator } from './AssignmentDeadline';
import { InlineAttachments } from './AttachmentPreview';
import { CabinetMetric } from './Cabinet';
import cabinet from './cabinet.module.css';
import { useCabinetResource } from './useCabinetResource';
import s from './teacher-cabinet.module.css';

const deadlineFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow',
});
const panel = `panel ${cabinet.section}`;
const reviewCount = new Intl.PluralRules('ru-RU');
const workKey = (work: PendingWork) => `${work.assignmentId}-${work.studentId}`;

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
      <h2><Link to={`/assignments/${assignment.id}`}>{assignment.title}</Link></h2>
      <p className={s.description}>{assignment.description}</p>
      <div className={s.taskMeta}>
        <span className={s.groups}>
          {assignment.individual && <span className={s.groupBadge}>Личное задание</span>}
          {assignment.groups.map(group => <span className={s.groupBadge} key={group}>{group}</span>)}
        </span>
        <span>до <time dateTime={assignment.deadline}>{deadlineFormatter.format(new Date(assignment.deadline))} МСК</time> · лимит {assignment.penaltyLimit} АР</span>
        <DeadlineIndicator deadline={assignment.deadline} allSubmitted={assignment.accepted + assignment.waiting === assignment.total} />
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

export function TeacherReview() {
  const { data, error, reload, setData } = useCabinetResource<TeacherDashboardData>('/teacher/dashboard', 6000);
  const [selection, setSelection] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [notice, setNotice] = useState('');
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const focusAfterChange = useRef(false);
  const waiting = data?.pendingWorks;
  const chosen = waiting?.find(work => workKey(work) === selection) ?? waiting?.[0];
  const chosenKey = chosen && workKey(chosen);
  const count = waiting?.length ?? 0;
  const plural = reviewCount.select(count);

  useEffect(() => {
    if (waiting && chosenKey !== selection) setSelection(chosenKey);
    if (focusAfterChange.current) {
      focusAfterChange.current = false;
      (detailHeading.current ?? pageHeading.current)?.focus();
    }
  }, [waiting, chosenKey, selection, notice]);

  function choose(work: PendingWork) {
    const key = workKey(work);
    if (matchMedia('(max-width: 1079px)').matches) {
      if (key === chosenKey) detailHeading.current?.focus();
      else focusAfterChange.current = true;
    }
    if (key !== chosenKey) setReviewError('');
    setSelection(key);
  }

  async function review(action: 'ACCEPTED' | 'RETURNED') {
    if (busy || !chosen || !waiting) return;
    const key = workKey(chosen);
    setBusy(true);
    setReviewError('');
    setNotice('');
    try {
      await post(`/teacher/assignments/${chosen.assignmentId}/review`, { action, studentIds: [chosen.studentId] });
      const index = waiting.findIndex(work => workKey(work) === key);
      const next = waiting[index + 1] ?? waiting[index - 1];
      focusAfterChange.current = true;
      setSelection(next && workKey(next));
      setData(current => current && { ...current, pendingWorks: current.pendingWorks.filter(work => workKey(work) !== key) });
      setNotice(action === 'ACCEPTED' ? 'Работа принята.' : 'Работа возвращена на доработку.');
    } catch (failure) {
      setReviewError(failure instanceof Error ? failure.message : 'Не удалось проверить работу.');
    } finally {
      reload();
      setBusy(false);
    }
  }

  return <div className={s.reviewPage}>
    <h1 ref={pageHeading} tabIndex={-1}>Проверка работ</h1>
    {error && <p className="error" role="alert">{error}</p>}
    {!waiting && !error && <p className="muted" role="status">Загружаем работы…</p>}
    {notice && <p className={s.reviewNotice} role="status">{notice}</p>}
    {waiting?.length === 0 && <section className={`${panel} ${s.reviewEmpty}`} aria-label="Очередь проверки">
      <p>Работ на проверке нет.</p>
      <Link className="button outline" to="/assignments">К заданиям</Link>
    </section>}
    {waiting && chosen && <div className={s.reviewWorkspace}>
      <section className={`${panel} ${s.reviewQueue}`} aria-labelledby="review-queue-title">
        <header className={s.reviewQueueHead}>
          <h2 id="review-queue-title">На проверке</h2>
          <p>{count} {plural === 'one' ? 'работа' : plural === 'few' ? 'работы' : 'работ'}</p>
        </header>
        <ul className={s.reviewList} role="list">
          {waiting.map(work => {
            const key = workKey(work);
            return <li key={key}>
              <button type="button" className={s.reviewChoice} aria-pressed={chosenKey === key} disabled={busy}
                onClick={() => choose(work)}>
                <span className={s.reviewChoiceName}><strong>{work.studentName}</strong>
                  <span className={s.groupBadge}>{work.groupName}</span></span>
                <span className={s.reviewChoiceAssignment}>{work.assignmentTitle}</span>
              </button>
            </li>;
          })}
        </ul>
      </section>
      <section className={`${panel} ${s.reviewDetail}`} aria-label="Выбранная работа" aria-busy={busy}>
        <header className={s.reviewDetailHead}>
          <div className={s.reviewChoiceName}><h2 ref={detailHeading} tabIndex={-1}>{chosen.studentName}</h2>
            <span className={s.groupBadge}>{chosen.groupName}</span></div>
          <Link to={`/assignments/${chosen.assignmentId}`} className={s.reviewAssignment}>{chosen.assignmentTitle}</Link>
        </header>
        <InlineAttachments key={chosenKey} work={chosen} assignmentId={chosen.assignmentId} studentId={chosen.studentId} />
        {reviewError && <p className="error" role="alert">{reviewError}</p>}
        <div className={`${s.actions} ${s.reviewActions}`}>
          <button className="button primary" type="button" disabled={busy} onClick={() => void review('ACCEPTED')}>Принять</button>
          <button className="button outline" type="button" disabled={busy} onClick={() => void review('RETURNED')}>Вернуть на доработку</button>
        </div>
      </section>
    </div>}
  </div>;
}

export function TeacherDashboard() {
  const { data, error } = useCabinetResource<TeacherDashboardData>('/teacher/dashboard', 6000);
  const assignments = data?.assignments;
  const waiting = data?.pendingWorks;
  const groups = assignments && new Set(assignments.flatMap(assignment => assignment.groups)).size;

  return <>
    {error && <p className="error" role="alert">{error}</p>}
    {!data && !error && <p className="muted" role="status">Загружаем задания…</p>}
    <dl className={cabinet.metrics} data-cabinet-metrics>
      <CabinetMetric label="Назначено заданий">{assignments?.length ?? '—'}</CabinetMetric>
      <CabinetMetric label="Работы на проверке" valueClassName={s.highlight}>{waiting?.length ?? '—'}</CabinetMetric>
      <CabinetMetric label="Учебные группы">{groups ?? '—'}</CabinetMetric>
    </dl>
    <div className={cabinet.sections} data-cabinet-sections>
      <section className={`${panel} ${cabinet.widePanel}`} aria-labelledby="teacher-assignments-title">
        <div className={s.sectionHead}>
          <h1 id="teacher-assignments-title">Задания</h1>
          <Link className="button primary" to="/assignments/new">Новое задание</Link>
        </div>
        {assignments?.length === 0 && <p className={s.empty}>Заданий пока нет.</p>}
        <ul className={s.list}>{assignments?.map(assignment => <AssignmentRow key={assignment.id} assignment={assignment} />)}</ul>
      </section>
      <section className={panel} aria-labelledby="teacher-queue-title">
        <div className={s.sectionHead}><h2 id="teacher-queue-title">На проверке</h2></div>
        {waiting?.length === 0 && <p className={s.empty}>Работ на проверке нет.</p>}
        <ul className={s.list}>{waiting?.slice(0, 3).map(work =>
          <li className={s.workRow} key={workKey(work)}><WorkInfo work={work} /></li>)}</ul>
        {Boolean(waiting?.length) && <Link className={s.queueLink} to="/review">Все работы на проверке <span aria-hidden="true">→</span></Link>}
      </section>
    </div>
  </>;
}

export function TeacherRating() {
  const { data: groups, error } = useCabinetResource<Group[]>('/teacher/groups');
  const [selected, setSelected] = useState('');
  const groupId = selected || groups?.[0]?.id;
  return <section className={panel} aria-labelledby="teacher-rating-title">
    <div className={s.sectionHead}>
      <h1 id="teacher-rating-title">Рейтинг студентов</h1>
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
