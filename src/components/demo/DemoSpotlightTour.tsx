'use client';

import { PanelRightOpen, X, Zap } from 'lucide-react';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';

const technicalStages = {
  contributor: {
    title: 'Stage 1: Contributor Grounding',
    subtitle: 'Strict Identity Attribution',
    description: 'ReV binds engineering handovers to verified contributor identities without inferring or guessing commit attribution. Context and roles are treated as untrusted data, never prompt instructions.',
  },
  evidence: {
    title: 'Stage 2: Tree-Sitter AST Symbol Extraction',
    subtitle: 'Fine-Grained Code & Diff Evidence',
    description: 'The native Rust core parses commit diffs into exact AST symbols (functions, structs, types). The reviewer chooses exactly which commits and discussions can be shared.',
  },
  review: {
    title: 'Stage 3: Citation Integrity & Departure Interview',
    subtitle: 'Exact Substrings & Proactive Gaps',
    description: 'Every synthesized claim strictly cites an exact, non-empty substring from authorized sources. Unresolved architectural or failure recovery decisions are automatically queued into the Departure Interview.',
  },
  export: {
    title: 'Stage 4: Storage Sovereignty & Successor Handoff',
    subtitle: 'Local PGlite vs. Cloud Supabase',
    description: 'Handovers remain local in PGlite by default for complete data sovereignty, with an optional toggle for cloud sync. Ready for one-click Markdown export and successor checklist tracking.',
  },
};

const guidance = {
  studio: [technicalStages.contributor, 'Click “New Handover Studio” to start the demo.'],
  launch: [technicalStages.contributor, 'Click “Launch Instant Demo Run” to import sample evidence.'],
  sources: [technicalStages.evidence, 'Check a source to include it in the handover.'],
  authorise: [technicalStages.evidence, 'Check “I confirm the recipient may receive all selected material.”'],
  generate: [technicalStages.evidence, 'Click “Generate draft” to turn the selected evidence into a handover.'],
  'review-access': [technicalStages.review, 'Review the claims and citations, then confirm the selected sources are authorised for this recipient.'],
  'save-review': [technicalStages.review, 'Click “Save review” to save your edits before approving.'],
  approve: [technicalStages.review, 'Click “Approve current revision” when you are satisfied with the review.'],
  download: [technicalStages.export, 'Click “Download Markdown” to save the approved handover.'],
} as const;

export type DemoTourTarget = keyof typeof guidance;

export default function DemoSpotlightTour({ target }: { target: DemoTourTarget | null }) {
  const { evalMode, tourActive, setTourActive } = useAuth();
  const active = evalMode === 'demo' && tourActive;

  useEffect(() => {
    if (!active || !target) return;
    document.querySelector(`[data-demo-spotlight="${target}"]`)?.scrollIntoView({ block: 'center' });
  }, [active, target]);

  if (evalMode !== 'demo') return null;
  if (!active) {
    return (
      <button type="button" className="m3-tour-open" onClick={() => setTourActive(true)}>
        <PanelRightOpen size={16} aria-hidden="true" /> Open guided demo
      </button>
    );
  }
  const step = target ? guidance[target] : null;

  return (
    <aside className="m3-tour-banner" aria-label="Guided demo">
      <div className="m3-tour-header">
        <div className="m3-tour-pill"><Zap size={16} aria-hidden="true" /> GUIDED DEMO</div>
        <button type="button" className="m3-tour-dismiss" onClick={() => setTourActive(false)} aria-label="Close guided demo">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="m3-tour-body" aria-live="polite">
        {step ? (
          <>
            <h4>{step[0].title}</h4>
            <strong className="m3-tour-subtitle">{step[0].subtitle}</strong>
            <p>{step[0].description}</p>
            <div className="m3-tour-instruction">{step[1]}</div>
          </>
        ) : <p>The guide will resume when the next action is ready.</p>}
      </div>
    </aside>
  );
}
