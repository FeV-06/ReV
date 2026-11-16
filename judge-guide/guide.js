const steps = [
  {
    verb: 'START WITH EVIDENCE', title: 'Bring the history together.',
    description: 'Choose Launch Admin Studio Demo, then Launch Instant Demo Run to open a prepared snapshot of public ReV commits. For a live run, import authorised local Git, GitHub or connected Slack material.',
    cue: 'The Import screen and the Instant Demo action.', foot: 'Prepared demo ≠ live model inference',
  },
  {
    verb: 'CHOOSE THE SCOPE', title: 'Decide what can be shared.',
    description: 'In Select sources, choose the evidence the recipient is allowed to see. Confirm your access and, for a live model request, consent to send the selected text to the configured provider.',
    cue: 'Source selection and the access confirmation.', foot: 'Only use material you are authorised to share',
  },
  {
    verb: 'KEEP A PERSON IN THE LOOP', title: 'Read the draft against its sources.',
    description: 'Generate the draft, expand the claims, inspect their references and edit, exclude or flag what needs attention. Approve the current revision only when you are satisfied with it.',
    cue: 'Claim categories, quoted references and Approve current revision.', foot: 'A verified quote is not the same as a verified interpretation',
  },
  {
    verb: 'CARRY CONTEXT FORWARD', title: 'Make the handover useful.',
    description: 'After approval, export the handover as Markdown or share it with a successor. The successor view is where a recipient can read an approved handover and ask questions about its evidence.',
    cue: 'The Export stage and the successor experience.', foot: 'Changes can require another review',
  },
];

const nodes = {
  dashboard: {
    kicker: 'INTERFACE / BROWSER', title: 'Dashboard',
    description: 'The React / Next.js workspace presents the handover wizard: import, source selection, review and export. Next.js API routes forward requests to the daemon.',
    note: 'The browser is the interface, not the database or the model.',
    url: 'https://github.com/FeV-06/ReV/blob/main/src/components/admin/HandoverWizard.tsx',
  },
  daemon: {
    kicker: 'LOCAL COORDINATION / NODE.JS', title: 'Daemon',
    description: 'The local Node.js process validates requests, coordinates imports and generation, and manages handover state. Browser API routes forward requests to it; the extension connects to it too.',
    note: 'It listens on loopback and uses a local bearer token. A running guide does not mean the daemon is running.',
    url: 'https://github.com/FeV-06/ReV/blob/main/src/daemon/entry.ts',
  },
  core: {
    kicker: 'ENGINE / RUST', title: 'Rust core',
    description: 'The daemon invokes the Rust core as a child process. It builds provider requests, parses replies, checks quoted citations against sources, and handles GitHub import and analysis operations.',
    note: 'The model writes the draft; Rust checks quote presence. Neither replaces human judgment.',
    url: 'https://github.com/FeV-06/ReV/blob/main/crates/rev-core/src/main.rs',
  },
  storage: {
    kicker: 'STATE / PGLITE', title: 'Storage',
    description: 'PGlite stores runs, sources, drafts and review state locally, under .rev-data by default. Supabase team sync is optional and depends on configuration and consent.',
    note: 'Local storage and optional team sync are distinct. This guide does not inspect either.',
    url: 'https://github.com/FeV-06/ReV/blob/main/src/lib/server/store.ts',
  },
  extension: {
    kicker: 'INTERFACE / EDITOR', title: 'VS Code extension',
    description: 'The extension opens a ReV panel and offers commands to register a workspace, scan it, and create, approve or export a handover. It talks to the local daemon.',
    note: 'A second interface to the workflow, rather than a separate handover engine.',
    url: 'https://github.com/FeV-06/ReV/blob/main/editors/vscode/src/extension.ts',
  },
};

const byId = (id) => document.getElementById(id);
const stepButtons = [...document.querySelectorAll('[data-step]')];
const nodeButtons = [...document.querySelectorAll('[data-node]')];
let currentStep = 0;

function showStep(index) {
  currentStep = Math.max(0, Math.min(steps.length - 1, index));
  const step = steps[currentStep];
  byId('step-counter').textContent = `STEP ${String(currentStep + 1).padStart(2, '0')} / ${String(steps.length).padStart(2, '0')}`;
  byId('step-verb').textContent = step.verb;
  byId('step-title').textContent = step.title;
  byId('step-description').textContent = step.description;
  byId('step-cue').textContent = step.cue;
  byId('step-foot').textContent = step.foot;
  byId('prev-step').disabled = currentStep === 0;
  byId('next-step').disabled = currentStep === steps.length - 1;
  stepButtons.forEach((button, index) => {
    button.classList.toggle('is-active', index === currentStep);
    button.setAttribute('aria-pressed', String(index === currentStep));
  });
}

stepButtons.forEach((button) => button.addEventListener('click', () => showStep(Number(button.dataset.step))));
byId('prev-step').addEventListener('click', () => showStep(currentStep - 1));
byId('next-step').addEventListener('click', () => showStep(currentStep + 1));

function showNode(key) {
  const node = nodes[key];
  if (!node) return;
  byId('node-kicker').textContent = node.kicker;
  byId('node-title').textContent = node.title;
  byId('node-description').textContent = node.description;
  byId('node-note').textContent = node.note;
  byId('node-link').href = node.url;
  nodeButtons.forEach((button) => {
    const active = button.dataset.node === key;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}
nodeButtons.forEach((button) => button.addEventListener('click', () => showNode(button.dataset.node)));
