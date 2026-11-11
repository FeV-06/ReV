'use client';

import React from 'react';
import { useAuth } from '@/lib/auth-context';

const TOUR_STEPS = [
  {
    step: 1,
    title: 'Stage 1: Contributor Grounding',
    subtitle: 'Strict Identity Attribution',
    description:
      'ReV binds engineering handovers to verified contributor identities without inferring or guessing commit attribution. Context and roles are treated as untrusted data, never prompt instructions.',
    instruction: '👉 Click "⚡ Launch Instant Demo Run →" in the main panel to start the automated walkthrough.',
  },
  {
    step: 2,
    title: 'Stage 2: Tree-Sitter AST Symbol Extraction',
    subtitle: 'Fine-Grained Code & Diff Evidence',
    description:
      'The native Rust core parses commit diffs into exact AST symbols (functions, structs, types). The reviewer chooses exactly which commits and discussions can be shared.',
    instruction: '👉 Check "I confirm recipient may receive all selected material" and click "Generate draft →".',
  },
  {
    step: 3,
    title: 'Stage 3: Citation Integrity & Departure Interview',
    subtitle: 'Exact Substrings & Proactive Gaps',
    description:
      'Every synthesized claim strictly cites an exact, non-empty substring from authorized sources. Unresolved architectural or failure recovery decisions are automatically queued into the Departure Interview.',
    instruction: '👉 Review the verified claims and click "Approve current revision" to certify the handover.',
  },
  {
    step: 4,
    title: 'Stage 4: Storage Sovereignty & Successor Handoff',
    subtitle: 'Local PGlite vs. Cloud Supabase',
    description:
      'Handovers remain local in PGlite by default for complete data sovereignty, with an optional toggle for cloud sync. Ready for one-click Markdown export and successor checklist tracking.',
    instruction: '👉 Click "Download Markdown" to receive the publication-ready executive handover report.',
  },
];

export default function DemoSpotlightTour() {
  const { evalMode, tourActive, setTourActive, tourStep, setTourStep } = useAuth();

  if (evalMode !== 'demo' || !tourActive) {
    return null;
  }

  const current = TOUR_STEPS.find(s => s.step === tourStep) || TOUR_STEPS[0];

  function handleNext() {
    if (tourStep < TOUR_STEPS.length) {
      setTourStep(prev => (prev as number) + 1);
    } else {
      setTourActive(false);
    }
  }

  function handlePrev() {
    if (tourStep > 1) {
      setTourStep(prev => (prev as number) - 1);
    }
  }

  return (
    <aside
      className="m3-tour-banner"
      role="region"
      aria-label="Interactive Guided Demo Tour"
    >
      <div className="m3-tour-header">
        <div className="m3-tour-pill">
          <span className="m3-tour-pulse" aria-hidden="true" />
          <span>⚡ GUIDED TOUR · STAGE {current.step} OF {TOUR_STEPS.length}</span>
        </div>
        <button
          type="button"
          className="m3-tour-dismiss"
          onClick={() => setTourActive(false)}
          title="Dismiss guided tour"
          aria-label="Dismiss guided tour"
        >
          ✕
        </button>
      </div>

      <div className="m3-tour-body">
        <h4>{current.title}</h4>
        <div className="m3-tour-subtitle">{current.subtitle}</div>
        <p>{current.description}</p>
        <div className="m3-tour-instruction">
          {current.instruction}
        </div>
      </div>

      <div className="m3-tour-footer">
        <div className="m3-tour-dots" aria-hidden="true">
          {TOUR_STEPS.map(s => (
            <button
              key={s.step}
              type="button"
              className={`m3-tour-dot ${s.step === tourStep ? 'active' : ''}`}
              onClick={() => setTourStep(s.step)}
              title={`Jump to ${s.title}`}
            />
          ))}
        </div>

        <div className="m3-tour-actions">
          {tourStep > 1 && (
            <button
              type="button"
              className="m3-tour-btn-secondary"
              onClick={handlePrev}
            >
              ← Back
            </button>
          )}
          <button
            type="button"
            className="m3-tour-btn-primary"
            onClick={handleNext}
          >
            {tourStep === TOUR_STEPS.length ? 'Finish Tour ✓' : 'Next Stage →'}
          </button>
        </div>
      </div>
    </aside>
  );
}
