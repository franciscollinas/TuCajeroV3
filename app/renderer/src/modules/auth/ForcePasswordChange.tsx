import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Lock } from 'lucide-react';

import { trpc } from '../../trpc';
import { useAuth } from '../../shared/context/AuthContext';

/** Mismas reglas que el servidor (app/main/utils/password.ts); el servidor es quien manda. */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (!/[A-Z]/.test(password)) return 'La contraseña debe contener al menos una letra mayúscula.';
  if (!/[a-z]/.test(password)) return 'La contraseña debe contener al menos una letra minúscula.';
  if (!/[0-9]/.test(password)) return 'La contraseña debe contener al menos un número.';
  return null;
}

/**
 * Pantalla que ocupa toda la aplicación mientras el usuario tenga la contraseña inicial.
 * Las cuentas de fábrica (admin / cajero1) comparten la misma clave en todas las
 * instalaciones, así que no se puede trabajar hasta cambiarla.
 */
export function ForcePasswordChange(): JSX.Element {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError('');

    const problem = passwordProblem(newPassword);
    if (problem) {
      setError(problem);
      return;
    }
    if (newPassword !== repeatPassword) {
      setError('Las dos contraseñas nuevas no coinciden.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('La contraseña nueva debe ser distinta de la actual.');
      return;
    }

    setSaving(true);
    try {
      await trpc.auth.changePassword.mutate({ currentPassword, newPassword });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar la contraseña.');
      setSaving(false);
      return;
    }
    // El servidor cierra todas las sesiones al cambiarla: se vuelve a entrar con la nueva.
    try {
      await logout();
    } catch {
      // La sesión ya no existe en el servidor; basta con limpiar la pantalla.
    }
    navigate('/login', { replace: true, state: { passwordChanged: true } });
  };

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '24px', background: 'linear-gradient(180deg, #f9fafb 0%, #eef2ff 100%)' }}>
      <div className="tc-card" style={{ width: 'min(460px, 100%)', padding: '36px', boxShadow: 'var(--shadow-2xl)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <div style={{ width: 44, height: 44, borderRadius: 'var(--radius-lg)', background: 'var(--brand-50)', color: 'var(--brand-600)', display: 'grid', placeItems: 'center' }}>
            <Lock size={22} aria-hidden="true" />
          </div>
          <h1 className="tc-display" style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: 'var(--gray-900)' }}>Crea tu contraseña</h1>
        </div>
        <p style={{ margin: '0 0 20px', color: 'var(--gray-600)', fontSize: '14px', lineHeight: 1.5 }}>
          {user ? `Hola, ${user.fullName}. ` : ''}La contraseña inicial es la misma en todas las instalaciones de TuCajero. Cámbiala ahora para proteger tu caja y tus ventas.
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="tc-field" style={{ marginBottom: 0 }}>
            <label className="tc-label" htmlFor="current-password">Contraseña actual</label>
            <input id="current-password" className="tc-input" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoFocus required />
          </div>
          <div className="tc-field" style={{ marginBottom: 0 }}>
            <label className="tc-label" htmlFor="new-password">Contraseña nueva</label>
            <input id="new-password" className="tc-input" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} aria-describedby="password-rules" required />
            <p id="password-rules" style={{ margin: '6px 0 0', fontSize: '12px', color: 'var(--gray-500)' }}>Mínimo 8 caracteres, con una mayúscula, una minúscula y un número.</p>
          </div>
          <div className="tc-field" style={{ marginBottom: 0 }}>
            <label className="tc-label" htmlFor="repeat-password">Repite la contraseña nueva</label>
            <input id="repeat-password" className="tc-input" type="password" autoComplete="new-password" value={repeatPassword} onChange={(e) => setRepeatPassword(e.target.value)} required />
          </div>

          {error && (
            <div className="tc-notice tc-notice--warning" role="alert" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px' }}>
              <AlertTriangle size={18} />
              <span>{error}</span>
            </div>
          )}

          <button type="submit" className="tc-btn tc-btn-primary tc-btn-lg" style={{ minHeight: '48px' }} disabled={saving}>
            {saving ? 'Guardando...' : 'Guardar y volver a entrar'}
          </button>
          <button type="button" onClick={() => { void logout().catch(() => undefined); }} style={{ background: 'none', border: 'none', color: 'var(--gray-500)', fontSize: '13px', cursor: 'pointer', textDecoration: 'underline' }}>
            Cerrar sesión
          </button>
        </form>
      </div>
    </main>
  );
}
