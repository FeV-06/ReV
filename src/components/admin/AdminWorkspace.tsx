'use client';

import React, { useEffect, useState } from 'react';
import HandoverWizard from '@/components/admin/HandoverWizard';
import ProjectList from '@/components/admin/ProjectList';

type AdminViewMode = 'projects' | 'wizard';

export default function AdminWorkspace() {
  const [viewMode, setViewMode] = useState<AdminViewMode>('projects');

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

  function switchMode(mode: AdminViewMode) {
    setViewMode(mode);
    try {
      localStorage.setItem('rev_admin_view', mode);
    } catch {
      // Ignore
    }
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
            <span className="m3-tab-ico">📁</span>
            <span>Projects & Runs</span>
          </button>

          <button
            type="button"
            className={`m3-admin-tab ${viewMode === 'wizard' ? 'active' : ''}`}
            onClick={() => switchMode('wizard')}
          >
            <span className="m3-tab-ico">➕</span>
            <span>New Handover Studio</span>
          </button>
        </div>

        {viewMode === 'projects' && (
          <button
            type="button"
            className="m3-primary-pill-btn"
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
        <ProjectList
          onStartNewHandover={() => switchMode('wizard')}
          onOpenRunInWizard={() => switchMode('wizard')}
        />
      ) : (
        <HandoverWizard
          onBackToProjects={() => switchMode('projects')}
        />
      )}
    </div>
  );
}
