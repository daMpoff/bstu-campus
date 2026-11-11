import { useEffect, useId, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type Account } from './api';
import { AssignmentDraft, type AssignmentDraftText } from './AssignmentDraft';
import { getStudentAssistantSummary, studentAssistantPeriod, type StudentAssistantResult } from './studentAssistant';
import { StudentAssistantSummary } from './StudentAssistantSummary';
import s from './assistant.module.css';

type HelpSource = { title: string; path: string };
type HelpAnswer = { answer: string; sources: HelpSource[]; mode: 'MODEL' | 'GUIDE' };
type Message = { text: string; sender: 'user' | 'assistant'; sources?: HelpSource[]; action?: string }
  | { summary: StudentAssistantResult };
type Recipient = { id: number; fullName: string; context: string | null };
type AssignmentChoice = { id: number; title: string; deadline: string };
type NewAssignmentDraft = Omit<AssignmentChoice, 'id'> & { description: string; penaltyLimit: string; requestId: string };
type Receipt = { assignmentId: number; path: string };
type Pending = 'ask' | 'search' | 'assignments' | 'send';

const fileLimit = 10 * 1024 * 1024;
const dateFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Moscow' });
const shortcuts = {
  STUDENT: ['Мои дедлайны и рейтинг', 'Как сдать работу?', 'Как списывается АР?'],
  TEACHER: ['Как проверить работу?', 'Как начислить баллы за активность?'],
  ADMIN: ['Как импортировать студентов?', 'Где изменить настройки АР?'],
};

function transferIntent(text: string) {
  const command = /^(?:(?:мне|пожалуйста|можешь|можете|нужно|надо|помоги(?:те)?)[,\s]+)*(отправь(?:те)?|отправить|передай(?:те)?|передать|скинь(?:те)?|скинуть|сдай(?:те)?|сдать|назначь(?:те)?|назначить)(?=\s|$)/iu;
  const match = text.match(command);
  if (!match) return null;
  const query = text.slice(match[0].length)
    .trim().replace(/^(?:(?:файл|вложение|работу|задание|преподавателю|студенту|студентке|получателю|для|пожалуйста)[,\s]+)*/iu, '')
    .replace(/^(?:файл|вложение|работу|задание|преподавателю|студенту|студентке)$/iu, '')
    .replace(/^[«"„]+|[»"“!?.]+$/gu, '').trim();
  return { query, newAssignment: /^назнач/iu.test(match[1]) };
}

function requestId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

function Icon({ name }: { name: 'chat' | 'close' | 'attach' | 'send' }) {
  const paths = {
    chat: 'M20 11.5a7.5 7.5 0 0 1-7.5 7.5H8l-4 2v-5.6a7.5 7.5 0 0 1 7.5-11.4H13a7 7 0 0 1 7 7.5ZM8 11h.1m3.9 0h.1m3.9 0h.1',
    close: 'm6 6 12 12M18 6 6 18',
    attach: 'm8 13 6.5-6.5a3 3 0 0 1 4.2 4.2l-8 8a4.5 4.5 0 0 1-6.4-6.4L12 4.6',
    send: 'm4 4 16 8-16 8 2.5-8L4 4Zm2.5 8H20',
  };
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

function AssignmentDraftForm({ disabled, initial, onReview }: {
  disabled: boolean; initial?: NewAssignmentDraft; onReview: (draft: NewAssignmentDraft) => void;
}) {
  const [error, setError] = useState('');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const titleInput = useRef<HTMLInputElement>(null);
  const descriptionInput = useRef<HTMLTextAreaElement>(null);
  const descriptionLabelId = useId();
  const initialMoscowTime = initial ? new Date(Date.parse(initial.deadline) + 3 * 60 * 60 * 1000).toISOString() : '';

  function applyDraft(draft: AssignmentDraftText) {
    setTitle(draft.title);
    setDescription(draft.description);
    setError('');
    titleInput.current?.focus();
  }

  function applyDraftIfEmpty(draft: AssignmentDraftText) {
    if (!titleInput.current || !descriptionInput.current || titleInput.current.value.trim() || descriptionInput.current.value.trim()) {
      return false;
    }
    applyDraft(draft);
    return true;
  }

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const title = String(fields.get('title')).trim();
    const description = String(fields.get('description')).trim();
    if (!title || !description) {
      setError('Заполните название и описание задания.');
      return;
    }
    onReview({
      title, description,
      deadline: new Date(`${fields.get('date')}T${fields.get('time')}:00+03:00`).toISOString(),
      penaltyLimit: String(fields.get('limit')), requestId: requestId(),
    });
  }

  return <form className={s.assignmentForm} onSubmit={review}>
    <AssignmentDraft disabled={disabled} onApply={applyDraft} onApplyIfEmpty={applyDraftIfEmpty} />
    <label>Название задания<input ref={titleInput} name="title" value={title} onChange={event => setTitle(event.target.value)}
      required maxLength={160} disabled={disabled} /></label>
    <label><span id={descriptionLabelId}>Описание</span>
      <textarea ref={descriptionInput} name="description" value={description} onChange={event => setDescription(event.target.value)}
        aria-labelledby={descriptionLabelId} required maxLength={5000} rows={3} disabled={disabled} />
    </label>
    <div className={s.dateFields}>
      <label>Дата сдачи<input type="date" name="date" defaultValue={initialMoscowTime.slice(0, 10)} required disabled={disabled} /></label>
      <label>Время (МСК)<input type="time" name="time" defaultValue={initialMoscowTime.slice(11, 16) || '23:59'} required disabled={disabled} /></label>
    </div>
    <label>Лимит списания, АР<input type="number" name="limit" min={0} max={1000} defaultValue={initial?.penaltyLimit ?? 100} required disabled={disabled} /></label>
    {error && <p className="error" role="alert">{error}</p>}
    <button type="submit" className="button outline" disabled={disabled}>Проверить назначение</button>
  </form>;
}

export function CampusAssistant({ user }: { user: Account }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const activity = useRef<AbortController | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const transferPanel = useRef<HTMLElement>(null);
  const latestSummary = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const messageId = useId();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState<Pending>();
  const [error, setError] = useState('');
  const [transfer, setTransfer] = useState(false);
  const [file, setFile] = useState<File>();
  const [query, setQuery] = useState('');
  const [recipients, setRecipients] = useState<Recipient[]>();
  const [recipient, setRecipient] = useState<Recipient>();
  const [choices, setChoices] = useState<AssignmentChoice[]>();
  const [assignment, setAssignment] = useState<AssignmentChoice>();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<NewAssignmentDraft>();
  const [reviewingDraft, setReviewingDraft] = useState(false);
  const [newAssignmentIntent, setNewAssignmentIntent] = useState(false);
  const [dragging, setDragging] = useState(false);
  const canTransfer = user.role !== 'ADMIN' && (user.role !== 'STUDENT' || user.groupVerified);

  useEffect(() => () => activity.current?.abort(), []);
  useEffect(() => {
    const history = scroll.current;
    if (!history || !open) return;
    const panel = transferPanel.current;
    if (panel && creating && !reviewingDraft) {
      history.scrollTop += panel.getBoundingClientRect().top - history.getBoundingClientRect().top - 8;
    } else if (latestSummary.current && !transfer) {
      history.scrollTop += latestSummary.current.getBoundingClientRect().top - history.getBoundingClientRect().top - 8;
    } else {
      history.scrollTop = history.scrollHeight;
    }
  }, [messages, open, transfer, recipients, choices, recipient, assignment, creating, reviewingDraft, error]);

  function show() {
    if (!dialog.current?.open) {
      dialog.current?.showModal();
      setOpen(true);
      composer.current?.focus();
    }
  }

  function close() {
    dialog.current?.close();
  }

  function resetChoices() {
    setChoices(undefined);
    setAssignment(undefined);
    setCreating(false);
    setDraft(undefined);
    setReviewingDraft(false);
  }

  function resetTransfer() {
    setTransfer(false);
    setFile(undefined);
    setQuery('');
    setRecipients(undefined);
    setRecipient(undefined);
    setNewAssignmentIntent(false);
    setError('');
    resetChoices();
  }

  async function request<T>(
    kind: Pending, task: (signal: AbortSignal) => Promise<T>, onSuccess: (result: T) => void,
  ) {
    if (activity.current) return;
    const controller = new AbortController();
    activity.current = controller;
    setPending(kind);
    setError('');
    try {
      const result = await task(controller.signal);
      if (!controller.signal.aborted) onSuccess(result);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Не удалось выполнить запрос.');
    } finally {
      if (!controller.signal.aborted) {
        activity.current = null;
        setPending(undefined);
      }
    }
  }

  function searchPeople(value: string) {
    const name = value.trim().slice(0, 120);
    setQuery(name);
    setRecipients(undefined);
    if (name.length < 2) return;
    void request('search', signal => api<Recipient[]>(`/assistant/recipients?q=${encodeURIComponent(name)}`, { signal }), setRecipients);
  }

  function findAssignments(person: Recipient) {
    setRecipient(person);
    resetChoices();
    if (newAssignmentIntent) {
      setCreating(true);
      return;
    }
    void request('assignments', signal => api<AssignmentChoice[]>(`/assistant/recipients/${person.id}/assignments`, { signal }), setChoices);
  }

  function selectFile(next: File | undefined) {
    if (!next || !canTransfer || activity.current) return;
    setTransfer(true);
    if (!next.size || next.size > fileLimit) {
      setError(!next.size ? 'Файл пустой. Выберите другой.' : 'Размер файла должен быть не больше 10 МБ.');
      removeFile();
      return;
    }
    setFile(next);
    setReviewingDraft(false);
    setError('');
  }

  function removeFile() {
    setFile(undefined);
    setReviewingDraft(false);
  }

  function dragOver(event: DragEvent) {
    if (!canTransfer || !event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    if (!activity.current) setDragging(true);
  }

  function drop(event: DragEvent) {
    if (!canTransfer || !event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    setDragging(false);
    show();
    if (activity.current) return;
    if (event.dataTransfer.files.length > 1) {
      setTransfer(true);
      removeFile();
      setError('Прикрепите один файл за раз.');
      return;
    }
    selectFile(event.dataTransfer.files[0]);
  }

  function leaveDrag(event: DragEvent) {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false);
  }

  function ask(value: string) {
    const question = value.trim();
    if (!question || activity.current) return;
    setMessage('');
    setMessages(current => [...current.slice(-11), { text: question, sender: 'user' }]);
    const intent = transferIntent(question);
    if (intent && !canTransfer) {
      const text = user.role === 'STUDENT' ? 'Отправка доступна после подтверждения учебной группы.'
        : 'Отправка через помощника доступна студентам и преподавателям.';
      setMessages(current => [...current, { text, sender: 'assistant' }]);
      return;
    }
    if (intent) {
      setTransfer(true);
      setRecipient(undefined);
      setNewAssignmentIntent(user.role === 'TEACHER' && intent.newAssignment);
      resetChoices();
      setError('');
      searchPeople(intent.query);
      return;
    }
    if (transfer && !recipient && /^[\p{L}][\p{L}\p{M}.'’\s-]+$/u.test(question) && question.split(/\s+/).length <= 4) {
      searchPeople(question);
      return;
    }
    const period = user.role === 'STUDENT' ? studentAssistantPeriod(question) : null;
    if (period) {
      void request('ask', signal => getStudentAssistantSummary(period, signal), summary => {
        setMessages(current => [...current, { summary }]);
      });
      return;
    }
    void request('ask', signal => api<HelpAnswer>('/assistant/ask', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }), signal,
    }), response => setMessages(current => [...current, {
      text: response.answer, sender: 'assistant', sources: response.sources,
    }]));
  }

  function send() {
    if (!recipient || (!confirmedDraft && (!assignment || !file))) return;
    const data = new FormData();
    data.append('recipientId', String(recipient.id));
    if (file) data.append('file', file);
    if (confirmedDraft) {
      data.append('requestId', confirmedDraft.requestId);
      data.append('title', confirmedDraft.title);
      data.append('description', confirmedDraft.description);
      data.append('deadline', confirmedDraft.deadline);
      data.append('penaltyLimit', confirmedDraft.penaltyLimit);
    } else if (assignment) {
      data.append('assignmentId', String(assignment.id));
    }
    void request('send', signal => api<Receipt>(confirmedDraft ? '/assistant/assignments' : '/assistant/transfers',
      { method: 'POST', body: data, signal }), receipt => {
      const text = confirmedDraft ? `Задание «${confirmedDraft.title}» назначено для ${recipient.fullName}.`
        : user.role === 'STUDENT' ? `Работа «${assignment?.title}» сдана на проверку. Получатель — ${recipient.fullName}.`
          : `Файл прикреплён к заданию «${assignment?.title}» для получателя ${recipient.fullName}.`;
      setMessages(current => [...current.slice(-11), { text, sender: 'assistant', action: receipt.path }]);
      resetTransfer();
    });
  }

  const confirmedDraft = reviewingDraft ? draft : undefined;
  const selected = confirmedDraft ?? assignment;
  const canConfirm = Boolean(recipient && selected && (confirmedDraft || file));
  return <>
    <button type="button" className={`${s.launcher}${dragging && !open ? ` ${s.dragging}` : ''}`}
      aria-label="Помощник" aria-haspopup="dialog" aria-expanded={open} onClick={show}
      onDragOver={dragOver} onDragLeave={leaveDrag} onDrop={drop}>
      <Icon name="chat" /><span>Помощник</span>
    </button>
    <dialog ref={dialog} className={`${s.dialog}${dragging ? ` ${s.dragging}` : ''}`}
      aria-labelledby={titleId} onClose={() => { if (!dialog.current?.open) { setOpen(false); setDragging(false); } }}
      onDragOver={dragOver} onDragLeave={leaveDrag} onDrop={drop}>
      <header className={s.header}>
        <div><h2 id={titleId}>Помощник</h2><p>Университетская среда</p></div>
        <button type="button" className={s.iconButton} onClick={close} aria-label="Закрыть помощника"><Icon name="close" /></button>
      </header>
      <div ref={scroll} className={s.scroll}>
        <div className={s.messages} role="log" aria-label="Диалог с помощником">
          {!messages.length && !transfer && <div className={s.answer}>
            <p>{canTransfer ? 'Спросите о системе или перетащите сюда файл для задания.' : 'Спросите, как пользоваться университетской средой.'}</p>
            <div className={s.shortcuts}>{shortcuts[user.role].map(question =>
              <button type="button" key={question} onClick={() => ask(question)} disabled={Boolean(pending)}>{question}</button>)}</div>
          </div>}
          {messages.map((entry, index) => 'summary' in entry ? <div key={index} className={`${s.answer} ${s.summaryAnswer}`}
            ref={index === messages.length - 1 ? latestSummary : undefined}>
            <StudentAssistantSummary data={entry.summary} onNavigate={close} />
          </div> : <div key={index} className={entry.sender === 'user' ? s.user : s.answer}>
            <p>{entry.text}</p>
            {Boolean(entry.sources?.length) && <ul className={s.sources}>{entry.sources?.map(source =>
              <li key={`${source.path}:${source.title}`}><Link to={source.path} onClick={close}>{source.title}</Link></li>)}</ul>}
            {entry.action && <Link className={s.result} to={entry.action} onClick={close}>Открыть задание →</Link>}
          </div>)}
        </div>
        {pending === 'ask' && <p role="status" className={s.status}>Готовлю ответ…</p>}
        {transfer && <section ref={transferPanel} className={s.transfer} aria-label="Отправка через помощника">
          <div className={s.transferHeader}>
            <h3>Отправка через помощника</h3>
            <button type="button" className={s.textButton} onClick={resetTransfer} disabled={Boolean(pending)}>Отменить</button>
          </div>
          {file && <div className={s.file}>
            <Icon name="attach" /><span>{file.name}</span>
            <button type="button" className={s.iconButton} aria-label="Удалить файл" onClick={removeFile}
              disabled={Boolean(pending)}><Icon name="close" /></button>
          </div>}
          {!recipient && <>
            <form className={s.search} onSubmit={event => { event.preventDefault(); searchPeople(query); }}>
              <label>Кому отправить?
                <input value={query} maxLength={120} minLength={2} required placeholder={user.role === 'STUDENT' ? 'ФИО преподавателя' : 'ФИО студента'}
                  onChange={event => { setQuery(event.target.value); setRecipients(undefined); }} disabled={Boolean(pending)} />
              </label>
              <button type="submit" className="button outline" disabled={Boolean(pending) || query.trim().length < 2}>Найти</button>
            </form>
            {pending === 'search' && <p role="status" className={s.status}>Ищу получателей…</p>}
            {recipients?.length === 0 && <p role="status" className={s.status}>Получатель не найден среди доступных. Проверьте ФИО или попробуйте ввести фамилию.</p>}
            {Boolean(recipients?.length) && <ul className={s.choices} aria-label="Доступные получатели">
              {recipients?.map(person => <li key={person.id}><button type="button" onClick={() => findAssignments(person)} disabled={Boolean(pending)}>
                <strong>{person.fullName}</strong>{person.context && <span>{person.context}</span>}
              </button></li>)}
            </ul>}
          </>}
          {recipient && <>
            <div className={s.selected}><span>Получатель</span><strong>{recipient.fullName}</strong>
              <button type="button" className={s.textButton} aria-label="Изменить получателя"
                onClick={() => { setRecipient(undefined); setError(''); resetChoices(); }}
                disabled={Boolean(pending)}>Изменить</button>
            </div>
            {pending === 'assignments' && <p role="status" className={s.status}>Ищу задания…</p>}
            {!pending && error && choices === undefined && !creating && <button type="button" className="button outline"
              onClick={() => findAssignments(recipient)}>Повторить поиск заданий</button>}
            {!selected && !creating && choices !== undefined && <>
              <h4>К какому заданию прикрепить файл?</h4>
              {!choices.length && <p role="status" className={s.status}>У получателя нет подходящих заданий.</p>}
              <ul className={s.choices} aria-label="Доступные задания">
                {choices.map(item => <li key={item.id}><button type="button" onClick={() => setAssignment(item)} disabled={Boolean(pending)}>
                  <strong>{item.title}</strong><span>{dateFormat.format(new Date(item.deadline))} МСК</span>
                </button></li>)}
              </ul>
              {user.role === 'TEACHER' && <button type="button" className="button outline" onClick={() => setCreating(true)}
                disabled={Boolean(pending)}>Новое задание</button>}
            </>}
            {creating && !reviewingDraft && <AssignmentDraftForm key={recipient.id} disabled={Boolean(pending)} initial={draft}
              onReview={value => { setDraft(value); setReviewingDraft(true); }} />}
            {selected && <div className={s.confirm}>
              <div className={s.selected}><span>Задание</span><strong>{selected.title}</strong>
                <button type="button" className={s.textButton} aria-label="Изменить задание"
                  onClick={() => { setAssignment(undefined); setReviewingDraft(false); }}
                  disabled={Boolean(pending)}>Изменить</button>
              </div>
              <p className={s.status}>Срок сдачи {dateFormat.format(new Date(selected.deadline))} МСК
                {confirmedDraft && ` · лимит ${confirmedDraft.penaltyLimit} АР`}</p>
              {!confirmedDraft && !file && <p className={s.status}>Прикрепите файл, чтобы продолжить.</p>}
              {canConfirm && <>
                <p className={s.status}>От имени {user.fullName}. {confirmedDraft ? 'Задание появится у получателя в кабинете.'
                  : user.role === 'STUDENT' ? 'Работа попадёт в очередь на проверку.' : 'Получатель увидит материал внутри задания.'}</p>
                <button type="button" className="button primary" onClick={send} disabled={Boolean(pending)}>
                  {pending === 'send' ? 'Отправляю…' : confirmedDraft ? 'Подтвердить и назначить' : 'Подтвердить и отправить'}
                </button>
              </>}
            </div>}
          </>}
        </section>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      <form className={s.composer} onSubmit={event => { event.preventDefault(); ask(message); }}>
        <label className={s.visuallyHidden} htmlFor={messageId}>Сообщение помощнику</label>
        <textarea ref={composer} id={messageId} rows={2} maxLength={2000} value={message} disabled={Boolean(pending)}
          placeholder={canTransfer ? 'Спросите или напишите «отправить файл ФИО»' : 'Напишите вопрос о системе'}
          onChange={event => setMessage(event.target.value)} onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              ask(message);
            }
          }} />
        <div className={s.composerActions}>
          {canTransfer && <>
            <input ref={picker} type="file" hidden className={s.fileInput} onChange={event => {
              selectFile(event.currentTarget.files?.[0]);
              event.currentTarget.value = '';
            }} />
            <button type="button" className={s.iconButton} onClick={() => picker.current?.click()} disabled={Boolean(pending)}
              aria-label="Прикрепить файл" title="Прикрепить файл"><Icon name="attach" /></button>
            {user.role === 'TEACHER' && !transfer && <button type="button" className={s.textButton}
              disabled={Boolean(pending)} onClick={() => { setNewAssignmentIntent(true); setTransfer(true); }}>Назначить задание</button>}
          </>}
          <button type="submit" className={`button primary ${s.sendMessage}`} disabled={Boolean(pending) || !message.trim()}>
            <Icon name="send" /> Отправить
          </button>
        </div>
      </form>
    </dialog>
  </>;
}
