'use client';

import React, { useState } from 'react';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import AppShell, { ActiveTab } from '@/components/AppShell';
import LoginView from '@/components/auth/LoginView';
import AdminWorkspace from '@/components/admin/AdminWorkspace';
import DevDashboard from '@/components/dev/DevDashboard';
import SettingsView from '@/components/settings/SettingsView';
import AboutView from '@/components/about/AboutView';

function MainApp() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('projects');
  const { user, role } = useAuth();

  // If user is not logged in, show Login Screen (or About tab if clicked)
  if (!user) {
    return (
      <AppShell activeTab={activeTab} onTabChange={setActiveTab}>
        {activeTab === 'about' ? <AboutView /> : <LoginView />}
      </AppShell>
    );
  }

  return (
    <AppShell activeTab={activeTab} onTabChange={setActiveTab}>
      {activeTab === 'projects' && (
        role === 'admin' ? <AdminWorkspace /> : <DevDashboard />
      )}
      {activeTab === 'settings' && <SettingsView />}
      {activeTab === 'about' && <AboutView />}
    </AppShell>
  );
}

export default function Home() {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}
