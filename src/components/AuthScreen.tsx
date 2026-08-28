import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Eye, EyeOff, ArrowRight, Loader2, Check, X } from 'lucide-react';
import { supabase } from '../supabase';
import { cn } from '../utils';

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

export function AuthScreen({ initialMode = 'signin', onBack }: { initialMode?: 'signin' | 'signup'; onBack?: () => void }) {
  const [isLogin, setIsLogin] = useState(initialMode === 'signin');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
  const checkRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Real-time username availability check (signup only)
  useEffect(() => {
    if (isLogin) return;
    if (checkRef.current) clearTimeout(checkRef.current);

    const normalized = username.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!username) { setUsernameStatus('idle'); return; }
    if (normalized.length < 3 || normalized.length > 20) { setUsernameStatus('invalid'); return; }
    if (!/^[a-z0-9_]+$/.test(normalized)) { setUsernameStatus('invalid'); return; }

    setUsernameStatus('checking');
    checkRef.current = setTimeout(async () => {
      const { data } = await supabase.from('users').select('id').eq('username', normalized).maybeSingle();
      setUsernameStatus(data ? 'taken' : 'available');
    }, 450);

    return () => { if (checkRef.current) clearTimeout(checkRef.current); };
  }, [username, isLogin]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const usernameNorm = username.toLowerCase().replace(/[^a-z0-9_]/g, '');
    const syntheticEmail = `${usernameNorm}@chatapp.local`;

    if (!isLogin) {
      if (usernameNorm.length < 3) { setError('Username must be at least 3 characters.'); return; }
      if (usernameStatus === 'taken') { setError('That username is already taken.'); return; }
      if (usernameStatus === 'invalid') { setError('Username can only contain letters, numbers, and underscores.'); return; }
      if (!displayName.trim()) { setError('Please enter a display name.'); return; }
    }

    setLoading(true);
    try {
      if (isLogin) {
        const { error: e } = await supabase.auth.signInWithPassword({ email: syntheticEmail, password });
        if (e) throw e;
      } else {
        const { data: authData, error: e } = await supabase.auth.signUp({
          email: syntheticEmail, password,
          options: { data: { username: usernameNorm, display_name: displayName.trim() } },
        });
        if (e) throw e;
        // Persist display_name to the users table right away
        if (authData.user) {
          await supabase.from('users').upsert({
            id: authData.user.id, username: usernameNorm,
            display_name: displayName.trim(),
          }, { onConflict: 'id' });
        }
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
      setLoading(false);
    }
  };

  const switchMode = (login: boolean) => {
    setIsLogin(login); setError(''); setUsernameStatus('idle');
    setDisplayName(''); setUsername(''); setPassword('');
  };

  const usernameHint = () => {
    if (isLogin) return null;
    const norm = username.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!username) return null;
    switch (usernameStatus) {
      case 'checking': return <span className="flex items-center gap-1 text-[var(--txt3)]"><Loader2 className="w-3 h-3 animate-spin" />Checking…</span>;
      case 'available': return <span className="flex items-center gap-1 text-green-400"><Check className="w-3 h-3" />@{norm} is available</span>;
      case 'taken': return <span className="flex items-center gap-1 text-red-400"><X className="w-3 h-3" />@{norm} is already taken</span>;
      case 'invalid': return <span className="text-amber-400">3–20 chars, letters / numbers / underscores only</span>;
      default: return null;
    }
  };

  return (
    <div className="liquid-shell min-h-screen flex items-center justify-center p-4 overflow-hidden relative">
      {onBack && (
        <button onClick={onBack}
          className="absolute top-5 left-5 flex items-center gap-1.5 text-sm text-[var(--txt3)] hover:text-[var(--txt2)] transition-colors z-10">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
      )}

      <div className="caustic-orb w-[34rem] h-[34rem] -right-40 -top-28 pointer-events-none" />
      <div className="caustic-orb w-[26rem] h-[26rem] -left-24 -bottom-28 opacity-45 pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 28, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="glass-panel-strong relative w-full max-w-[410px] p-8 rounded-[28px]"
      >
        {/* Logo */}
        <div className="flex flex-col items-center mb-7">
          <div className="relative mb-4">
            <div className="absolute inset-0 rounded-2xl bg-[var(--accent)]/20 blur-2xl scale-150" />
            <img src="/logo.png" alt="CHATistry" className="relative w-20 h-20 object-contain drop-shadow-2xl" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-cyan-400 mb-1">CHATistry</h1>
          <p className="text-[13px] text-[var(--txt3)]">
            {isLogin ? 'Welcome back.' : 'Create your account.'}
          </p>
        </div>

        {/* Tab switcher */}
        <div className="relative flex bg-[var(--surface3)] rounded-xl p-1 mb-6 border border-[var(--border)]">
          <motion.div layoutId="authTab"
            className="absolute inset-y-1 rounded-lg bg-[var(--surface4)] border border-[var(--border2)] shadow-lg"
            style={{ width: 'calc(50% - 4px)', left: isLogin ? '4px' : 'calc(50%)' }}
            transition={{ type: 'spring', damping: 22, stiffness: 300 }} />
          {(['Sign In', 'Sign Up'] as const).map((label, i) => (
            <button key={label} onClick={() => switchMode(i === 0)}
              className={cn('relative z-10 flex-1 py-2 text-sm font-medium rounded-lg transition-colors duration-200',
                (isLogin ? i === 0 : i === 1) ? 'text-[var(--txt)]' : 'text-[var(--txt3)] hover:text-[var(--txt2)]')}>
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Display name — signup only */}
          <AnimatePresence>
            {!isLogin && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }} className="overflow-hidden space-y-1.5">
                <label className="text-xs font-medium text-[var(--txt2)] uppercase tracking-wide">Display Name</label>
                <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)}
                  placeholder="Your shown name (e.g. Ankush)"
                  className="w-full bg-[var(--input-bg)] border border-[var(--border2)] rounded-xl py-2.5 px-4 text-sm text-[var(--txt)] placeholder-[var(--txt3)] focus:outline-none focus:border-cyan-600/70 focus:shadow-[0_0_0_3px_rgba(6,182,212,0.08)] transition-all" />
                <p className="text-[11px] text-[var(--txt3)] px-1">Visible to others. Can be anything — not unique.</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Username */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--txt2)] uppercase tracking-wide">Username</label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--txt3)] text-sm select-none">@</span>
              <input type="text" required value={username} onChange={e => setUsername(e.target.value)}
                placeholder="your_username" autoCapitalize="none" autoCorrect="off"
                className={cn(
                  'w-full bg-[var(--input-bg)] border rounded-xl py-2.5 pl-8 pr-9 text-sm text-[var(--txt)] placeholder-[var(--txt3)] focus:outline-none transition-all focus:shadow-[0_0_0_3px_rgba(6,182,212,0.08)]',
                  !isLogin && usernameStatus === 'taken' ? 'border-red-500/60 focus:border-red-500' :
                  !isLogin && usernameStatus === 'available' ? 'border-green-500/60 focus:border-green-500' :
                  'border-[var(--border2)] focus:border-cyan-600/70'
                )} />
              {!isLogin && usernameStatus === 'available' && (
                <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-400" />
              )}
              {!isLogin && usernameStatus === 'taken' && (
                <X className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-red-400" />
              )}
            </div>
            <div className="text-[11px] px-1">{usernameHint()}</div>
          </div>

          {/* Password */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--txt2)] uppercase tracking-wide">Password</label>
            <div className="relative">
              <input type={showPassword ? 'text' : 'password'} required value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-[var(--input-bg)] border border-[var(--border2)] rounded-xl py-2.5 px-4 pr-10 text-sm text-[var(--txt)] placeholder-[var(--txt3)] focus:outline-none focus:border-cyan-600/70 focus:shadow-[0_0_0_3px_rgba(6,182,212,0.08)] transition-all" />
              <button type="button" onClick={() => setShowPassword(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--txt3)] hover:text-[var(--txt2)] transition-colors">
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="text-red-400 text-sm bg-red-500/8 border border-red-500/20 rounded-xl p-3 leading-relaxed">
                  {error}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <button type="submit"
            disabled={loading || !username.trim() || !password || (!isLogin && usernameStatus === 'taken') || (!isLogin && usernameStatus === 'checking')}
            className="group w-full rounded-xl py-2.5 px-4 text-sm font-semibold text-black bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-[0_0_20px_rgba(6,182,212,0.25)] hover:shadow-[0_0_28px_rgba(6,182,212,0.4)] flex items-center justify-center gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
              <>{isLogin ? 'Sign In' : 'Create Account'}<ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" /></>
            )}
          </button>
        </form>

        <p className="text-center text-[11px] text-[var(--txt3)] mt-5">
          {isLogin ? 'New here? ' : 'Already have an account? '}
          <button type="button" onClick={() => switchMode(!isLogin)}
            className="text-cyan-500 hover:text-cyan-400 transition-colors font-medium">
            {isLogin ? 'Create an account' : 'Sign in instead'}
          </button>
        </p>
      </motion.div>
    </div>
  );
}
