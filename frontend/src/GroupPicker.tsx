import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Group, RegistrationCatalog } from './api';
import s from './layout.module.css';

export type RegistrationGroup = RegistrationCatalog['groups'][number];

export const studyForms = [
  { value: 'очная', label: 'Очная форма' },
  { value: 'очно-заочное', label: 'Очно-заочная форма' },
  { value: 'заочное', label: 'Заочная форма' },
] as const;

type GroupOption = Group & { studyForm: string | null };

type Props<T extends GroupOption> = {
  groups: T[];
  value: T | null;
  onChange: (group: T | null) => void;
  disabled: boolean;
  required?: boolean;
  placeholder?: string;
  className?: string;
  optionDetail?: (group: T) => string | undefined;
};

function searchableName(value: string) {
  return value.toLocaleLowerCase('ru-RU').replace(/[\s‐‑‒–—−-]+/g, '');
}

export function GroupPicker<T extends GroupOption>({ groups, value, onChange, disabled, required = true,
  placeholder = disabled ? 'Сначала выберите подразделение' : 'Введите часть шифра группы',
  className = '', optionDetail }: Props<T>) {
  const id = useId();
  const listId = id + '-results';
  const input = useRef<HTMLInputElement>(null);
  const resultList = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const search = searchableName(query);
  const matchingGroups = groups.filter(group => searchableName(group.name).includes(search));
  const sections = [...studyForms, { value: null, label: 'Форма обучения не указана' }].map(form => ({
    label: form.label,
    groups: matchingGroups.filter(group => group.studyForm === form.value),
  })).filter(form => form.groups.length > 0);
  const options = sections.flatMap(form => form.groups);
  const expanded = open && options.length > 0;
  const activeGroup = expanded ? options[activeIndex] : undefined;
  const activeId = activeGroup ? listId + '-' + activeGroup.id : undefined;

  useEffect(() => {
    input.current?.setCustomValidity(required && query && !value ? 'Выберите группу из подсказок.' : '');
  }, [query, required, value]);

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

  function select(group: T) {
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

  return <div className={`${s.groupPicker} ${className}`}>
    <label htmlFor={id} id={id + '-label'}>Учебная группа</label>
    <input ref={input} id={id} role="combobox" aria-autocomplete="list" aria-expanded={expanded}
      aria-controls={expanded ? listId : undefined} aria-activedescendant={activeId}
      value={value?.name ?? query} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={disabled} required={required}
      placeholder={placeholder}
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
      {sections.map(section => <div key={section.label} role="group" aria-label={section.label}>
        <div className={s.groupForm} aria-hidden="true">{section.label}</div>
        {section.groups.map(group => {
          const optionId = listId + '-' + group.id;
          const detail = optionDetail?.(group);
          return <div key={group.id} id={optionId} className={s.groupOption} role="option"
            aria-label={detail ? group.name : undefined} aria-describedby={detail ? optionId + '-detail' : undefined}
            aria-selected={group.id === (activeGroup ?? value)?.id}
            onMouseDown={event => event.preventDefault()} onClick={() => select(group)}>
            {group.name}
            {detail && <span id={optionId + '-detail'} className={s.groupOptionDetail}>{detail}</span>}
          </div>;
        })}
      </div>)}
    </div>}
    {open && !options.length && <p className={s.groupResults} role="status">Группы не найдены</p>}
  </div>;
}
