import { useState } from 'react';
import type { Group } from './api';
import s from './assignments.module.css';

export function TargetGroups({ groups, selected, onChange }: {
  groups?: Group[]; selected: number[]; onChange: (ids: number[]) => void;
}) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLocaleLowerCase('ru-RU');
  const visible = groups?.filter(group => selected.includes(group.id) || group.name.toLocaleLowerCase('ru-RU').includes(query));

  return <fieldset className={s.groupField}>
    <legend>Учебные группы <b>*</b></legend>
    <div className={s.groupPicker}>
      <input type="search" aria-label="Поиск учебной группы" placeholder="Введите часть шифра группы"
        value={search} onChange={event => setSearch(event.target.value)} disabled={!groups} />
      <div className={s.groupOptions}>
        {!groups && <span className="muted">Загрузка групп…</span>}
        {visible?.length === 0 && <span className="muted">Группы не найдены.</span>}
        {visible?.map(group => <label key={group.id} className={s.groupChoice}>
          <input type="checkbox" checked={selected.includes(group.id)}
            onChange={event => onChange(event.target.checked ? [...selected, group.id] : selected.filter(id => id !== group.id))} />
          <span>{group.name}</span>
        </label>)}
      </div>
    </div>
  </fieldset>;
}
