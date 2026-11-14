'use client';

import { Folder, Plus } from 'lucide-react';
import DemoSpotlightTour from '@/components/demo/DemoSpotlightTour';
import { useAuth } from '@/lib/auth-context';
import React, { useEffect, useState } from 'react';
import HandoverWizard from '@/components/admin/HandoverWizard';
import ProjectList from '@/components/admin/ProjectList';

type AdminViewMode = 'projects' | 'wizard';

export default function AdminWorkspace() {
  const { evalMode, tourActive } = useAuth();
  const [viewMode, setViewMode] = useState<AdminViewMode>('projects');
  const showStudioGuide = viewMode === 'projects' && evalMode === 'demo' && tourActive;
  // Run explicitly opened from the projects list ("Edit in Studio"); null = fresh studio.
  const [wizardRunId, setWizardRunId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('rev_admin_view');
      if (saved === 'wizard' || saved === 'projects') {
        setViewMode(saved);
      }
    } catch {
      // Ignore
    }
  }, []);

  function persistView(mode: AdminViewMode) {
    try {
      localStorage.setItem('rev_admin_view', mode);
    } catch {
      // Ignore
    }
  }

  function switchMode(mode: AdminViewMode) {
    // Reaching the studio via the tab/pill always starts without a preloaded run.
    if (mode === 'wizard') setWizardRunId(null);
    setViewMode(mode);
    persistView(mode);
  }

  function openRunInWizard(runId: string) {
    setWizardRunId(runId);
    setViewMode('wizard');
    persistView('wizard');
  }

  return (
    <div className="m3-admin-layout">
      {/* View Switcher Top Bar */}
      <div className="m3-admin-nav-bar">
        <div className="m3-admin-nav-cluster">
          <button
            type="button"
            className={`m3-admin-tab ${viewMode === 'projects' ? 'active' : ''}`}
            onClick={() => switchMode('projects')}
          >
            <span className="m3-tab-ico"><Folder size={16} aria-hidden="true" /></span>
            <span>Projects & Runs</span>
          </button>

          <button
            type="button"
            className={`m3-admin-tab ${viewMode === 'wizard' ? 'active' : ''}`}
            data-demo-spotlight={showStudioGuide ? 'studio' : undefined}
            onClick={() => switchMode('wizard')}
          >
            <span className="m3-tab-ico"><Plus size={16} aria-hidden="true" /></span>
            <span>New Handover Studio</span>
          </button>
        </div>

        {viewMode === 'projects' && (
          <button
            type="button"
            className="m3-primary-pill-btn m3e-button"
            onClick={() => switchMode('wizard')}
          >
            <span>+</span> Start New Handover
          </button>
        )}

        {viewMode === 'wizard' && (
          <button
            type="button"
            className="m3-subtle-btn"
            onClick={() => switchMode('projects')}
          >
            ← Back to Projects List
          </button>
        )}
      </div>

      {/* Main Content Area */}
      {viewMode === 'projects' ? (
        <div className="m3-guided-workspace">
          <DemoSpotlightTour target="studio" />
          <ProjectList
            onOpenRunInWizard={openRunInWizard}
          />
        </div>
      ) : (
        <HandoverWizard
          onBackToProjects={() => switchMode('projects')}
          initialRunId={wizardRunId}
        />
      )}
    </div>
  );
}
