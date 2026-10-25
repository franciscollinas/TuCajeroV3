import { useEffect, useState } from 'react';
import { resolveLogoSource } from '../utils/logo-source';

interface BusinessAvatarProps {
  businessName?: string;
  logo?: string;
  size?: number;
}

/**
 * Cuadro del negocio en el encabezado: muestra su logo y, si no hay logo o no carga (sin internet,
 * ruta equivocada), la inicial del nombre.
 */
export function BusinessAvatar({ businessName, logo, size = 44 }: BusinessAvatarProps): JSX.Element {
  const source = resolveLogoSource(logo);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [source]);

  const showLogo = source !== null && !failed;
  const initial = businessName ? businessName.charAt(0).toUpperCase() : 'TC';

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 'var(--radius-lg)',
        background: showLogo ? '#fff' : businessName ? 'var(--gradient-primary)' : '#f3f4f6',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontSize: 16,
        fontWeight: 800,
        border: '2px solid var(--gray-100)',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {showLogo ? (
        <img
          src={source}
          alt={businessName ? `Logo de ${businessName}` : 'Logo del negocio'}
          onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      ) : (
        initial
      )}
    </div>
  );
}
