import { NavLink } from 'react-router-dom';
import {
  MessageSquare,
  Smartphone,
  Inbox,
  Users,
  Bot,
  Settings,
  ScrollText,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/', icon: MessageSquare, label: 'Playground' },
  { to: '/whatsapp', icon: Smartphone, label: 'WhatsApp' },
  { to: '/conversas', icon: Inbox, label: 'Conversas' },
  { to: '/leads', icon: Users, label: 'Leads' },
  { to: '/bot', icon: Bot, label: 'Bot' },
  { to: '/settings', icon: Settings, label: 'Configurações' },
  { to: '/logs', icon: ScrollText, label: 'Logs' },
];

export function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 h-screen w-60 bg-card border-r border-border flex flex-col z-50">
      <div className="h-14 flex items-center px-5 border-b border-border">
        <span className="text-lg font-bold text-foreground">Decodifica</span>
      </div>

      <nav className="flex-1 py-4 px-3 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                isActive
                  ? 'bg-accent-dark text-accent'
                  : 'text-muted hover:text-foreground hover:bg-border/50'
              )
            }
          >
            <item.icon size={18} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
