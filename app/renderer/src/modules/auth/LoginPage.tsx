import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Lock, Check, AlertTriangle } from 'lucide-react';

import { useAuth } from '../../shared/context/AuthContext';
import { es } from '../../shared/i18n';

export function LoginPage(): JSX.Element {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLocked, setIsLocked] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setIsLocked(false);

    try {
      await login(username, password);
      navigate('/dashboard');
    } catch (err) {
      const msg = err instanceof Error ? err.message : es.errors.unknown;
      setError(msg);
      setIsLocked(msg.includes('bloqueada') || msg.includes('bloqueado'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '24px',
        position: 'relative',
        background:
          'radial-gradient(circle at 15% 20%, rgba(70, 95, 255, 0.10), transparent 45%), radial-gradient(circle at 85% 80%, rgba(245, 158, 11, 0.08), transparent 40%), linear-gradient(180deg, #f9fafb 0%, #eef2ff 100%)',
        overflow: 'hidden',
      }}
    >
      <div className="tc-grain-overlay" />

      {/* Decorative blobs */}
      <div style={{ position: 'absolute', top: '-10%', left: '-5%', width: 380, height: 380, background: 'var(--gradient-brand)', opacity: 0.12, borderRadius: '50%', filter: 'blur(20px)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: '-12%', right: '-8%', width: 420, height: 420, background: 'var(--gradient-amber)', opacity: 0.10, borderRadius: '50%', filter: 'blur(20px)', pointerEvents: 'none' }} />

      <div
        className="tc-card tc-stagger"
        style={{
          width: 'min(440px, 100%)',
          padding: '40px',
          position: 'relative',
          zIndex: 1,
          boxShadow: 'var(--shadow-2xl)',
        }}
      >
        {/* Accent top border */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 5, background: 'var(--gradient-brand)', borderTopLeftRadius: 'var(--radius-2xl)', borderTopRightRadius: 'var(--radius-2xl)' }} />

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div
            style={{
              width: '60px',
              height: '60px',
              borderRadius: 'var(--radius-xl)',
              background: 'var(--gradient-primary)',
              color: '#fff',
              display: 'inline-grid',
              placeItems: 'center',
              fontSize: '24px',
              fontWeight: 800,
              marginBottom: '18px',
              boxShadow: '0 8px 20px rgba(54, 65, 245, 0.35)',
            }}
            className="animate-fadeUp"
          >
            TC
          </div>
          <h1 className="tc-display" style={{ margin: 0, fontSize: '26px', fontWeight: 800, color: 'var(--gray-900)', letterSpacing: '-0.02em' }}>
            {es.app.name}
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: '14px', color: 'var(--gray-500)' }}>
            {es.app.tagline}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="tc-field" style={{ marginBottom: 0 }}>
            <label className="tc-label">{es.auth.username}</label>
            <div style={{ position: 'relative' }}>
              <User size={18} style={{ position: 'absolute', left: 'var(--space-4)', top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)' }} aria-hidden="true" />
              <input
                className="tc-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={es.auth.username}
                autoComplete="username"
                style={{ paddingLeft: 44 }}
              />
            </div>
          </div>

          <div className="tc-field" style={{ marginBottom: 0 }}>
            <label className="tc-label">{es.auth.password}</label>
            <div style={{ position: 'relative' }}>
              <Lock size={18} style={{ position: 'absolute', left: 'var(--space-4)', top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)' }} aria-hidden="true" />
              <input
                className="tc-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={es.auth.password}
                autoComplete="current-password"
                style={{ paddingLeft: 44 }}
              />
            </div>
          </div>

          {error && (
            <div
              className={`tc-notice ${isLocked ? 'tc-notice--error' : 'tc-notice--warning'}`}
              style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: isLocked ? '14px 16px' : '12px 16px' }}
              role="alert"
            >
              {isLocked ? <AlertTriangle size={20} /> : <AlertTriangle size={18} />}
              <span>{error}</span>
            </div>
          )}

          <button type="submit" className="tc-btn tc-btn-primary tc-btn-lg" style={{ minHeight: '50px', fontSize: '15px' }} disabled={loading}>
            {loading ? es.common.loading : es.auth.loginButton}
          </button>
        </form>

        {/* Highlights */}
        <div style={{ marginTop: '32px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {Object.values(es.auth.highlights).map((item) => (
            <div
              key={item}
              className="tc-badge tc-badge--info"
              style={{
                justifyContent: 'flex-start',
                gap: '10px',
                padding: '10px 14px',
                borderRadius: 'var(--radius-xl)',
                fontSize: '13px',
                fontWeight: 500,
              }}
            >
              <Check size={15} style={{ color: 'var(--primary)' }} />
              {item}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
