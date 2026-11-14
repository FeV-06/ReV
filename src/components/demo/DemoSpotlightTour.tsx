'use client';

import { PanelRightOpen, X, Zap } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';

const guidance = {
  studio: ['Start a handover', 'Click “New Handover Studio” to start the demo.'],
  launch: ['Launch the demo', 'Click “Launch Instant Demo Run” to import sample evidence.'],
  sources: ['Choose evidence', 'Check a source to include it in the handover.'],
  authorise: ['Confirm recipient access', 'Check “I confirm the recipient may receive all selected material.”'],
  generate: ['Generate a draft', 'Click “Generate draft” to turn the selected evidence into a handover.'],
  'review-access': ['Confirm your review', 'Review the claims and citations, then confirm the selected sources are authorised for this recipient.'],
  'save-review': ['Save your changes', 'Click “Save review” to save your edits before approving.'],
  approve: ['Approve the handover', 'Click “Approve current revision” when you are satisfied with the review.'],
  download: ['Download the handover', 'Click “Download Markdown” to save the approved handover.'],
} as const;

export type DemoTourTarget = keyof typeof guidance;

type Topic = { title: string; text: string; anchor?: string; prompt?: string };

const chapters: Record<string, Topic[]> = {
  studio: [
    { title: 'Browse projects and previous runs', anchor: 'projects', text: 'Open a run to check its status or read its approved handover.' },
  ],
  launch: [
    { title: 'Connect Slack', anchor: 'slack', text: 'Sign in to Slack and pick up to five channels to import messages and replies. The demo uses sample messages.' },
    { title: 'Assign a successor', anchor: 'setup', text: 'Click Assign successor and enter their sign-in email. To try the demo reader later, use alex.vance@team.internal.' },
  ],
  sources: [
    { title: 'Scope the handover', anchor: 'scope', text: 'Describe what the successor is taking over, then select the sources they can receive.' },
  ],
  review: [
    { title: 'Review claims and citations', anchor: 'claims', text: 'Check the source excerpts. Edit or exclude anything that needs changing, then click Save review.' },
    { title: 'Try the Departure Interview', anchor: 'interview', text: 'Click Prepare interview questions to ask the departing teammate about missing details. Choose which answers to share.' },
    { title: 'Save the successor assignment', anchor: 'assignment', text: 'Save the successor’s sign-in email so they can find this handover. Leave it blank if you only need a download.' },
    { title: 'Inspect evidence gaps', anchor: 'gaps', text: 'Click Detect Evidence Gaps to find details worth checking before you approve.' },
  ],
  download: [
    { title: 'Inspect ownership and churn', anchor: 'risk', text: 'For a local Git run, see which frequently changed files depend heavily on one contributor.' },
    { title: 'Choose where the handover is stored', anchor: 'storage', text: 'Keep the handover on this computer or use your configured team database.' },
    { title: 'Publish the approved handover', anchor: 'publish', text: 'Click Publish to Successor Portal. Try the Successor Reader Demo to see the handover and Day 1 checklist.' },
    { title: 'Try MCP in VS Code', text: 'With ReV enabled in Copilot, paste this prompt into Agent chat.', prompt: 'Use rev_admin_list_active_projects to list my ReV runs. Include each full run ID, recipient, and status.' },
  ],
};

function chapterFor(target: DemoTourTarget | null) {
  if (target === 'authorise' || target === 'generate') return 'sources';
  if (target === 'review-access' || target === 'save-review' || target === 'approve') return 'review';
  return target;
}

function positionGuide(panel: HTMLElement, section: Element, anchor: Element) {
  const gap = 16;
  const target = section.getBoundingClientRect();
  const control = anchor.getBoundingClientRect();
  const { width, height } = panel.getBoundingClientRect();
  const right = window.innerWidth - width - gap;
  const bottom = window.innerHeight - height - gap;
  const top = Math.min(bottom, Math.max(gap, control.top));
  const centered = Math.min(right, Math.max(gap, target.left + (target.width - width) / 2));
  const candidates = [
    { left: target.right + gap, top },
    { left: target.left - width - gap, top },
    { left: centered, top: target.bottom + gap },
    { left: centered, top: target.top - height - gap },
  ];
  const placement = candidates.find(point =>
    point.left >= gap && point.left <= right && point.top >= gap && point.top <= bottom
  );
  if (!placement) {
    panel.dataset.docked = 'true';
    return;
  }
  panel.style.left = `${placement.left}px`;
  panel.style.top = `${placement.top}px`;
  panel.style.right = 'auto';
  panel.style.bottom = 'auto';
}

export default function DemoSpotlightTour({ target }: { target: DemoTourTarget | null }) {
  const { evalMode, tourActive, setTourActive } = useAuth();
  const active = evalMode === 'demo' && tourActive;
  const panelRef = useRef<HTMLElement>(null);
  const chapter = chapterFor(target);
  const [positions, setPositions] = useState<Record<string, number>>({});
  const lessons = chapter ? chapters[chapter] : undefined;
  const index = chapter ? positions[chapter] ?? 0 : 0;
  const topic = lessons?.[index];

  function goTo(next: number) {
    if (chapter) setPositions(previous => ({ ...previous, [chapter]: next }));
  }

  useEffect(() => {
    if (!active || !target) return;
    const selector = topic?.anchor
      ? `[data-tour-detail="${topic.anchor}"]`
      : `[data-demo-spotlight="${target}"]`;
    const section = document.querySelector(selector);
    const panel = panelRef.current;
    if (!section || !panel) return;
    const element = section.querySelector('[data-tour-control]') ?? section;
    for (let parent: Element | null = element; parent; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    }
    section.setAttribute('data-tour-current', topic ? 'info' : 'action');
    element.scrollIntoView({ block: 'center', behavior: 'instant' });
    const update = () => {
      if (!panel.dataset.docked) positionGuide(panel, section, element);
    };
    const resize = () => {
      delete panel.dataset.docked;
      update();
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(panel);
    observer.observe(element);
    observer.observe(section);
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', update, { capture: true, passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', update, true);
      section.removeAttribute('data-tour-current');
      delete panel.dataset.docked;
      for (const property of ['left', 'top', 'right', 'bottom']) panel.style.removeProperty(property);
    };
  }, [active, target, topic]);

  if (evalMode !== 'demo') return null;
  if (!active) {
    return (
      <button type="button" className="m3-tour-open m3e-button m3e-button--tonal" onClick={() => setTourActive(true)}>
        <PanelRightOpen size={16} aria-hidden="true" /> Open guided demo
      </button>
    );
  }
  const step = target ? guidance[target] : null;

  return (
    <aside ref={panelRef} className="m3-tour-banner" data-requires-action={Boolean(target && !topic)} aria-label="Guided demo">
      <div className="m3-tour-header">
        <div className="m3-tour-pill"><Zap size={16} aria-hidden="true" /> Guided demo</div>
        <button type="button" className="m3-tour-dismiss" onClick={() => setTourActive(false)} aria-label="Close guided demo">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="m3-tour-body" aria-live="polite">
        {step ? (
          <>
            <h4>{topic?.title ?? step[0]}</h4>
            <div className="m3-tour-instruction">
              <div>{topic?.text ?? step[1]}</div>
              {topic?.prompt && <textarea aria-label="VS Code MCP prompt" readOnly value={topic.prompt} onFocus={event => event.target.select()} />}
            </div>
          </>
        ) : <p>The guide will resume when the next action is ready.</p>}
      </div>
      {lessons && (
        <nav className="m3-tour-controls" aria-label="Guide steps">
          <span>{index + 1} of {lessons.length + 1}</span>
          <button type="button" className="secondary m3e-button m3e-button--tonal" disabled={index === 0} onClick={() => goTo(index - 1)}>Back</button>
          <button type="button" className="secondary m3e-button m3e-button--tonal m3-tour-next" disabled={!topic} onClick={() => goTo(index + 1)}>Next step</button>
        </nav>
      )}
    </aside>
  );
}
