import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase.js';

// Loads the live rows of one table and keeps them current while the app is open.
export function useRows(table, cols, order = { column: 'updated_at', ascending: false }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from(table).select(cols).is('deleted_at', null)
      .order(order.column, { ascending: order.ascending, nullsFirst: false });
    if (error) setError(error.message); else { setRows(data); setError(null); }
  }, [table, cols, order.column, order.ascending]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [load]);

  const save = useCallback(async (id, patch) => {
    setRows((cur) => cur && cur.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const { error } = await supabase.from(table).update(patch).eq('id', id);
    if (error) { await load(); throw error; }
  }, [table, load]);

  const create = useCallback(async (row) => {
    const { data, error } = await supabase.from(table).insert(row).select(cols).single();
    if (error) throw error;
    setRows((cur) => [data, ...(cur || [])]);
    return data;
  }, [table, cols]);

  const remove = useCallback(async (id) => {
    setRows((cur) => cur && cur.filter((r) => r.id !== id));
    const { error } = await supabase.from(table).update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (error) { await load(); throw error; }
  }, [table, load]);

  return { rows, error, reload: load, save, create, remove };
}
