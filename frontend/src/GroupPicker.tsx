import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { RegistrationCatalog } from './api';
import s from './layout.module.css';

export type RegistrationGroup = RegistrationCatalog['groups'][number];

const studyForms = [
  { value: 'очная', label: 'Очная форма' },
  { value: 'очно-заочное', label: 'Очно-заочная форма' },
  { value: 'заочное', label: 'Заочная форма' },
] as const;

type Props = {
  groups: RegistrationGroup[];
  value: RegistrationGroup | null;
  onChange: (group: RegistrationGroup | null) => void;
  disabled: boolean;
};

export function GroupPicker({ groups, value, onChange, disabled }: Props) {
  const id = useId();
  const listId = id + '-results';
  const input = useRef<HTMLInputElement>(null);
  const resultList = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const search = query.trim().toLocaleLowerCase('ru-RU');
  const matchingGroups = groups.filter(group => group.name.toLocaleLowerCase('ru-RU').includes(search));
  const sections = studyForms.map(form => ({
    ...form,
    groups: matchingGroups.filter(group => group.studyForm === form.value),
  })).filter(form => form.groups.length > 0);
  const options = sections.flatMap(form => form.groups);
  const expanded = open && options.length > 0;
  const activeGroup = expanded ? options[activeIndex] : undefined;
  const activeId = activeGroup ? listId + '-' + activeGroup.id : undefined;

  useEffect(() => {
    input.current?.setCustomValidity(query && !value ? 'Выберите группу из подсказок.' : '');
  }, [query, value]);

  useEffect(() => {
    if (expanded) resultList.current?.scrollIntoView({ block: 'nearest' });
  }, [expanded]);

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  function close() {
    setOpen(false);
    setActiveIndex(-1);
  }

  function select(group: RegistrationGroup) {
    onChange(group);
    setQuery('');
    close();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!options.length) return;
      event.preventDefault();
      setOpen(true);
      const nextIndex = event.key === 'ArrowDown'
        ? Math.min(activeIndex + 1, options.length - 1)
        : activeIndex < 0 ? options.length - 1 : Math.max(activeIndex - 1, 0);
      setActiveIndex(nextIndex);
    } else if (event.key === 'Enter' && expanded) {
      const choice = activeGroup ?? (options.length === 1 && !value ? options[0] : undefined);
      if (choice) {
        event.preventDefault();
        select(choice);
      }
    }
  }

  return <div className={s.groupPicker}>
    <label htmlFor={id} id={id + '-label'}>Учебная группа</label>
    <input ref={input} id={id} role="combobox" aria-autocomplete="list" aria-expanded={expanded}
      aria-controls={expanded ? listId : undefined} aria-activedescendant={activeId}
      value={value?.name ?? query} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={disabled} required
      placeholder={disabled ? 'Сначала выберите подразделение' : 'Введите часть шифра группы'}
      onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onBlur={close}
      onChange={event => {
        onChange(null);
        setQuery(event.target.value);
        setOpen(true);
        setActiveIndex(-1);
      }}
      onKeyDown={handleKeyDown}
    />
    {expanded && <div ref={resultList} id={listId} className={s.groupResults} role="listbox"
      aria-labelledby={id + '-label'} tabIndex={-1}>
      {sections.map(section => <div key={section.value} role="group" aria-label={section.label}>
        <div className={s.groupForm} aria-hidden="true">{section.label}</div>
        {section.groups.map(group => <div key={group.id} id={listId + '-' + group.id}
          className={s.groupOption} role="option"
          aria-selected={group.id === (activeGroup ?? value)?.id}
          onMouseDown={event => event.preventDefault()} onClick={() => select(group)}>
          {group.name}
        </div>)}
      </div>)}
    </div>}
    {open && !options.length && <p className={s.groupResults} role="status">Группы не найдены</p>}
  </div>;
}
