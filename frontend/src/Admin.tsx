import { useState, type FormEvent } from 'react';
import { api } from './api';
import { useCabinetResource } from './useCabinetResource';
import s from './operations.module.css';

type CatalogKind = 'faculties' | 'departments' | 'groups';
type Entry = { id: number; name: string; code?: string; facultyId?: number | null; studyForm?: string | null };
type Catalog = Record<CatalogKind, Entry[]>;
type Settings = {
  penaltyAmount: number; penaltyIntervalSeconds: number; semesterAmount: number;
  semesterStartDays: string; activityMonthlyLimit: number;
};

const catalogNames = { faculties: 'Факультеты и институты', departments: 'Кафедры', groups: 'Учебные группы' };
const studyForms = ['очная', 'очно-заочное', 'заочное'];
const importTypes = {
  groups: {
    label: 'Учебные группы',
    sample: 'name;faculty_code;study_form\r\nИВТ-26;fit;очная\r\n',
    note: 'Укажите название группы, код подразделения из справочника и форму обучения.',
  },
  students: {
    label: 'Студенты',
    sample: 'email;full_name;group_name;password\r\nstudent@example.org;Иван Петров;ИВТ-26;ChangeMe2026!\r\n',
    note: 'Укажите email, ФИО, точное название группы и пароль. Принадлежность к группе подтверждает администратор, email студент подтверждает по ссылке из письма.',
  },
};

function useAction() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function run(action: () => Promise<string>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setNotice(await action());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Не удалось выполнить операцию.');
    } finally {
      setBusy(false);
    }
  }

  return { run, busy, notice, error };
}

function Feedback({ notice, error }: { notice: string; error: string }) {
  return <>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className={s.notice} role="status">{notice}</p>}
  </>;
}

const json = (method: 'POST' | 'PUT', payload: unknown) => ({
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
});

function CatalogManager() {
  const { data, error, reload } = useCabinetResource<Catalog>('/admin/catalog');
  const action = useAction();
  const [kind, setKind] = useState<CatalogKind>('faculties');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(20);
  const [editor, setEditor] = useState<Entry | 'new'>();
  const [deleteId, setDeleteId] = useState<number>();
  const path = `/admin/catalog/${kind}`;
  const needle = search.trim().toLocaleLowerCase('ru');
  const entries = data?.[kind].filter(entry => `${entry.name} ${entry.code ?? ''}`.toLocaleLowerCase('ru').includes(needle));
  const faculties = data?.faculties ?? [];

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const editing = editor && editor !== 'new' ? editor : undefined;
    void action.run(async () => {
      await api(editing ? `${path}/${editing.id}` : path, json(editing ? 'PUT' : 'POST', {
        name: fields.get('name'), code: fields.get('code'),
        facultyId: kind === 'faculties' ? null : Number(fields.get('facultyId')), studyForm: fields.get('studyForm'),
      }));
      setEditor(undefined);
      reload();
      return editing ? 'Изменения сохранены.' : 'Запись добавлена.';
    });
  }

  function remove(entry: Entry) {
    void action.run(async () => {
      await api(`${path}/${entry.id}`, { method: 'DELETE' });
      setDeleteId(undefined);
      reload();
      return 'Запись удалена.';
    });
  }

  const selected = editor === 'new' ? undefined : editor;
  return <section className={`panel ${s.panel}`} aria-label="Справочники">
    <div className={s.controls}>
      <label>Справочник<select value={kind} disabled={action.busy} onChange={event => {
        setKind(event.target.value as CatalogKind); setSearch(''); setLimit(20); setEditor(undefined); setDeleteId(undefined);
      }}>{Object.entries(catalogNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
      <label>Поиск по справочнику<input type="search" value={search} onChange={event => { setSearch(event.target.value); setLimit(20); }} /></label>
      <button type="button" className="button primary" disabled={!data || action.busy} onClick={() => { setEditor('new'); setDeleteId(undefined); }}>Добавить запись</button>
    </div>
    <Feedback notice={action.notice} error={action.error || error} />
    {editor && <form className={s.editor} key={selected?.id ?? 'new'} onSubmit={save} aria-label="Редактирование записи">
      <h2>{selected ? 'Редактирование записи' : 'Новая запись'}</h2>
      <div className={s.fields}>
        <label>Название<input name="name" defaultValue={selected?.name} required minLength={2} maxLength={160} /></label>
        {kind !== 'groups' && <label>Код<input name="code" defaultValue={selected?.code} readOnly={!!selected}
          required pattern="[a-zA-Z0-9][a-zA-Z0-9_\u002d]{0,39}" maxLength={40} /></label>}
        {kind !== 'faculties' && <label>Факультет или институт<select name="facultyId" defaultValue={selected?.facultyId ?? ''} required>
          <option value="" disabled>Выберите подразделение</option>
          {faculties.map(faculty => <option key={faculty.id} value={faculty.id}>{faculty.name}</option>)}
        </select></label>}
        {kind === 'groups' && <label>Форма обучения<select name="studyForm" defaultValue={selected?.studyForm ?? ''} required>
          <option value="" disabled>Выберите форму</option>
          {studyForms.map(value => <option key={value} value={value}>{value}</option>)}
        </select></label>}
      </div>
      <div className={s.actions}>
        <button className="button primary" disabled={action.busy} type="submit">{action.busy ? 'Сохраняем…' : 'Сохранить'}</button>
        <button className="button outline" disabled={action.busy} type="button" onClick={() => setEditor(undefined)}>Отмена</button>
      </div>
    </form>}
    {!data && !error && <p className="muted" role="status">Загружаем справочник…</p>}
    {entries?.length === 0 && <p className="muted">Записи не найдены.</p>}
    {!!entries?.length && <ul className={s.rows}>
      {entries.slice(0, limit).map(entry => <li className={s.row} key={entry.id}>
        <div className={s.rowText}><strong>{entry.name}</strong>
          {(entry.code || entry.facultyId || entry.studyForm) && <p className="muted">
            {[entry.code, faculties.find(faculty => faculty.id === entry.facultyId)?.name, entry.studyForm].filter(Boolean).join(' · ')}
          </p>}
        </div>
        {deleteId === entry.id ? <div className={s.actions}>
          <button className="button outline" type="button" disabled={action.busy} onClick={() => remove(entry)}>Подтвердить удаление</button>
          <button className="button outline" type="button" disabled={action.busy} onClick={() => setDeleteId(undefined)}>Отмена</button>
        </div> : <div className={s.actions}>
          <button className="button outline" type="button" disabled={action.busy} aria-label={`Изменить ${entry.name}`}
            onClick={() => setEditor(entry)}>Изменить</button>
          <button className="button outline" type="button" disabled={action.busy} aria-label={`Удалить ${entry.name}`}
            onClick={() => { setDeleteId(entry.id); setEditor(undefined); }}>Удалить</button>
        </div>}
      </li>)}
    </ul>}
    {entries && entries.length > limit && <button className="button outline" type="button" onClick={() => setLimit(count => count + 20)}>Показать ещё</button>}
  </section>;
}

function ImportForm() {
  const [kind, setKind] = useState<keyof typeof importTypes>('groups');
  const action = useAction();
  const type = importTypes[kind];
  const example = `data:text/csv;charset=utf-8,${encodeURIComponent('\ufeff' + type.sample)}`;

  function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData(form);
    void action.run(async () => {
      const result = await api<{ imported: number }>(`/admin/import/${kind}`, { method: 'POST', body });
      form.reset();
      return `Импортировано записей: ${result.imported}.`;
    });
  }

  return <form className={`panel ${s.panel}`} onSubmit={upload} aria-label="Импорт из CSV">
    <h2>Импорт из CSV</h2>
    <label>Что импортировать<select value={kind} disabled={action.busy} onChange={event => setKind(event.target.value as typeof kind)}>
      {Object.entries(importTypes).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
    </select></label>
    <p className="muted">{type.note} Один файл UTF-8 до 512 КБ, до 500 строк.</p>
    <a className={s.template} href={example} download={`${kind}.csv`}>Скачать шаблон CSV</a>
    <label>Файл CSV<input key={kind} type="file" name="file" accept=".csv,text/csv" required /></label>
    <Feedback notice={action.notice} error={action.error} />
    <button className="button primary" type="submit" disabled={action.busy}>{action.busy ? 'Импортируем…' : 'Импортировать'}</button>
  </form>;
}

function SettingsForm() {
  const { data, error, reload } = useCabinetResource<Settings>('/admin/settings');
  const action = useAction();
  const [spring, autumn] = data?.semesterStartDays.split(',') ?? [];

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void action.run(async () => {
      await api('/admin/settings', json('PUT', {
        penaltyAmount: Number(fields.get('penaltyAmount')), penaltyIntervalSeconds: Number(fields.get('penaltyIntervalSeconds')),
        semesterAmount: Number(fields.get('semesterAmount')), semesterStartDays: `${fields.get('spring')},${fields.get('autumn')}`,
        activityMonthlyLimit: Number(fields.get('activityMonthlyLimit')),
      }));
      reload();
      return 'Настройки сохранены.';
    });
  }

  if (!data) return error ? <p className="error" role="alert">{error}</p> : <p role="status">Загружаем настройки…</p>;
  return <form className={`panel ${s.panel}`} onSubmit={save} aria-label="Настройки рейтинга и бюджета">
    <div className={s.editor}>
      <h2>Списание АР</h2>
      <div className={s.fields}>
        <label>Баллов за интервал<input type="number" name="penaltyAmount" defaultValue={data.penaltyAmount} min={1} max={1000} required /></label>
        <label>Интервал в секундах<input type="number" name="penaltyIntervalSeconds" defaultValue={data.penaltyIntervalSeconds} min={1} max={86400} required /></label>
      </div>
    </div>
    <div className={s.editor}>
      <h2>Начало семестров</h2>
      <div className={s.fields}>
        <label>Первое полугодие (ММ-ДД)<input name="spring" defaultValue={spring} required pattern="[0-9]{2}-[0-9]{2}" /></label>
        <label>Второе полугодие (ММ-ДД)<input name="autumn" defaultValue={autumn} required pattern="[0-9]{2}-[0-9]{2}" /></label>
        <label>Пополнение АР<input type="number" name="semesterAmount" defaultValue={data.semesterAmount} min={0} max={1000} required /></label>
      </div>
    </div>
    <div className={s.editor}>
      <h2>Бюджет активностей</h2>
      <label>Лимит баллов преподавателя на группу в месяц<input type="number" name="activityMonthlyLimit"
        defaultValue={data.activityMonthlyLimit} min={0} max={2147483647} required /></label>
    </div>
    <Feedback notice={action.notice} error={action.error || error} />
    <button type="submit" className="button primary" disabled={action.busy}>{action.busy ? 'Сохраняем…' : 'Сохранить настройки'}</button>
  </form>;
}

export function Admin() {
  const [tab, setTab] = useState<'catalog' | 'import' | 'settings'>('catalog');
  return <div className={s.page}>
    <h1>Администрирование</h1>
    <div className={s.switcher} aria-label="Разделы администрирования" role="group">
      <button type="button" className="button outline" aria-pressed={tab === 'catalog'} onClick={() => setTab('catalog')}>Справочники</button>
      <button type="button" className="button outline" aria-pressed={tab === 'import'} onClick={() => setTab('import')}>Импорт CSV</button>
      <button type="button" className="button outline" aria-pressed={tab === 'settings'} onClick={() => setTab('settings')}>Настройки</button>
    </div>
    {tab === 'catalog' ? <CatalogManager /> : tab === 'import' ? <ImportForm /> : <SettingsForm />}
  </div>;
}
