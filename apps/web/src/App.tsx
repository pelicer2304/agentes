import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { PageLayout } from '@/components/layout/PageLayout';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { LoginPage } from '@/pages/LoginPage';
import { PlaygroundPage } from '@/pages/PlaygroundPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { LeadsPage } from '@/pages/LeadsPage';
import { LeadDetailPage } from '@/pages/LeadDetailPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { WhatsAppPage } from '@/pages/WhatsAppPage';
import { InboxPage } from '@/pages/InboxPage';
import { ConversationDetailPage } from '@/pages/ConversationDetailPage';
import { BotPage } from '@/pages/BotPage';
import { LogsPage } from '@/pages/LogsPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public route */}
        <Route path="/login" element={<LoginPage />} />

        {/* Protected routes — additional routes (15.3-15.6) go inside this AuthGuard */}
        <Route element={<AuthGuard />}>
          <Route element={<PageLayout />}>
            <Route path="/" element={<PlaygroundPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/whatsapp" element={<WhatsAppPage />} />
            <Route path="/conversas" element={<InboxPage />} />
            <Route path="/conversas/:id" element={<ConversationDetailPage />} />
            <Route path="/leads" element={<LeadsPage />} />
            <Route path="/leads/:id" element={<LeadDetailPage />} />
            <Route path="/bot" element={<BotPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/logs" element={<LogsPage />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
