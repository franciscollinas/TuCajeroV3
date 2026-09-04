import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../shared/context/AuthContext';
import { useLicense } from '../../shared/context/LicenseContext';
import { es } from '../../shared/i18n';
import type { UserRole } from '../../shared/types/auth.types';

interface ProtectedRouteProps {
  children: JSX.Element;
  roles?: UserRole[];
}

export function ProtectedRoute({ children, roles }: ProtectedRouteProps): JSX.Element {
  const location = useLocation();
  const { isReady, user, isAuthorized } = useAuth();
  const { isBlocked, isLoading: licenseLoading } = useLicense();

  if (!isReady || licenseLoading) {
    return <div className="flex items-center justify-center h-screen text-gray-500">{es.common.loading}</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (isBlocked && location.pathname !== '/license') {
    return <Navigate to="/license" replace />;
  }

  if (roles && !isAuthorized(roles)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
