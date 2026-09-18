import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { login, loginWithGoogle } from './api.js';

const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();
const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim();
const GSI_SRC = 'https://accounts.google.com/gsi/client';
const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function Logo() { return <div className="brand-mark" aria-hidden="true"><span /><span /></div>; }
function EyeIcon({ visible }) { return <span className="eye-icon" aria-hidden="true">{visible ? '◉' : '◌'}</span>; }
function Spinner() { return <span className="auth-spinner" aria-hidden="true" />; }

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing?.dataset.loaded === 'true' || existing?.readyState === 'complete') {
      resolve();
      return;
    }
    if (existing) {
      existing.addEventListener('load', () => { existing.dataset.loaded = 'true'; resolve(); }, { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => { script.dataset.loaded = 'true'; resolve(); };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function hasTurnstileWidget(id) {
  return id !== null && id !== undefined && id !== '';
}

export default function AuthScreen() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('login');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [attempts, setAttempts] = useState(() => {
    const stored = localStorage.getItem('auctoz_failed_attempts');
    const timestamp = localStorage.getItem('auctoz_attempts_timestamp');
    // Reset attempts if more than 15 minutes have passed
    if (timestamp && Date.now() - Number(timestamp) > 15 * 60 * 1000) {
      localStorage.removeItem('auctoz_failed_attempts');
      localStorage.removeItem('auctoz_attempts_timestamp');
      return 0;
    }
    return Number(stored || 0);
  });
  const [lockoutEnds, setLockoutEnds] = useState(() => Number(localStorage.getItem('auctoz_lockout_ends') || 0));
  const [turnstileToken, setTurnstileToken] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState('error'); // 'error', 'success', 'info'
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [captchaReady, setCaptchaReady] = useState(false);
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [, setClock] = useState(Date.now());
  const turnstileHost = useRef(null);
  const turnstileWidget = useRef(null);
  const googleHost = useRef(null);
  const locked = lockoutEnds > Date.now();
  const busy = submitting || googleSubmitting;
  const maxAttempts = 5;
  const lockoutDuration = 5 * 60 * 1000; // 5 minutes

  const showFeedback = (message, asToast = false, type = 'error') => {
    setNotice(message);
    if (asToast) {
      setToast(message);
      setToastType(type);
    }
  };

  const clearFeedback = () => {
    setNotice('');
    setToast('');
    setToastType('error');
  };

  const resetTurnstile = () => {
    setTurnstileToken('');
    setCaptchaReady(false);
    try {
      if (hasTurnstileWidget(turnstileWidget.current)) window.turnstile?.reset(turnstileWidget.current);
    } catch { /* widget may not be mounted */ }
  };

  const completeLogin = result => {
    if (!result?.token || !result?.user?.id) {
      showFeedback('Authentication succeeded but the session could not be stored. Please try again.', true, 'error');
      return false;
    }
    
    // Clear failed attempts on successful login
    localStorage.removeItem('auctoz_failed_attempts');
    localStorage.removeItem('auctoz_attempts_timestamp');
    localStorage.removeItem('auctoz_lockout_ends');
    setAttempts(0);
    setLockoutEnds(0);
    
    showFeedback('Authentication successful! Redirecting...', true, 'success');
    
    // Small delay to show success message before redirect
    setTimeout(() => {
      navigate('/assets/108');
    }, 1000);
    
    return true;
  };

  const describeAuthError = error => {
    if (error?.status === 429) {
      const wait = error.retryAfter || 60;
      const minutes = Math.ceil(wait / 60);
      return `Too many sign-in attempts. For security, please wait ${minutes} minute${minutes !== 1 ? 's' : ''} before trying again.`;
    }
    if (error?.status === 503 || error?.code === 'AUTH_UNAVAILABLE') {
      return error.message || 'Authentication service is temporarily unavailable. Please try again later.';
    }
    if (error?.code === 'NETWORK_ERROR') {
      return 'Network connection failed. Please check your internet connection and try again.';
    }
    if (error?.code === 'SESSION_ERROR') {
      return 'Session creation failed. Please try again.';
    }
    if (error?.code === 'SESSION_STORAGE_ERROR') {
      return 'Failed to store session. Your browser may have storage disabled. Please check your browser settings.';
    }
    if (error?.code === 'MISSING_GOOGLE_CREDENTIAL') {
      return 'Google authentication failed. No credential received from Google.';
    }
    if (error?.code === 'INVALID_GOOGLE_CREDENTIAL') {
      return 'Google authentication failed. Invalid credential received.';
    }
    if (error?.code === 'VALIDATION_ERROR') {
      return error.message || 'Invalid input data provided.';
    }
    if (error?.code === 'POPUP_BLOCKED') {
      return 'Google Sign-In popup was blocked. Please allow popups for this site and try again.';
    }
    return error?.message || 'Authentication failed. Please check your credentials and try again.';
  };

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => {
      setToast('');
      setToastType('error');
    }, toastType === 'success' ? 3000 : 5000);
    return () => window.clearTimeout(timer);
  }, [toast, toastType]);

  useEffect(() => {
    if (!lockoutEnds) return undefined;
    const timer = window.setInterval(() => {
      if (lockoutEnds <= Date.now()) {
        localStorage.removeItem('auctoz_lockout_ends');
        localStorage.removeItem('auctoz_failed_attempts');
        localStorage.removeItem('auctoz_attempts_timestamp');
        setLockoutEnds(0); setAttempts(0);
      } else setClock(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [lockoutEnds]);

  useEffect(() => {
    let cancelled = false;
    const mountTurnstile = async () => {
      if (!TURNSTILE_SITE_KEY) {
        if (!cancelled) {
          const errorMsg = 'CAPTCHA is not configured. Please set VITE_TURNSTILE_SITE_KEY in your environment variables.';
          console.error('CAPTCHA Configuration Error:', errorMsg);
          showFeedback(errorMsg, true, 'info');
        }
        return;
      }
      
      if (!turnstileHost.current) return;
      
      try {
        setCaptchaLoading(true);
        
        // Validate site key format before loading script
        if (!TURNSTILE_SITE_KEY.match(/^[a-zA-Z0-9_-]{32,}$/)) {
          if (!cancelled) {
            const errorMsg = 'Invalid CAPTCHA configuration. The site key format is incorrect. Expected 32+ alphanumeric characters.';
            console.error('CAPTCHA Configuration Error:', errorMsg, 'Provided key:', TURNSTILE_SITE_KEY);
            showFeedback(errorMsg, true, 'error');
          }
          setCaptchaLoading(false);
          return;
        }
        
        await loadScript(TURNSTILE_SRC);
        
        if (cancelled || !window.turnstile || !turnstileHost.current) {
          setCaptchaLoading(false);
          if (!cancelled) {
            const errorMsg = 'CAPTCHA failed to load. The Cloudflare Turnstile library may be blocked or unavailable.';
            console.error('CAPTCHA Loading Error:', errorMsg);
            showFeedback(errorMsg, true, 'error');
          }
          return;
        }
        
        if (hasTurnstileWidget(turnstileWidget.current)) {
          try { window.turnstile.remove(turnstileWidget.current); } catch { /* ignore */ }
        }
        
        setCaptchaReady(false);
        setTurnstileToken('');
        
        turnstileWidget.current = window.turnstile.render(turnstileHost.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark',
          appearance: 'always',
          callback: token => { 
            console.log('CAPTCHA: Verification successful');
            setTurnstileToken(token); 
            setCaptchaReady(true); 
            setCaptchaLoading(false);
          },
          'expired-callback': () => { 
            console.log('CAPTCHA: Token expired');
            setTurnstileToken(''); 
            setCaptchaReady(false); 
            showFeedback('CAPTCHA expired. Please complete verification again.', false, 'info');
          },
          'timeout-callback': () => { 
            console.log('CAPTCHA: Verification timed out');
            setTurnstileToken(''); 
            setCaptchaReady(false); 
            showFeedback('CAPTCHA timed out. Please complete verification again.', false, 'info');
          },
          'error-callback': () => {
            console.error('CAPTCHA: Verification failed');
            setTurnstileToken('');
            setCaptchaReady(false);
            setCaptchaLoading(false);
            if (!cancelled) {
              showFeedback('CAPTCHA verification failed. Please try again.', false, 'error');
            }
          },
        });
        
        console.log('CAPTCHA: Successfully initialized');
      } catch (error) {
        console.error('Turnstile loading error:', error);
        setCaptchaReady(false);
        setCaptchaLoading(false);
        if (!cancelled) {
          const errorMsg = 'CAPTCHA failed to load. Please check your network connection and try again.';
          showFeedback(errorMsg, true, 'error');
        }
      }
    };
    
    mountTurnstile();
    
    return () => {
      cancelled = true;
      try {
        if (hasTurnstileWidget(turnstileWidget.current)) {
          window.turnstile?.remove(turnstileWidget.current);
        }
      } catch { /* ignore */ }
      turnstileWidget.current = null;
      setCaptchaReady(false);
      setCaptchaLoading(false);
    };
  }, [mode]);

  useEffect(() => {
    let cancelled = false;
    const mountGoogle = async () => {
      if (!GOOGLE_CLIENT_ID) {
        setGoogleReady(false);
        setGoogleLoading(false);
        if (!cancelled) {
          console.warn('Google Sign-In: VITE_GOOGLE_CLIENT_ID is not configured');
        }
        return;
      }
      
      try {
        setGoogleLoading(true);
        
        // Validate client ID format
        if (GOOGLE_CLIENT_ID.length < 10 || !GOOGLE_CLIENT_ID.includes('googleusercontent')) {
          setGoogleLoading(false);
          if (!cancelled) {
            const errorMsg = 'Google Sign-In is misconfigured. Invalid client ID format.';
            console.error('Google Sign-In Configuration Error:', errorMsg, 'Provided:', GOOGLE_CLIENT_ID);
            showFeedback(errorMsg, true, 'error');
          }
          return;
        }
        
        await loadScript(GSI_SRC);
        
        if (cancelled || !window.google?.accounts?.id) {
          setGoogleLoading(false);
          if (!cancelled) {
            const errorMsg = 'Google Sign-In failed to load. The Google Identity Services library may be blocked or unavailable.';
            console.error('Google Sign-In Loading Error:', errorMsg);
            showFeedback(errorMsg, true, 'error');
          }
          return;
        }
        
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: async response => {
            setGoogleSubmitting(true);
            clearFeedback();
            try {
              if (!response?.credential) {
                const error = new Error('Google did not return a credential. The authentication flow was interrupted.');
                error.code = 'MISSING_GOOGLE_CREDENTIAL';
                console.error('Google Sign-In Error:', error.message, 'Response:', response);
                throw error;
              }
              
              // Validate credential structure
              if (typeof response.credential !== 'string' || response.credential.length < 50) {
                const error = new Error('Invalid Google credential received. The token format is incorrect.');
                error.code = 'INVALID_GOOGLE_CREDENTIAL';
                console.error('Google Sign-In Error:', error.message, 'Credential length:', response.credential?.length);
                throw error;
              }
              
              console.log('Google Sign-In: Credential received, attempting authentication...');
              const result = await loginWithGoogle(response.credential);
              console.log('Google Sign-In: Authentication successful');
              completeLogin(result);
            } catch (error) {
              console.error('Google login error:', error);
              showFeedback(describeAuthError(error), true, 'error');
            } finally {
              setGoogleSubmitting(false);
            }
          },
          auto_select: false,
          cancel_on_tap_outside: true,
          error_callback: (error) => {
            console.error('Google initialization error:', error);
            if (!cancelled) {
              let errorMsg = 'Google Sign-In initialization failed. Please check your browser settings and try again.';
              if (error?.message?.includes('popup') || error?.message?.includes('Popup')) {
                errorMsg = 'Google Sign-In popup was blocked. Please allow popups for this site in your browser settings and try again.';
              } else if (error?.code === 'popup_closed') {
                errorMsg = 'Google Sign-In was cancelled. Please try again.';
              }
              showFeedback(errorMsg, true, 'error');
            }
          },
        });
        
        if (googleHost.current) {
          googleHost.current.innerHTML = '';
          const width = Math.max(280, Math.floor(googleHost.current.getBoundingClientRect().width) || 400);
          try {
            window.google.accounts.id.renderButton(googleHost.current, {
              type: 'standard',
              theme: window.matchMedia('(prefers-color-scheme: light)').matches ? 'outline' : 'filled_black',
              size: 'large',
              text: 'signin_with',
              shape: 'rectangular',
              logo_alignment: 'left',
              width: width,
              locale: 'en',
            });
            console.log('Google Sign-In: Button rendered successfully with width:', width);
          } catch (renderError) {
            console.error('Google Sign-In: Failed to render button:', renderError);
            if (!cancelled) {
              showFeedback('Google Sign-In button failed to render. Please refresh the page.', true, 'error');
            }
          }
        }
        
        if (!cancelled) {
          setGoogleReady(true);
          setGoogleLoading(false);
          console.log('Google Sign-In: Successfully initialized');
        }
      } catch (error) {
        console.error('Google Sign-In loading error:', error);
        setGoogleReady(false);
        setGoogleLoading(false);
        if (!cancelled) {
          const errorMsg = 'Google Sign-In failed to load. Please check your network connection and ensure popups are allowed.';
          showFeedback(errorMsg, true, 'error');
        }
      }
    };
    
    mountGoogle();
    
    return () => { 
      cancelled = true;
      setGoogleLoading(false);
    };
  }, []);

  const lockoutClock = () => {
    const seconds = Math.max(0, Math.floor((lockoutEnds - Date.now()) / 1000));
    return `${Math.floor(seconds / 3600).toString().padStart(2, '0')}:${Math.floor((seconds % 3600) / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  };
  
  const passwordScore = [password.length >= 8, /[A-Z]/.test(password), /[0-9]/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length;
  
  const switchMode = nextMode => { 
    setMode(nextMode); 
    clearFeedback(); 
    resetTurnstile(); 
  };
  
  const validateEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };
  
  const validatePassword = (password) => {
    return password.length >= 8;
  };

  const handleLogin = async event => {
    event.preventDefault();
    
    if (locked || busy) return;
    
    const data = new FormData(event.currentTarget);
    const email = data.get('email')?.trim();
    const password = data.get('password');
    
    // Client-side validation
    if (!email || !password) { 
      showFeedback('Email and password are required.', false, 'error'); 
      return; 
    }
    
    if (!validateEmail(email)) {
      showFeedback('Please enter a valid email address.', false, 'error');
      return;
    }
    
    if (!validatePassword(password)) {
      showFeedback('Password must be at least 8 characters long.', false, 'error');
      return;
    }
    
    if (!TURNSTILE_SITE_KEY) { 
      showFeedback('CAPTCHA is not configured. Please contact support.', false, 'error'); 
      return; 
    }
    
    if (!captchaReady || !turnstileToken) { 
      showFeedback('Please complete the CAPTCHA verification before signing in.', false, 'error'); 
      return; 
    }
    
    // Client-side rate limiting check (additional protection)
    if (attempts >= maxAttempts) {
      const ends = Date.now() + lockoutDuration;
      setLockoutEnds(ends);
      localStorage.setItem('auctoz_lockout_ends', String(ends));
      const minutes = Math.ceil(lockoutDuration / 60000);
      showFeedback(`Too many failed attempts. For security, please wait ${minutes} minute${minutes !== 1 ? 's' : ''} before trying again.`, true, 'error');
      return;
    }
    
    setSubmitting(true);
    clearFeedback();
    
    try {
      completeLogin(await login(email, password, turnstileToken));
    } catch (error) {
      // Auto-reset CAPTCHA on any failed attempt
      resetTurnstile();
      
      const invalidCreds = error?.status === 401 || error?.code === 'INVALID_CREDENTIALS';
      const captchaError = error?.message?.toLowerCase().includes('captcha') || error?.message?.toLowerCase().includes('turnstile');
      
      if (error?.status === 429) {
        showFeedback(describeAuthError(error), true, 'error');
        return;
      }
      
      if (captchaError) {
        showFeedback('CAPTCHA verification failed. Please complete the verification again.', true, 'error');
        return;
      }
      
      if (!invalidCreds) {
        showFeedback(describeAuthError(error), true, 'error');
        return;
      }
      
      // Increment failed attempts
      const nextAttempts = attempts + 1;
      setAttempts(nextAttempts);
      localStorage.setItem('auctoz_failed_attempts', String(nextAttempts));
      localStorage.setItem('auctoz_attempts_timestamp', String(Date.now()));
      
      if (nextAttempts >= maxAttempts) {
        const ends = Date.now() + lockoutDuration;
        setLockoutEnds(ends);
        localStorage.setItem('auctoz_lockout_ends', String(ends));
        showFeedback(`Too many failed attempts. Account locked for ${Math.ceil(lockoutDuration / 60000)} minutes.`, true, 'error');
      } else {
        const remainingAttempts = maxAttempts - nextAttempts;
        showFeedback(`Invalid credentials. ${remainingAttempts} attempt${remainingAttempts !== 1 ? 's' : ''} remaining.`, true, 'error');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = event => {
    event.preventDefault();
    
    if (locked || busy) return;
    
    const data = new FormData(event.currentTarget);
    const password = data.get('password');
    const confirmPassword = data.get('confirmPassword');
    const email = data.get('email')?.trim();
    
    // Client-side validation
    if (!email || !validateEmail(email)) {
      showFeedback('Please enter a valid email address.', false, 'error');
      return;
    }
    
    if (!password || !validatePassword(password)) {
      showFeedback('Password must be at least 8 characters long.', false, 'error');
      return;
    }
    
    if (password !== confirmPassword) {
      showFeedback('Password confirmation does not match.', false, 'error');
      return;
    }
    
    if (!data.get('terms')) {
      showFeedback('You must accept the institutional platform terms to register.', false, 'error');
      return;
    }
    
    setSubmitting(true);
    showFeedback('Registration is currently unavailable. Please contact support for account creation.', true, 'info');
    setSubmitting(false);
  };

  const captchaBlocking = Boolean(TURNSTILE_SITE_KEY) && (!captchaReady || !turnstileToken || captchaLoading);
  const submitLabel = submitting ? 'AUTHENTICATING...' : 'ACCESS TERMINAL';

  return <main className="auth-shell">
    <div className="grain" />
    <div className="ambient-grid" aria-hidden="true"><span>NODE 0x7F...C3 / TOKYO</span><span>LATENCY 0.8MS</span><span>BOOK DEPTH 4551</span><span>US-EAST / EU-CENTRAL / AP-SOUTH</span><i /></div>
    {toast && <div className={`auth-toast auth-toast-${toastType}`} role="alert" aria-live="assertive">{toast}</div>}
    <header className="auth-topbar">
      <Link className="brand auth-brand" to="/assets" aria-label="Return to asset list">
        <Logo /><span>Auctoz</span>
      </Link>
      <div className="auth-live"><b className="status-dot" aria-hidden="true" /> SECURE ACCESS / ENGINE ONLINE</div>
    </header>
    <div className="auth-layout">
      <section className="auth-panel" aria-labelledby="auth-title">
        <div className="auth-kicker">INSTITUTIONAL ACCESS <span>/</span> TERMINAL AUTH</div>
        <div className="auth-heading">
          <Logo />
          <div>
            <h1 id="auth-title">{mode === 'login' ? 'Welcome back.' : 'Create your node.'}</h1>
            <p>{mode === 'login' ? 'Authenticate to enter the live auction terminal.' : 'Establish a verified institutional presence on Auctoz.'}</p>
          </div>
        </div>
        {mode === 'login' ? <form className="auth-form" onSubmit={handleLogin} aria-busy={busy} aria-describedby="auth-feedback" noValidate>
          <div className="google-button-stack">
            <div ref={googleHost} className="google-gsi-host" role="group" aria-label="Google Sign-In" aria-busy={googleLoading} />
            {!GOOGLE_CLIENT_ID && !googleLoading && (
              <p className="form-notice" role="status">Google Sign-In is not configured. Contact your administrator.</p>
            )}
            {googleLoading && (
              <div className="google-loading-state">
                <Spinner />
                <span>Loading Google Sign-In...</span>
              </div>
            )}
          </div>
          <div className="auth-divider"><span>OR AUTHENTICATE WITH CREDENTIALS</span></div>
          <label className="field" htmlFor="auth-email">
            <span>USERNAME / INSTITUTIONAL EMAIL</span>
            <input 
              id="auth-email" 
              name="email" 
              type="email" 
              autoComplete="email" 
              placeholder="operator@institution.com" 
              disabled={locked || busy} 
              aria-disabled={locked || busy} 
              aria-invalid={notice && notice.includes('email') ? 'true' : 'false'}
              aria-busy={busy}
              required 
            />
          </label>
          <label className="field" htmlFor="auth-password">
            <span>PASSWORD</span>
            <div className="password-wrap">
              <input 
                id="auth-password" 
                name="password" 
                type={showPassword ? 'text' : 'password'} 
                autoComplete="current-password" 
                placeholder="••••••••••••" 
                disabled={locked || busy} 
                aria-disabled={locked || busy}
                aria-invalid={notice && notice.includes('password') ? 'true' : 'false'}
                aria-busy={busy}
                required 
              />
              <button 
                type="button" 
                aria-label={showPassword ? 'Hide password' : 'Show password'} 
                aria-controls="auth-password" 
                onClick={() => setShowPassword(value => !value)} 
                disabled={locked || busy}
                tabIndex={0}
              >
                <EyeIcon visible={showPassword} />
              </button>
            </div>
          </label>
          <div className="captcha-widget">
            <div ref={turnstileHost} className="turnstile-host" role="group" aria-label="CAPTCHA verification" aria-busy={captchaLoading}>
              {captchaLoading && <div className="captcha-loading" aria-hidden="true"><Spinner /></div>}
            </div>
            {!TURNSTILE_SITE_KEY && <p className="form-notice" role="alert">CAPTCHA is not configured. Please contact support.</p>}
            <small aria-live="polite">{captchaLoading ? 'LOADING CAPTCHA...' : captchaReady ? '✓ CAPTCHA VERIFIED' : 'SECURED BY CLOUDFLARE TURNSTILE'}</small>
          </div>
          {locked
            ? <div className="lockout-card" role="alert" aria-live="assertive">
                <b>SECURITY LOCKOUT ACTIVE</b>
                <span>TRY AGAIN IN {lockoutClock()}</span>
                <small>For your security, please wait before attempting to sign in again.</small>
              </div>
            : <button 
                className="auth-submit" 
                type="submit" 
                disabled={busy || captchaBlocking} 
                aria-disabled={busy || captchaBlocking}
                aria-busy={busy}
              >
                {submitting ? <><Spinner /> {submitLabel}</> : <>ACCESS TERMINAL <span aria-hidden="true">→</span></>}
              </button>}
          {notice && <p id="auth-feedback" className="form-banner" role="alert" aria-live="assertive">{notice}</p>}
          <div className="auth-toggle">
            New to Auctoz? 
            <button 
              type="button" 
              onClick={() => switchMode('register')}
              disabled={busy}
              aria-disabled={busy}
            >
              CREATE AN INSTITUTIONAL ACCOUNT <span aria-hidden="true">→</span>
            </button>
          </div>
        </form> : <form className="auth-form register-form" onSubmit={handleRegister} aria-describedby="register-feedback">
          <div className="form-grid two-col">
            <label className="field" htmlFor="firstName">
              <span>FIRST NAME</span>
              <input 
                id="firstName" 
                name="firstName" 
                autoComplete="given-name" 
                placeholder="Aiko" 
                disabled={busy}
                aria-disabled={busy}
                required 
              />
            </label>
            <label className="field" htmlFor="lastName">
              <span>LAST NAME</span>
              <input 
                id="lastName" 
                name="lastName" 
                autoComplete="family-name" 
                placeholder="Tanaka" 
                disabled={busy}
                aria-disabled={busy}
                required 
              />
            </label>
          </div>
          <div className="form-grid two-col">
            <label className="field" htmlFor="birthDate">
              <span>DATE OF BIRTH</span>
              <input 
                id="birthDate" 
                name="birthDate" 
                type="date" 
                autoComplete="bday" 
                disabled={busy}
                aria-disabled={busy}
                required 
              />
            </label>
            <label className="field" htmlFor="username">
              <span>USERNAME</span>
              <input 
                id="username" 
                name="username" 
                autoComplete="username" 
                placeholder="node_operator" 
                disabled={busy}
                aria-disabled={busy}
                required 
              />
            </label>
          </div>
          <label className="field" htmlFor="register-email">
            <span>WORK / INSTITUTIONAL EMAIL</span>
            <input 
              id="register-email" 
              name="email" 
              type="email" 
              autoComplete="email" 
              placeholder="operator@institution.com" 
              disabled={busy}
              aria-disabled={busy}
              aria-invalid={notice && notice.includes('email') ? 'true' : 'false'}
              required 
            />
          </label>
          <div className="form-grid two-col">
            <label className="field" htmlFor="register-password">
              <span>PASSWORD</span>
              <div className="password-wrap">
                <input 
                  id="register-password" 
                  name="password" 
                  type={showPassword ? 'text' : 'password'} 
                  autoComplete="new-password" 
                  onChange={event => setPassword(event.target.value)}
                  disabled={busy}
                  aria-disabled={busy}
                  aria-invalid={notice && notice.includes('password') ? 'true' : 'false'}
                  required 
                />
                <button 
                  type="button" 
                  aria-label={showPassword ? 'Hide password' : 'Show password'} 
                  aria-controls="register-password" 
                  onClick={() => setShowPassword(value => !value)}
                  disabled={busy}
                  tabIndex={0}
                >
                  <EyeIcon visible={showPassword} />
                </button>
              </div>
            </label>
            <label className="field" htmlFor="confirmPassword">
              <span>CONFIRM PASSWORD</span>
              <div className="password-wrap">
                <input 
                  id="confirmPassword" 
                  name="confirmPassword" 
                  type={showConfirm ? 'text' : 'password'} 
                  autoComplete="new-password"
                  disabled={busy}
                  aria-disabled={busy}
                  aria-invalid={notice && notice.includes('confirmation') ? 'true' : 'false'}
                  required 
                />
                <button 
                  type="button" 
                  aria-label={showConfirm ? 'Hide confirmation' : 'Show confirmation'} 
                  aria-controls="confirmPassword" 
                  onClick={() => setShowConfirm(value => !value)}
                  disabled={busy}
                  tabIndex={0}
                >
                  <EyeIcon visible={showConfirm} />
                </button>
              </div>
            </label>
          </div>
          <div className="strength-meter" aria-label={`Password strength: ${passwordScore < 2 ? 'Weak' : passwordScore < 4 ? 'Good' : 'Strong'} (${passwordScore}/4)`}>
            {[0, 1, 2, 3].map(index => <i className={index < passwordScore ? 'filled' : ''} key={index} aria-hidden="true" />)}
            <span>{passwordScore < 2 ? 'WEAK' : passwordScore < 4 ? 'GOOD' : 'STRONG'}</span>
          </div>
          <label className="field" htmlFor="organization">
            <span>ORGANIZATION / FIRM NAME</span>
            <input 
              id="organization" 
              name="organization" 
              autoComplete="organization" 
              placeholder="Northstar Capital" 
              disabled={busy}
              aria-disabled={busy}
              required 
            />
          </label>
          <div className="form-grid two-col">
            <label className="field" htmlFor="role">
              <span>ACCOUNT ROLE</span>
              <select 
                id="role" 
                name="role" 
                defaultValue="" 
                disabled={busy}
                aria-disabled={busy}
                required
              >
                <option value="" disabled>Select role</option>
                <option>Institutional Bidder</option>
                <option>Auctioneer</option>
                <option>Liquidity Provider</option>
              </select>
            </label>
            <label className="field" htmlFor="region">
              <span>PRIMARY ROUTING REGION</span>
              <select 
                id="region" 
                name="region" 
                defaultValue="" 
                disabled={busy}
                aria-disabled={busy}
                required
              >
                <option value="" disabled>Select region</option>
                <option>US-East (Virginia)</option>
                <option>EU-Central (Frankfurt)</option>
                <option>AP-South (Mumbai)</option>
              </select>
            </label>
          </div>
          <label className="terms">
            <input 
              name="terms" 
              type="checkbox" 
              disabled={busy}
              aria-disabled={busy}
              required
            />
            <span>I agree to the Institutional Platform Terms & Sub-Millisecond Execution Rules.</span>
          </label>
          {notice && <p id="register-feedback" className="form-banner" role="alert" aria-live="assertive">{notice}</p>}
          <button 
            className="auth-submit" 
            type="submit" 
            disabled={busy} 
            aria-disabled={busy}
            aria-busy={busy}
          >
            {busy ? <><Spinner /> PROCESSING...</> : <>REGISTER NODE <span aria-hidden="true">→</span></>}
          </button>
          <div className="auth-toggle">
            Already registered? 
            <button 
              type="button" 
              onClick={() => switchMode('login')}
              disabled={busy}
              aria-disabled={busy}
            >
              SIGN IN <span aria-hidden="true">→</span>
            </button>
          </div>
        </form>}
      </section>
      <aside className="auth-quote">
        <span className="quote-line" />
        <p>THE FASTEST<br />PATH BETWEEN<br /><em>INTENT</em> AND<br /><em>ALLOCATION.</em></p>
        <div className="quote-meta">AUCTOZ / ACCESS NODE 01<br /><b className="status-dot" /> ENCRYPTED SESSION READY</div>
      </aside>
    </div>
    <footer>AUCTOZ <span>/</span> ENGINE ONLINE</footer>
  </main>;
}