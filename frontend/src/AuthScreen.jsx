import { useEffect, useState } from 'react';
import { login } from './api.js';

function Logo() { return <div className="brand-mark" aria-hidden="true"><span /><span /></div>; }
function GoogleIcon() { return <span className="google-icon" aria-hidden="true">G</span>; }
function EyeIcon({ visible }) { return <span className="eye-icon" aria-hidden="true">{visible ? 'â—‰' : 'â—Œ'}</span>; }

export default function AuthScreen() {
  const [mode, setMode] = useState('login');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [attempts, setAttempts] = useState(() => Number(window.sessionStorage.getItem('auctoz_failed_attempts') || 0));
  const [lockoutEnds, setLockoutEnds] = useState(() => Number(window.sessionStorage.getItem('auctoz_lockout_ends') || 0));
  const [captchaChecked, setCaptchaChecked] = useState(false);
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [, setClock] = useState(Date.now());
  const locked = lockoutEnds > Date.now();

  useEffect(() => {
    if (!lockoutEnds) return undefined;
    const timer = window.setInterval(() => {
      if (lockoutEnds <= Date.now()) {
        window.sessionStorage.removeItem('auctoz_lockout_ends');
        window.sessionStorage.removeItem('auctoz_failed_attempts');
        setLockoutEnds(0); setAttempts(0);
      } else setClock(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [lockoutEnds]);

  const lockoutClock = () => {
    const seconds = Math.max(0, Math.floor((lockoutEnds - Date.now()) / 1000));
    return `${Math.floor(seconds / 3600).toString().padStart(2, '0')}:${Math.floor((seconds % 3600) / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  };
  const passwordScore = [password.length >= 8, /[A-Z]/.test(password), /[0-9]/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length;
  const switchMode = nextMode => { setMode(nextMode); setNotice(''); setCaptchaChecked(false); };
  const handleLogin = async event => {
    event.preventDefault();
    if (locked) return;
    if (!captchaChecked) { setNotice('Complete the security verification before continuing.'); return; }
    const data = new FormData(event.currentTarget);
    if (!data.get('email') || !data.get('password')) { setNotice('Institutional email and password are required.'); return; }
    setSubmitting(true);
    try {
      const result = await login(data.get('email'), data.get('password'));
      window.localStorage.setItem('auctoz_token', result.token);
      window.location.hash = 'auction/108';
      return;
    } catch (error) {
      setNotice(error.message);
    } finally {
      setSubmitting(false);
    }
    const nextAttempts = attempts + 1;
    setAttempts(nextAttempts); window.sessionStorage.setItem('auctoz_failed_attempts', String(nextAttempts));
    if (nextAttempts >= 3) {
      const ends = Date.now() + 24 * 60 * 60 * 1000;
      setLockoutEnds(ends); window.sessionStorage.setItem('auctoz_lockout_ends', String(ends)); setNotice('Security threshold reached. Terminal access is temporarily locked.');
    } else setNotice('Access denied. Verify your credentials and try again.');
  };
  const handleRegister = event => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    if (data.get('password') !== data.get('confirmPassword')) setNotice('Password confirmation does not match.');
    else if (!data.get('terms')) setNotice('Institutional platform terms must be accepted.');
    else setNotice('Registration request staged for institutional review.');
  };
  const toggleCaptcha = () => !locked && setCaptchaChecked(value => !value);

  return <main className="auth-shell">
    <div className="grain" />
    <div className="ambient-grid" aria-hidden="true"><span>NODE 0x7F...C3 / TOKYO</span><span>LATENCY 0.8MS</span><span>BOOK DEPTH 4551</span><span>US-EAST / EU-CENTRAL / AP-SOUTH</span><i /></div>
    <header className="auth-topbar"><a className="brand auth-brand" href="#" onClick={() => { window.location.hash = ''; }}><Logo /><span>Auctoz</span></a><div className="auth-live"><b className="status-dot" /> SECURE ACCESS / ENGINE ONLINE</div></header>
    <div className="auth-layout">
      <section className="auth-panel" aria-labelledby="auth-title">
        <div className="auth-kicker">INSTITUTIONAL ACCESS <span>/</span> TERMINAL AUTH</div>
        <div className="auth-heading"><Logo /><div><h1 id="auth-title">{mode === 'login' ? 'Welcome back.' : 'Create your node.'}</h1><p>{mode === 'login' ? 'Authenticate to enter the live auction terminal.' : 'Establish a verified institutional presence on Auctoz.'}</p></div></div>
        {mode === 'login' ? <form className="auth-form" onSubmit={handleLogin}>
          <button type="button" className="google-button"><GoogleIcon /> CONTINUE WITH GOOGLE <span>â†—</span></button>
          <div className="auth-divider"><span>OR AUTHENTICATE WITH CREDENTIALS</span></div>
          <label className="field"><span>USERNAME / INSTITUTIONAL EMAIL</span><input name="email" type="email" autoComplete="email" placeholder="operator@institution.com" disabled={locked} /></label>
          <label className="field"><span>PASSWORD</span><div className="password-wrap"><input name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢" disabled={locked} /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(value => !value)} disabled={locked}><EyeIcon visible={showPassword} /></button></div></label>
          <div className={`captcha ${captchaChecked ? 'captcha-checked' : ''}`} role="checkbox" aria-checked={captchaChecked} tabIndex="0" onClick={toggleCaptcha} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') toggleCaptcha(); }}><span className="captcha-box">{captchaChecked ? 'âœ“' : ''}</span><span>VERIFY YOU ARE HUMAN</span><small>SECURED BY TURNSTILE</small></div>
          {locked ? <div className="lockout-card"><b>SECURITY LOCKOUT ACTIVE</b><span>TRY AGAIN IN {lockoutClock()}</span><small>Repeated failed attempts detected. Access will restore automatically.</small></div> : <button className="auth-submit" type="submit" disabled={submitting}>{submitting ? 'AUTHENTICATING...' : 'ACCESS TERMINAL'} <span>â†’</span></button>}
          {notice && <p className="form-notice" role="alert">{notice}</p>}
          <div className="auth-toggle">New to Auctoz? <button type="button" onClick={() => switchMode('register')}>CREATE AN INSTITUTIONAL ACCOUNT <span>â†’</span></button></div>
        </form> : <form className="auth-form register-form" onSubmit={handleRegister}>
          <div className="form-grid two-col"><label className="field"><span>FIRST NAME</span><input name="firstName" placeholder="Aiko" required /></label><label className="field"><span>LAST NAME</span><input name="lastName" placeholder="Tanaka" required /></label></div>
          <div className="form-grid two-col"><label className="field"><span>DATE OF BIRTH</span><input name="birthDate" type="date" required /></label><label className="field"><span>USERNAME</span><input name="username" placeholder="node_operator" required /></label></div>
          <label className="field"><span>WORK / INSTITUTIONAL EMAIL</span><input name="email" type="email" placeholder="operator@institution.com" required /></label>
          <div className="form-grid two-col"><label className="field"><span>PASSWORD</span><div className="password-wrap"><input name="password" type={showPassword ? 'text' : 'password'} onChange={event => setPassword(event.target.value)} required /><button type="button" aria-label="Toggle password visibility" onClick={() => setShowPassword(value => !value)}><EyeIcon visible={showPassword} /></button></div></label><label className="field"><span>CONFIRM PASSWORD</span><div className="password-wrap"><input name="confirmPassword" type={showConfirm ? 'text' : 'password'} required /><button type="button" aria-label="Toggle confirmation visibility" onClick={() => setShowConfirm(value => !value)}><EyeIcon visible={showConfirm} /></button></div></label></div>
          <div className="strength-meter" aria-label={`Password strength ${passwordScore} of 4`}>{[0, 1, 2, 3].map(index => <i className={index < passwordScore ? 'filled' : ''} key={index} />)}<span>{passwordScore < 2 ? 'WEAK' : passwordScore < 4 ? 'GOOD' : 'STRONG'}</span></div>
          <label className="field"><span>ORGANIZATION / FIRM NAME</span><input name="organization" placeholder="Northstar Capital" required /></label>
          <div className="form-grid two-col"><label className="field"><span>ACCOUNT ROLE</span><select name="role" defaultValue="" required><option value="" disabled>Select role</option><option>Institutional Bidder</option><option>Auctioneer</option><option>Liquidity Provider</option></select></label><label className="field"><span>PRIMARY ROUTING REGION</span><select name="region" defaultValue="" required><option value="" disabled>Select region</option><option>US-East (Virginia)</option><option>EU-Central (Frankfurt)</option><option>AP-South (Mumbai)</option></select></label></div>
          <label className="terms"><input name="terms" type="checkbox" /><span>I agree to the Institutional Platform Terms &amp; Sub-Millisecond Execution Rules.</span></label>
          {notice && <p className="form-notice" role="alert">{notice}</p>}<button className="auth-submit" type="submit">REGISTER NODE <span>â†’</span></button>
          <div className="auth-toggle">Already registered? <button type="button" onClick={() => switchMode('login')}>SIGN IN <span>â†’</span></button></div>
        </form>}
      </section>
      <aside className="auth-quote"><span className="quote-line" /><p>THE FASTEST<br />PATH BETWEEN<br /><em>INTENT</em> AND<br /><em>ALLOCATION.</em></p><div className="quote-meta">AUCTOZ / ACCESS NODE 01<br /><b className="status-dot" /> ENCRYPTED SESSION READY</div></aside>
    </div>
    <footer>AUCTOZ <span>/</span> ENGINE ONLINE</footer>
  </main>;
}