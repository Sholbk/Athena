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
    <div className="login">
      <div className="center">
        <Owl size={150} />
        <h2 className="wordmark">Athena</h2>
        <p className="tagline">Chief of Staff</p>
        <p className="muted">For operations and marketing.</p>
        <button className="btn big" type="button" onClick={go}>Sign in with Google</button>
        {err && <p className="form-msg">{err}</p>}
      </div>
      {/* Google asks for these links on the home page before it publishes the app (Settings > Google Calendar). */}
      <footer className="login-foot">
        <a href="/privacy">Privacy Policy</a>
        <a href="/terms">Terms of Service</a>
      </footer>
    </div>
  );
}
