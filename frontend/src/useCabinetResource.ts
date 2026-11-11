import { useEffect, useState } from 'react';
import { api } from './api';

export function useCabinetResource<T>(path: string, interval = 0) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;

    async function load() {
      try {
        const value = await api<T>(path, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setData(value);
        setError('');
      } catch (failure) {
        if (!controller.signal.aborted) {
          setError(failure instanceof Error ? failure.message : 'Не удалось загрузить данные.');
        }
      } finally {
        if (interval && !controller.signal.aborted) timer = window.setTimeout(load, interval);
      }
    }

    void load();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [path, interval, version]);

  return { data, error, reload: () => setVersion(current => current + 1) };
}
