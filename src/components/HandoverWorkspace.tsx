'use client';
import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { dayOneItems, generationFailurePrefix, sourceWarnings, suggestedAreas } from '@/lib/handover';
import type { Item, Run } from '@/lib/contracts';
import ContributorField from '@/components/ContributorField';
import DepartureInterview from '@/components/DepartureInterview';
import ProjectDashboard from '@/components/ProjectDashboard';

type RunSummary = Pick<Run, 'id'|'createdAt'|'recipient'|'state'>;
async function api(url: string, options: RequestInit = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type':'application/json', 'X-Rev-Request':'1', ...options.headers } });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Request failed'); return data;
}
function fileAsBase64(file: File): Promise<string> {
  return new Promise((resolve,reject) => { const reader=new FileReader(); reader.onload=()=>resolve(String(reader.result).split(',')[1] || ''); reader.onerror=()=>reject(new Error('Could not read file')); reader.readAsDataURL(file); });
}
export default function HandoverWorkspace() {
  const [runs,setRuns] = useState<RunSummary[]>([]); const [run,setRun] = useState<Run|null>(null);
  const [recipient,setRecipient] = useState('Incoming engineer');
  const [departingPerson,setDepartingPerson] = useState('');
  const [targetRole,setTargetRole] = useState('');
  const [takeoverScope,setTakeoverScope] = useState('');
  const [repo,setRepo] = useState('');
  const [file,setFile] = useState<File|null>(null);
  const [selected,setSelected] = useState<string[]>([]); const [items,setItems] = useState<Item[]>([]);
  const [authorised,setAuthorised] = useState(false); const [remote,setRemote] = useState(false); const [partial,setPartial] = useState(false);
  const [sources,setSources] = useState<{localGit:string|null; gitAuthors:string[]; slack:boolean}>({localGit:null, gitAuthors:[], slack:false});
  const [useGit,setUseGit] = useState(true); const [useSlack,setUseSlack] = useState(false);
  const [slack,setSlack] = useState<{workspace:string|null; workspaceId?:string; channels:{id:string;name:string}[]}>({workspace:null, channels:[]});
  const [slackIds,setSlackIds] = useState<string[]>([]);
  const [slackError,setSlackError] = useState('');
  const [slackBusy,setSlackBusy] = useState(true);
  const [busy,setBusy] = useState(false); const [error,setError] = useState('');
  const [shareAnswers, setShareAnswers] = useState<string[]>([]);
  function toggleShare(id: string) {
    setShareAnswers(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]);
  }
  async function refresh() { const data=await api('/api/runs'); setRuns(data.runs); setSources(data.sources); }
  useEffect(()=> { refresh().catch(e=>setError(e.message)); },[]);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('slack') === 'connect') setSlackError('Click Connect Slack to continue to Slack sign-in.');
    if (url.searchParams.get('slack') === 'error') setSlackError('Slack sign-in could not be completed. Try connecting again.');
    if (url.searchParams.has('slack')) {
      url.searchParams.delete('slack');
      window.history.replaceState(null, '', url);
    }
    api('/api/slack').then(data => {
      setSlack(data);
      if (!data.workspaceId) return;
      const saved = (localStorage.getItem(`rev-slack-channels:${data.workspaceId}`) ?? '').split(',');
      setSlackIds(data.channels.filter((channel:{id:string}) => saved.includes(channel.id)).slice(0, 5).map((channel:{id:string}) => channel.id));
    }).catch(e=>setSlackError(e.message)).finally(()=>setSlackBusy(false));
  }, []);
  async function connectSlack() {
    if (window.location.hostname !== 'localhost') {
      window.location.assign('http://localhost:3077/?slack=connect');
      return;
    }
    setSlackBusy(true);
    setSlackError('');
    try {
      const data = await api('/api/slack', { method: 'POST' });
      window.location.assign(data.url);
    } catch (e) {
      setSlackError(e instanceof Error ? e.message : 'Could not start Slack sign-in.');
      setSlackBusy(false);
    }
  }
  function toggleSlackChannel(id:string) {
    const next = slackIds.includes(id) ? slackIds.filter(channel=>channel!==id) : [...slackIds,id];
    setSlackIds(next);
    if (slack.workspaceId) localStorage.setItem(`rev-slack-channels:${slack.workspaceId}`, next.join(','));
  }
  function display(r:Run) { if (r.id !== run?.id) setShareAnswers([]); setTakeoverScope(r.takeoverScope ?? ''); setRun(r); setSelected(r.selectedIds); setItems(r.items); setAuthorised(false); setRemote(false); setPartial(false); }
  async function perform(fn:()=>Promise<void>, onError?: (message: string) => void) { setBusy(true); setError(''); try { await fn(); await refresh(); } catch(e) { const message = e instanceof Error ? e.message : 'Operation failed'; if (onError) onError(message); else setError(message); if (run) { try { const latest=await api(`/api/runs/${run.id}`); display(latest.run); await refresh(); } catch {} } } finally { setBusy(false); } }
  async function create(fixture:boolean) { await perform(async()=>{
    if (!fixture && file && file.size > 10*1024*1024) throw new Error('Slack ZIP exceeds 10 MiB');
    const zipBase64=!fixture && file ? await fileAsBase64(file) : undefined;
    const result=await api('/api/runs',{method:'POST',body:JSON.stringify({recipient:recipient.trim() || undefined,departingPerson:fixture ? 'maya' : departingPerson.trim() || undefined,targetRole:fixture ? 'Platform engineer' : (targetRole.trim() || undefined),repo:fixture?undefined:repo || undefined,zipBase64,fixture,localGit:!fixture && !!sources.localGit && useGit && !repo,slackChannelIds:fixture || file ? [] : slackIds,connectedSlack:!fixture && sources.slack && useSlack && !file && !slackIds.length})}); display(result.run);
  }); }
  async function patch(body: object, onError?: (message: string) => void) {
    if (!run) return;
    let updated: Run | undefined;
    await perform(async () => {
      const data = await api(`/api/runs/${run.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      updated = data.run;
      display(data.run);
    }, onError);
    return updated;
  }
  async function updateSelection(next: string[]) {
    if (!run || busy) return;
    setSelected(next); setBusy(true); setError(''); setAuthorised(false);
    try { const d=await api(`/api/runs/${run.id}`,{method:'PATCH',body:JSON.stringify({action:'scope',selectedIds:next})}); setRun(d.run); setSelected(d.run.selectedIds); setItems(d.run.items); await refresh(); }
    catch(e) { setSelected(selected); setError(e instanceof Error ? e.message : 'Could not update source scope'); }
    finally { setBusy(false); }
  }
  function toggle(id: string) {
    return updateSelection(selected.includes(id) ? selected.filter(sourceId => sourceId !== id) : [...selected, id]);
  }
  function updateItem(id:string, changes:Partial<Item>) { setItems(old=>old.map(item=>item.id===id?{...item,...changes}:item)); }
  async function download() { if(!run)return; await perform(async()=> { const resp=await fetch(`/api/runs/${run.id}/export`,{headers:{'X-Rev-Request':'1'}}); if(!resp.ok) { const data=await resp.json(); throw new Error(data.error); } const url=URL.createObjectURL(await resp.blob()); const a=document.createElement('a'); a.href=url; a.download='rev-handover.md'; a.click(); URL.revokeObjectURL(url); }); }
  const commitIds = run?.artifacts.filter(source => source.kind === 'git_commit' || source.kind === 'github_commit').map(source => source.id) ?? [];
  const selectionWithCommits = [...new Set([...selected, ...commitIds])];
  const coverageWarnings = sourceWarnings(run?.warnings ?? []);
  const generationFailure = run?.warnings.filter(warning => warning.startsWith(generationFailurePrefix)).at(-1);
  const areas = run ? suggestedAreas(run) : [];
  const actions = run ? dayOneItems(run, items.filter(item => run.items.find(saved => saved.id === item.id)?.text === item.text)) : [];
  const scopeChanged = Boolean((run?.departingPerson || run?.githubUsername) && takeoverScope.trim() !== (run.takeoverScope ?? ''));

  function getActiveStage(): number {
    if (!run || run.state === 'importing') return 1;
    if (run.state === 'awaiting_scope_confirmation' || run.state === 'reconstructing') return 2;
    if (run.state === 'needs_review') return 3;
    if (run.state === 'approved') return 4;
    return 1;
  }
  const activeStage = getActiveStage();

  return <div className="shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark">R</span><div><strong>ReV</strong><small>Handover workspace</small></div></div><div className="side-label">WORKSPACE</div><div className="nav-current"><span>◫</span> Handover runs</div><div className="side-bottom"><span className="status-dot"/> Local workspace <small>Single operator · on demand</small></div></aside>
    <main className="main"><header className="topbar"><span>WORKSPACE / <b>HANDOVERS</b></span><span className="local-badge"><i/> LOCAL ONLY</span></header>
      <div className="content">
        <section className="hero">
          <div>
            <div className="eyebrow">KNOWLEDGE, CARRIED FORWARD</div>
            <h1>Make the next<br/><em>chapter clearer.</em></h1>
            <p>Turn scattered project activity into an evidence-linked handover, reviewed by a person before it is shared.</p>
          </div>
          <div className="hero-number">0{activeStage} <span>/ 04</span><small>{activeStage === 1 ? 'IMPORT SOURCES' : activeStage === 2 ? 'SELECT SOURCES' : activeStage === 3 ? 'REVIEW CLAIMS' : 'EXPORT HANDOVER'}</small></div>
        </section>

        <ol className="stage-stepper" aria-label="Handover progress">
          <li className={`stage-step ${activeStage > 1 ? 'completed' : ''}`} aria-current={activeStage === 1 ? 'step' : undefined}>
            <span className="stage-step-num">{activeStage > 1 ? <Check size={14} aria-hidden="true" /> : '1'}</span>
            <span>Import</span>
          </li>
          <li className={`stage-step ${activeStage > 2 ? 'completed' : ''}`} aria-current={activeStage === 2 ? 'step' : undefined}>
            <span className="stage-step-num">{activeStage > 2 ? <Check size={14} aria-hidden="true" /> : '2'}</span>
            <span>Select sources</span>
          </li>
          <li className={`stage-step ${activeStage > 3 ? 'completed' : ''}`} aria-current={activeStage === 3 ? 'step' : undefined}>
            <span className="stage-step-num">{activeStage > 3 ? <Check size={14} aria-hidden="true" /> : '3'}</span>
            <span>Review</span>
          </li>
          <li className={`stage-step ${activeStage === 4 ? 'completed' : ''}`} aria-current={activeStage === 4 ? 'step' : undefined}>
            <span className="stage-step-num">4</span>
            <span>Export</span>
          </li>
        </ol>

        {error && <div role="alert" className="error">{error}</div>}
        <div className="grid"><div className="column">
          <section className="card entry-panel"><div className="card-head"><div><div className="eyebrow">01 / CONNECT</div><h2>Start a run</h2><p>Import only material you are authorised to use.</p></div><span className="step-icon">↗</span></div>
          <ContributorField value={departingPerson} onChange={setDepartingPerson}
            authors={useGit && !repo ? sources.gitAuthors : []} repository={sources.localGit} />

          <label>Target role <span className="muted">optional</span><input value={targetRole} onChange={e=>setTargetRole(e.target.value)} maxLength={120} placeholder="Senior backend engineer"/></label>
          <details><summary>Optional settings</summary>
          <label>Incoming role<input value={recipient} onChange={e=>setRecipient(e.target.value)} maxLength={120}/></label>
          </details>
          {sources.localGit && <label className="check"><input type="checkbox" checked={useGit && !repo} disabled={!!repo || busy} onChange={e=>setUseGit(e.target.checked)}/> Use local Git history from {sources.localGit}</label>}
          <div>
            {slack.workspace && <p>Slack workspace: <strong>{slack.workspace}</strong></p>}
            <button type="button" className="secondary" disabled={slackBusy || busy} onClick={()=>void connectSlack()}>{slack.workspace ? 'Reconnect Slack' : 'Connect Slack'}</button>
            {slackError && <p role="status">{slackError}</p>}
            {slack.workspace && (slack.channels.length ? <details open>
              <summary>Choose Slack channels ({slackIds.length} selected)</summary>
              <p className="footnote">Select up to five project channels. ReV checks recent messages when you import.</p>
              {slack.channels.map(channel=><label className="check" key={channel.id}><input type="checkbox" disabled={busy || !!file || (slackIds.length>=5 && !slackIds.includes(channel.id))} checked={slackIds.includes(channel.id)} onChange={()=>toggleSlackChannel(channel.id)}/> #{channel.name}</label>)}
            </details> : <p>No channels found. Join a project channel in Slack and reload ReV.</p>)}
          </div>
          {sources.slack && !slack.workspace && <label className="check"><input type="checkbox" checked={useSlack && !file} disabled={!!file || busy} onChange={e=>setUseSlack(e.target.checked)}/> Import from connected Slack channels</label>}
          <details><summary>Import from another source</summary>
          <label>GitHub repository <span className="muted">optional</span><input value={repo} onChange={e=>setRepo(e.target.value)} placeholder="owner/repository"/></label>
          <label>Slack export ZIP <span className="muted">optional · max 10 MiB</span><input type="file" accept=".zip,application/zip" onChange={e=>setFile(e.target.files?.[0] || null)}/></label>
          </details>
          <div className="button-row"><button disabled={busy || !departingPerson.trim()} onClick={()=>create(false)}>Import sources <span>→</span></button><button disabled={busy} className="secondary" onClick={()=>create(true)}>Try synthetic example</button></div>
          <p className="footnote">Configure the GitHub token and model provider in the daemon environment. No credentials are stored in a run.</p>
        </section>
        {run && <section className="card"><div className="card-head"><div><div className="eyebrow">02 / SELECT SOURCES</div><h2>Choose what can be shared</h2><p>Imported sources start unselected. Nothing is sent to a model until you confirm the recipient’s access.</p></div><span className="count">{selected.length}/{run.artifacts.length}</span></div>
          {run.mode==='fixture' && <div className="notice">Synthetic fixture · generation uses deterministic example output, not an AI model.</div>}
          {generationFailure && <div className="warning" role="status">{generationFailure}</div>}
          {coverageWarnings.length>0 && <div className="warning"><strong>Incomplete coverage</strong>{coverageWarnings.map((w,i)=><p key={i}>{w}</p>)}<label className="check"><input type="checkbox" checked={partial} onChange={e=>setPartial(e.target.checked)}/> I understand the source coverage is incomplete.</label></div>}
          {(run.departingPerson || run.githubUsername) && <div>
            <label>What are you taking over? <span className="muted">(optional)</span><input value={takeoverScope} onChange={e=>setTakeoverScope(e.target.value)} maxLength={400} placeholder="e.g. Billing retries and alerts"/></label>
            <p>Select the evidence for {run.departingPerson || run.githubUsername}’s handover. Add responsibilities if you want to focus the draft.</p>
            {areas.length > 0 && <><p>Areas found in their Git activity</p><div className="button-row">{areas.map(area=><button type="button" className="secondary" key={area} onClick={()=>setTakeoverScope(value=>value.includes(area) ? value : [value, area].filter(Boolean).join(', ').slice(0, 400))}>{area}</button>)}</div></>}
            {scopeChanged && ['needs_review','approved'].includes(run.state) && <p>Generate a new draft to apply the changed responsibilities.</p>}
          </div>}
          {commitIds.length > 0 && <div className="button-row">
            <button type="button" className="secondary"
              disabled={busy || selectionWithCommits.length === selected.length || selectionWithCommits.length > 500}
              onClick={()=>void updateSelection(selectionWithCommits)}>
              Select all commits
            </button>
            {selectionWithCommits.length > 500 && <small>Clear other sources to stay within the 500-source limit.</small>}
          </div>}
          <div className="source-list">{run.artifacts.map(a=><label className={`source ${selected.includes(a.id) ? 'selected' : ''}`} key={a.id}><input type="checkbox" disabled={busy} checked={selected.includes(a.id)} onChange={()=>void toggle(a.id)}/><span><b>{a.kind.replaceAll('_',' ')}</b><small>{a.sourceRef}{a.author ? ` · ${a.author}` : ''}</small>{(run.githubUsername || run.departingPerson) && (a.githubLogin?.toLowerCase()===(run.githubUsername || run.departingPerson)?.toLowerCase() || a.author?.toLowerCase()===(run.githubUsername || run.departingPerson)?.toLowerCase()) && <small>GitHub-linked contributor match: @{a.githubLogin || a.author}</small>}{a.paths?.length ? <small>{a.paths.slice(0, 4).join(', ')}</small> : null}<span className="source-text">{a.text}</span></span></label>)}</div>
          <div className="auth-guardrails">
            <label className="check"><input type="checkbox" checked={authorised} onChange={e=>setAuthorised(e.target.checked)}/> I confirm the recipient may receive all selected material.</label>
            {run.mode!=='fixture' && <label className="check"><input type="checkbox" checked={remote} onChange={e=>setRemote(e.target.checked)}/> I consent to sending selected text{run.departingPerson ? ' and handover details' : ''} to my configured model provider.</label>}
          </div>
          <button className="primary-action" disabled={busy || !selected.length || !authorised || (!!coverageWarnings.length && !partial) || (run.mode!=='fixture' && !remote)} onClick={()=>patch({action:'generate',takeoverScope:run.departingPerson ? takeoverScope.trim() : undefined,selectedIds:selected,acceptPartial:partial,confirmAuthorisation:true,confirmRemote:remote,fixture:run.mode==='fixture'})}>Generate draft <span>→</span></button>
        </section>}
        {run && ['needs_review','approved'].includes(run.state) && <section className="card"><div className="card-head"><div><div className="eyebrow">03 / REVIEW</div><h2>Make it yours</h2><p>Check the meaning, not just the citation. Editing a claim marks it unverified.</p></div><span className="count">{items.length} ITEMS</span></div>
          <DepartureInterview key={run.id} run={run} busy={busy} hasUnsavedEdits={JSON.stringify(items) !== JSON.stringify(run.items)} patch={patch} shareIds={shareAnswers} toggleShare={toggleShare} />
          {run.departingPerson && !scopeChanged && <div className="notice">
            <h3>Start here</h3>
            {actions.length ? <><p>{actions[0].text}</p><ul>{[...new Set(actions[0].citations.map(cite=>cite.sourceId))].map(id=>{
              const source = run.artifacts.find(artifact=>artifact.id===id);
              if (!source) return null;
              return <li key={id}>{source.url?.startsWith('https://github.com/') ? <a href={source.url}>{source.sourceRef}</a> : source.sourceRef}</li>;
            })}</ul></> : <p>Confirm the first task with the team. The draft has no next action with evidence ready for review.</p>}
            {actions.length > 1 && <><h4>Day 1 follow-ups</h4><ol>{actions.slice(1).map(action=><li key={action.id}>{action.text}</li>)}</ol></>}
          </div>}
          {items.map(item=><div className="review-item" key={item.id}><div className="review-meta"><strong>{item.category.replaceAll('_',' ')}</strong><span className={`status-pill ${item.verification==='validated_reference'?'valid':'uncertain'}`}>{item.verification.replaceAll('_',' ')}</span></div><label>Handover text<textarea value={item.text} onChange={e=>updateItem(item.id,{text:e.target.value})}/></label>
            {item.citations.map((c,i)=>{const src=run.artifacts.find(s=>s.id===c.sourceId);return <div className="citation" key={i}><small>↳ {src?.sourceRef || 'Missing source'}</small><p>“{c.quote}”</p></div>})}
            <div className="review-options"><label className="check"><input type="checkbox" checked={item.excluded} onChange={e=>updateItem(item.id,{excluded:e.target.checked})}/> Exclude</label><label className="check"><input type="checkbox" checked={item.needsClarification} onChange={e=>updateItem(item.id,{needsClarification:e.target.checked})}/> Needs clarification</label></div></div>)}
          <div className="auth-guardrails">
            <label className="check"><input type="checkbox" checked={authorised} onChange={e=>setAuthorised(e.target.checked)}/> I confirm the selected sources are authorised for this recipient.</label>
          </div>
          {(() => {
            const hasPendingEdits = JSON.stringify(items) !== JSON.stringify(run.items);
            const canApprove = !hasPendingEdits && run.state === 'needs_review' && authorised && !scopeChanged && JSON.stringify([...selected].sort()) === JSON.stringify([...run.selectedIds].sort());
            const canDownload = !hasPendingEdits && run.state === 'approved' && !scopeChanged && JSON.stringify([...selected].sort()) === JSON.stringify([...run.selectedIds].sort());

            return <div className="button-row">
              <button className={hasPendingEdits ? 'primary-action' : 'secondary'} disabled={busy} onClick={()=>patch({action:'save',items})}>Save review</button>
              <button className={canApprove ? 'primary-action' : 'secondary'} disabled={busy || !canApprove} onClick={()=>patch({action:'approve',confirmAuthorisation:true,interviewAnswerIds:shareAnswers.filter(id=>run.gaps?.some(gap=>gap.answerSourceId===id))})}>Approve current revision</button>
              <button className={canDownload ? 'primary-action' : 'secondary'} disabled={busy || !canDownload} onClick={download}>Download Markdown</button>
            </div>;
          })()}
          <p className="footnote">Save edits before approving. Changing source selection requires generating a new draft.</p>
        </section>}
      </div><div className="column"><ProjectDashboard/><section className="card compact"><div className="eyebrow">YOUR WORKSPACE</div><h2>Recent runs</h2><p>Each run is a separate snapshot.</p>{runs.length===0?<div className="empty">No handovers yet.<br/><span>Start a run or try the example.</span></div>:<div className="runs">{runs.map(r=><button className="run-row" key={r.id} onClick={()=>perform(async()=>{ const d=await api(`/api/runs/${r.id}`);display(d.run);})}><span><b>{r.recipient}</b><small>{new Date(r.createdAt).toLocaleString()}</small></span><span className="run-state">{r.state.replaceAll('_',' ')}</span></button>)}</div>}</section>
        <section className="card compact trust"><div className="eyebrow">DESIGNED FOR REVIEW</div><h3>A source, not a guess.</h3><p>Every draft is a starting point. Verify what it says, resolve uncertainty and decide what is safe to share.</p><div className="trust-line"><span>01</span> Select authorised sources</div><div className="trust-line"><span>02</span> Inspect supporting evidence</div><div className="trust-line"><span>03</span> Approve before export</div></section>
        {run && <section className="card compact"><div className="eyebrow">CURRENT RUN</div><h3>{run.recipient}</h3>{run.githubUsername&&<p>Contributor: @{run.githubUsername}</p>}{run.targetRole&&<p>Target role: {run.targetRole}</p>}<p>Status: <b>{run.state.replaceAll('_',' ')}</b></p><button className="danger" disabled={busy} onClick={()=>perform(async()=>{if(!confirm('Delete this run and its stored snapshots? Downloaded exports cannot be revoked.')) return; await api(`/api/runs/${run.id}`,{method:'DELETE'}); setRun(null);})}>Delete run</button></section>}
      </div></div><footer>ReV <span>·</span> A clearer handover starts with the evidence.</footer></div>
    </main></div>;
}
