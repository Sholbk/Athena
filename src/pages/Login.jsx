import { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import Owl from '../components/Owl.jsx';

export default function Login() {
  const [err, setErr] = useState('');
  const go = async () => {
    setErr('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) setErr(error.message);
  };
  return (
    <div className="center">
      <Owl size={56} />
      <h2>Athena</h2>
      <p className="muted">Your Chief of Staff for operations and marketing.</p>
      <button className="btn big" type="button" onClick={go}>Sign in with Google</button>
      {err && <p className="form-msg">{err}</p>}
    </div>
  );
}
