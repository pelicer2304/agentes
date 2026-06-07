import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export function PageLayout() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Sidebar />
      <main className="ml-60 min-h-screen">
        <Outlet />
      </main>
    </div>
  );
}
