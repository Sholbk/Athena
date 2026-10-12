import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase.js';

const COLS = 'id,title,status,priority,bucket,client,source,eos_flag,due,est_hours,serves_rock,notes,created_at,updated_at,vault_path';

// Loads every live task and keeps the list current while the app is open.
export function useTasks() {
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('tasks').select(COLS).is('deleted_at', null).order('due', { ascending: true, nullsFirst: false });
    if (error) setError(error.message); else { setTasks(data); setError(null); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [load]);

  const save = useCallback(async (id, patch) => {
    setTasks((cur) => cur && cur.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    const { error } = await supabase.from('tasks').update(patch).eq('id', id);
    if (error) { await load(); throw error; }
  }, [load]);

  const create = useCallback(async (row) => {
    const { data, error } = await supabase.from('tasks').insert(row).select(COLS).single();
    if (error) throw error;
    setTasks((cur) => [...(cur || []), data]);
    return data;
  }, []);

  const remove = useCallback(async (id) => {
    setTasks((cur) => cur && cur.filter((t) => t.id !== id));
    const { error } = await supabase.from('tasks').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (error) { await load(); throw error; }
  }, [load]);

  return { tasks, error, reload: load, save, create, remove };
}
