import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

export interface AuthGuardProps {
  /**
   * Optional children. When provided they are rendered for authenticated
   * users; otherwise an <Outlet /> is used so the guard can wrap a set of
   * nested routes.
   */
  children?: React.ReactNode;
}

/**
 * Guards protected routes. When the user is not authenticated they are
 * redirected to /login, preserving the attempted location so the app can
 * return them there after a successful login.
 */
export function AuthGuard({ children }: AuthGuardProps) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children ?? <Outlet />}</>;
}
