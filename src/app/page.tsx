'use client';

import React, { useState } from 'react';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import AppShell, { ActiveTab } from '@/components/AppShell';
import LoginView from '@/components/auth/LoginView';
import AdminWorkspace from '@/components/admin/AdminWorkspace';
import DepartingWorkspace from '@/components/DepartingWorkspace';
import DevDashboard from '@/components/dev/DevDashboard';
import SettingsView from '@/components/settings/SettingsView';
import AboutView from '@/components/about/AboutView';

function MainApp() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('projects');
  const { user, role } = useAuth();

  // If user is not logged in, render the standalone full-bleed LoginView (no top nav, header, or footer)
  if (!user) {
    return <LoginView />;
  }

  return (
    <AppShell activeTab={activeTab} onTabChange={setActiveTab}>
      {activeTab === 'projects' && (
        role === 'admin' ? <AdminWorkspace /> : role === 'departing' ? <DepartingWorkspace /> : <DevDashboard />
      )}
      {activeTab === 'settings' && (role === 'departing' ? <DepartingWorkspace /> : <SettingsView />)}
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
