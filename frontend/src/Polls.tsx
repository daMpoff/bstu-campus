import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { post, type Group } from './api';
import { dateTime } from './Assignments';
import { TargetGroups } from './TargetGroups';
import { useCabinetResource } from './useCabinetResource';
import form from './assignments.module.css';
import cabinet from './cabinet.module.css';
import s from './polls.module.css';

type ChoiceType = 'SINGLE' | 'MULTIPLE';
type Poll = {
  id: number; title: string; description: string; endsAt: string; anonymous: boolean; teacherName: string;
  groups: string[]; questionCount: number; responseCount: number | null; closed: boolean; voted: boolean;
};
type Option = { id: number; text: string };
type Question = { id: number; text: string; choiceType: ChoiceType; options: Option[] };
type Respondent = { studentId: number; studentName: string; groupName: string; optionIds: number[] };
type PollData = {
  poll: Poll; questions: Question[];
  results: { options: { optionId: number; votes: number }[]; respondents: Respondent[] | null } | null;
};

const panel = `panel ${cabinet.section}`;
const failureText = (failure: unknown) => failure instanceof Error ? failure.message : 'Не удалось выполнить запрос.';
const percent = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const pollPath = (teacher: boolean) => teacher ? '/teacher/polls' : '/student/polls';

function PollInfo({ poll }: { poll: Poll }) {
  return <>
    <p className={s.description}>{poll.description}</p>
    <p className={`muted ${s.note}`}>{poll.closed ? 'Дата окончания ' : 'До '}
      <time dateTime={poll.endsAt}>{dateTime(poll.endsAt)} МСК</time>
      {poll.anonymous ? ' · Анонимный опрос' : ' · Именной опрос'}</p>
  </>;
}

export function Polls({ teacher }: { teacher: boolean }) {
  const { data, error } = useCabinetResource<Poll[]>(pollPath(teacher), 6000);
  return <>
    <div className={s.heading}><h1>Опросы</h1>
      {teacher && <Link className="button primary" to="/polls/new">Новый опрос</Link>}
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {!data && !error && <p className="muted" role="status">Загружаем опросы…</p>}
    {data?.length === 0 && <p className={panel}>{teacher ? 'Вы пока не создали опросы.' : 'Для вашей группы пока нет опросов.'}</p>}
    <div className={s.stack}>{data?.map(poll => <article key={poll.id} className={panel}>
      <div className={s.cardHeading}>
        <h2><Link to={`/polls/${poll.id}`}>{poll.title}</Link></h2>
        <span className={s.state}>{poll.closed ? 'Завершён' : poll.voted ? 'Ответ принят' : 'Открыт'}</span>
      </div>
      <PollInfo poll={poll} />
      <p className={s.meta}>{teacher ? poll.groups.join(', ') : poll.teacherName}
        {poll.responseCount !== null && ` · Участников ${poll.responseCount}`}</p>
    </article>)}</div>
  </>;
}

type DraftOption = { key: number; text: string };
type DraftQuestion = { key: number; text: string; choiceType: ChoiceType; options: DraftOption[] };
const firstQuestion: DraftQuestion = { key: 0, text: '', choiceType: 'SINGLE', options: [{ key: 1, text: '' }, { key: 2, text: '' }] };

export function NewPoll() {
  const { data: groups, error: groupError } = useCabinetResource<Group[]>('/teacher/groups');
  const [selected, setSelected] = useState<number[]>([]);
  const [questions, setQuestions] = useState<DraftQuestion[]>([firstQuestion]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nextKey = useRef(3);
  const navigate = useNavigate();

  function updateQuestion(key: number, patch: Partial<DraftQuestion>) {
    setQuestions(current => current.map(question => question.key === key ? { ...question, ...patch } : question));
  }

  function addQuestion() {
    const question: DraftQuestion = {
      key: nextKey.current++, text: '', choiceType: 'SINGLE',
      options: [{ key: nextKey.current++, text: '' }, { key: nextKey.current++, text: '' }],
    };
    setQuestions(current => [...current, question]);
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!selected.length) {
      setError('Выберите хотя бы одну учебную группу.');
      return;
    }
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const created = await post<{ id: number }>('/teacher/polls', {
        title: fields.get('title'), description: fields.get('description'), groupIds: selected,
        anonymous: fields.has('anonymous'),
        endsAt: new Date(`${fields.get('date')}T${fields.get('time')}:00+03:00`).toISOString(),
        questions: questions.map(question => ({
          text: question.text, choiceType: question.choiceType, options: question.options.map(option => option.text),
        })),
      });
      navigate(`/polls/${created.id}`);
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  return <>
    <Link className="back" to="/polls">← Опросы</Link>
    <div className={s.heading}><h1>Новый опрос</h1></div>
    <form className={`${panel} ${form.form} ${s.editor}`} onSubmit={create}>
      <label className={form.field}><span>Название</span><input name="title" required maxLength={160} /></label>
      <label className={form.field}><span>Описание</span><textarea name="description" rows={3} required maxLength={5000} /></label>
      <TargetGroups groups={groups} selected={selected} onChange={setSelected} />
      <div className={form.deadline}>
        <label>Дата окончания<input type="date" name="date" required /></label>
        <label>Время окончания (МСК)<input type="time" name="time" defaultValue="18:00" required /></label>
      </div>
      <label className={s.choice}><input type="checkbox" name="anonymous" aria-describedby="poll-anonymity" />Анонимный опрос</label>
      <p className={s.meta} id="poll-anonymity">В анонимном опросе преподаватель видит только общую статистику.</p>
      <div className={s.stack}>
        {questions.map((question, index) => <fieldset key={question.key} className={s.questionEditor}>
          <legend>Вопрос {index + 1}</legend>
          <label className={form.field}><span>Текст вопроса</span><input required maxLength={300} value={question.text}
            onChange={event => updateQuestion(question.key, { text: event.target.value })} /></label>
          <label className={form.field}><span>Тип ответа</span><select value={question.choiceType}
            onChange={event => updateQuestion(question.key, { choiceType: event.target.value === 'MULTIPLE' ? 'MULTIPLE' : 'SINGLE' })}>
            <option value="SINGLE">Один вариант</option><option value="MULTIPLE">Несколько вариантов</option>
          </select></label>
          {question.options.map((option, optionIndex) => <div className={s.optionEditor} key={option.key}>
            <label className={form.field}><span>Вариант {optionIndex + 1}</span><input required maxLength={200} value={option.text}
              onChange={event => updateQuestion(question.key, { options: question.options.map(item =>
                item.key === option.key ? { ...item, text: event.target.value } : item) })} /></label>
            {question.options.length > 2 && <button className="button outline" type="button"
              aria-label={`Удалить вариант ${optionIndex + 1}`}
              onClick={() => updateQuestion(question.key, { options: question.options.filter(item => item.key !== option.key) })}>
              Удалить
            </button>}
          </div>)}
          <div className={s.editorActions}>
            <button className="button outline" type="button" disabled={question.options.length >= 12}
              onClick={() => updateQuestion(question.key, { options: [...question.options, { key: nextKey.current++, text: '' }] })}>
              Добавить вариант
            </button>
            {questions.length > 1 && <button className="button outline" type="button" aria-label={`Удалить вопрос ${index + 1}`}
              onClick={() => setQuestions(current => current.filter(item => item.key !== question.key))}>Удалить вопрос</button>}
          </div>
        </fieldset>)}
      </div>
      <div className={s.editorActions}>
        <button className="button outline" type="button" disabled={questions.length >= 10} onClick={addQuestion}>Добавить вопрос</button>
        <button className="button primary" type="submit" disabled={busy || !groups}>{busy ? 'Создаём…' : 'Создать опрос'}</button>
      </div>
      {(error || groupError) && <p className="error" role="alert">{error || groupError}</p>}
    </form>
  </>;
}

export function PollDetail({ teacher }: { teacher: boolean }) {
  const { id } = useParams();
  if (!id || !/^\d+$/.test(id)) return <p className="error" role="alert">Опрос недоступен.</p>;
  return <PollScreen key={id} id={id} teacher={teacher} />;
}

function PollScreen({ id, teacher }: { id: string; teacher: boolean }) {
  const { data, error, reload } = useCabinetResource<PollData>(`${pollPath(teacher)}/${id}`, 6000);
  return <>
    <Link className="back" to="/polls">← Опросы</Link>
    {error && <p className="error" role="alert">{error}</p>}
    {!data && !error && <p className="muted" role="status">Загружаем опрос…</p>}
    {data && <>
      <header className={s.detailHeading}>
        <h1>{data.poll.title}</h1><PollInfo poll={data.poll} />
        <p className={s.meta}>{teacher ? data.poll.groups.join(', ') : data.poll.teacherName}</p>
      </header>
      {data.results ? <PollResults data={data} /> : data.poll.closed
        ? <p className={panel}>Опрос завершён.</p>
        : <PollBallot data={data} onVote={reload} />}
    </>}
  </>;
}

function PollBallot({ data, onVote }: { data: PollData; onVote: () => void }) {
  const [selected, setSelected] = useState<Record<number, number[]>>({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const answered = data.questions.filter(question => selected[question.id]?.length).length;

  function choose(question: Question, option: number, checked: boolean) {
    setSelected(current => ({ ...current, [question.id]: question.choiceType === 'SINGLE'
      ? [option]
      : checked ? [...(current[question.id] ?? []), option] : (current[question.id] ?? []).filter(id => id !== option) }));
  }

  async function vote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || sent) return;
    if (answered !== data.questions.length) {
      setError('Ответьте на все вопросы.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await post(`/student/polls/${data.poll.id}/vote`, {
        answers: data.questions.map(question => ({ questionId: question.id, optionIds: selected[question.id] })),
      });
      setSent(true);
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      onVote();
      setBusy(false);
    }
  }

  return <form className={`${panel} ${s.editor} ${s.stack}`} onSubmit={vote}>
    <p className={`muted ${s.note}`} role="status">{sent ? 'Ответ принят. Загружаем результаты…' : `Ответов ${answered} из ${data.questions.length}`}</p>
    {data.questions.map(question => <fieldset className={s.ballotQuestion} key={question.id} disabled={busy || sent}>
      <legend>{question.text}</legend>
      <p className={s.meta}>{question.choiceType === 'SINGLE' ? 'Выберите один вариант.' : 'Можно выбрать несколько вариантов.'}</p>
      {question.options.map(option => <label className={s.choice} key={option.id}>
        <input type={question.choiceType === 'SINGLE' ? 'radio' : 'checkbox'} name={`question-${question.id}`}
          checked={selected[question.id]?.includes(option.id) ?? false}
          onChange={event => choose(question, option.id, event.target.checked)} />
        <span>{option.text}</span>
      </label>)}
    </fieldset>)}
    {error && <p className="error" role="alert">{error}</p>}
    <div><button className="button primary" type="submit" disabled={busy || sent}>{busy ? 'Отправляем…' : 'Ответить'}</button></div>
  </form>;
}

function PollResults({ data }: { data: PollData }) {
  const totals = new Map(data.results?.options.map(option => [option.optionId, option.votes]));
  const responses = data.poll.responseCount ?? 0;
  return <section className={`${panel} ${s.stack}`} aria-labelledby="poll-results-title">
    <div><h2 id="poll-results-title">Результаты опроса</h2><p className={`muted ${s.note}`} role="status">Участников {responses}</p></div>
    {data.questions.map(question => <div className={s.resultQuestion} key={question.id}>
      <h3>{question.text}</h3>
      {question.choiceType === 'MULTIPLE' && <p className={s.meta}>Доля участников, выбравших вариант.</p>}
      <ul className={s.resultOptions}>{question.options.map(option => {
        const count = totals.get(option.id) ?? 0;
        const ratio = responses ? count * 100 / responses : 0;
        return <li key={option.id}>
          <div className={s.resultLabel}><span>{option.text}</span><span>{count} · {percent.format(ratio)}%</span></div>
          <progress aria-label={option.text} max={100} value={ratio} />
        </li>;
      })}</ul>
    </div>)}
    {data.results?.respondents && <div className={s.resultQuestion}>
      <h3>Ответы по участникам</h3>
      {data.results.respondents.length === 0 && <p className="muted">Ответов пока нет.</p>}
      {data.results.respondents.map(person => <details key={person.studentId} className={s.respondent}>
        <summary>{person.studentName} · {person.groupName}</summary>
        <dl>{data.questions.map(question => <div key={question.id}>
          <dt>{question.text}</dt>
          <dd>{question.options.filter(option => person.optionIds.includes(option.id)).map(option => option.text).join(', ')}</dd>
        </div>)}</dl>
      </details>)}
    </div>}
  </section>;
}
