import { useCallback, useEffect, useRef, useState } from 'react';
import type { Settings } from '../settings/schema';
import { loadSettings, saveSettings, watchSettings } from '../settings/storage';

export type UpdateSettings = (fn: (s: Settings) => Settings | void) => Promise<void>;

export function useSettings(): [Settings | undefined, UpdateSettings] {
  const [settings, setSettings] = useState<Settings>();
  const ref = useRef<Settings | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void loadSettings().then((s) => {
      if (!alive) return;
      ref.current = s;
      setSettings(s);
    });
    const unwatch = watchSettings((s) => {
      ref.current = s;
      setSettings(s);
    });
    return () => {
      alive = false;
      unwatch();
    };
  }, []);

  const update = useCallback<UpdateSettings>(async (fn) => {
    const current = ref.current ?? (await loadSettings());
    const draft = structuredClone(current);
    const next = fn(draft) ?? draft;
    ref.current = next;
    setSettings(next);
    await saveSettings(next);
  }, []);

  return [settings, update];
}
