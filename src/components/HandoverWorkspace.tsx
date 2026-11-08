'use client';
import { useEffect, useState } from 'react';
import type { Item, Run } from '@/lib/contracts';

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
  const [recipient,setRecipient] = useState('Incoming engineer'); const [repo,setRepo] = useState(''); const [file,setFile] = useState<File|null>(null);
  const [selected,setSelected] = useState<string[]>([]); const [items,setItems] = useState<Item[]>([]);
  const [authorised,setAuthorised] = useState(false); const [remote,setRemote] = useState(false); const [partial,setPartial] = useState(false);
  const [busy,setBusy] = useState(false); const [error,setError] = useState('');
  async function refresh() { const data=await api('/api/runs'); setRuns(data.runs); }
  useEffect(()=> { refresh().catch(e=>setError(e.message)); },[]);
  function display(r:Run) { setRun(r); setSelected(r.selectedIds); setItems(r.items); setAuthorised(false); setRemote(false); setPartial(false); }
  async function perform(fn:()=>Promise<void>) { setBusy(true); setError(''); try { await fn(); await refresh(); } catch(e) { setError(e instanceof Error ? e.message : 'Operation failed'); if (run) { try { const latest=await api(`/api/runs/${run.id}`); display(latest.run); await refresh(); } catch {} } } finally { setBusy(false); } }
  async function create(fixture:boolean) { await perform(async()=>{
    if (file && file.size > 10*1024*1024) throw new Error('Slack ZIP exceeds 10 MiB');
    const zipBase64=!fixture && file ? await fileAsBase64(file) : undefined;
    const result=await api('/api/runs',{method:'POST',body:JSON.stringify({recipient,repo:fixture?undefined:repo || undefined,zipBase64,fixture})}); display(result.run);
  }); }
  async function patch(body:object) { if(!run)return; await perform(async()=> { const d=await api(`/api/runs/${run.id}`,{method:'PATCH',body:JSON.stringify(body)}); display(d.run); }); }
  async function toggle(id:string) {
    if (!run || busy) return;
    const next=selected.includes(id)?selected.filter(x=>x!==id):[...selected,id];
    setSelected(next); setBusy(true); setError(''); setAuthorised(false);
    try { const d=await api(`/api/runs/${run.id}`,{method:'PATCH',body:JSON.stringify({action:'scope',selectedIds:next})}); setRun(d.run); setSelected(d.run.selectedIds); setItems(d.run.items); await refresh(); }
    catch(e) { setSelected(selected); setError(e instanceof Error ? e.message : 'Could not update source scope'); }
    finally { setBusy(false); }
  }
  function updateItem(id:string, changes:Partial<Item>) { setItems(old=>old.map(item=>item.id===id?{...item,...changes}:item)); }
  async function download() { if(!run)return; await perform(async()=> { const resp=await fetch(`/api/runs/${run.id}/export`,{headers:{'X-Rev-Request':'1'}}); if(!resp.ok) { const data=await resp.json(); throw new Error(data.error); } const url=URL.createObjectURL(await resp.blob()); const a=document.createElement('a'); a.href=url; a.download='rev-handover.md'; a.click(); URL.revokeObjectURL(url); }); }
  return <div className="shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark">R</span><div><strong>ReV</strong><small>Handover workspace</small></div></div><div className="side-label">WORKSPACE</div><div className="nav-current"><span>◫</span> Handover runs</div><div className="side-bottom"><span className="status-dot"/> Local workspace <small>Single operator · on demand</small></div></aside>
    <main className="main"><header className="topbar"><span>WORKSPACE / <b>HANDOVERS</b></span><span className="local-badge"><i/> LOCAL ONLY</span></header>
      <div className="content"><section className="hero"><div><div className="eyebrow">KNOWLEDGE, CARRIED FORWARD</div><h1>Make the next<br/><em>chapter clearer.</em></h1><p>Turn scattered project activity into an evidence-linked handover, reviewed by a person before it is shared.</p></div><div className="hero-number">01 <span>/ 05</span><small>START A HANDOVER</small></div></section>
      {error && <div role="alert" className="error">{error}</div>}
      <div className="grid"><div className="column">
        <section className="card"><div className="card-head"><div><div className="eyebrow">01 / CONNECT</div><h2>Start a run</h2><p>Import only material you are authorised to use.</p></div><span className="step-icon">↗</span></div>
          <label>Recipient or role<input value={recipient} onChange={e=>setRecipient(e.target.value)} maxLength={120}/></label>
          <label>GitHub repository <span className="muted">optional</span><input value={repo} onChange={e=>setRepo(e.target.value)} placeholder="owner/repository"/></label>
          <label>Slack export ZIP <span className="muted">optional · max 10 MiB</span><input type="file" accept=".zip,application/zip" onChange={e=>setFile(e.target.files?.[0] || null)}/></label>
          <div className="button-row"><button disabled={busy} onClick={()=>create(false)}>Import sources <span>→</span></button><button disabled={busy} className="secondary" onClick={()=>create(true)}>Try synthetic example</button></div>
          <p className="footnote">A GitHub token and model provider are configured server-side in <code>.env.local</code>. No credentials are stored in a run.</p>
        </section>
        {run && <section className="card"><div className="card-head"><div><div className="eyebrow">02 / SELECT SOURCES</div><h2>Choose what can be shared</h2><p>Imported sources start unselected. Nothing is sent to a model until you confirm the recipient’s access.</p></div><span className="count">{selected.length}/{run.artifacts.length}</span></div>
          {run.mode==='fixture' && <div className="notice">Synthetic fixture · generation uses deterministic example output, not an AI model.</div>}
          {run.warnings.length>0 && <div className="warning"><strong>Incomplete coverage</strong>{run.warnings.map((w,i)=><p key={i}>{w}</p>)}<label className="check"><input type="checkbox" checked={partial} onChange={e=>setPartial(e.target.checked)}/> I understand the source coverage is incomplete.</label></div>}
          <div className="source-list">{run.artifacts.map(a=><label className="source" key={a.id}><input type="checkbox" disabled={busy} checked={selected.includes(a.id)} onChange={()=>void toggle(a.id)}/><span><b>{a.kind.replaceAll('_',' ')}</b><small>{a.sourceRef}</small><span className="source-text">{a.text}</span></span></label>)}</div>
          <label className="check"><input type="checkbox" checked={authorised} onChange={e=>setAuthorised(e.target.checked)}/> I confirm the recipient may receive all selected material.</label>
          {run.mode!=='fixture' && <label className="check"><input type="checkbox" checked={remote} onChange={e=>setRemote(e.target.checked)}/> I consent to sending selected text to my configured model provider.</label>}
          <button disabled={busy || !selected.length || !authorised || (!!run.warnings.length && !partial) || (run.mode!=='fixture' && !remote)} onClick={()=>patch({action:'generate',selectedIds:selected,acceptPartial:partial,confirmAuthorisation:true,confirmRemote:remote,fixture:run.mode==='fixture'})}>Generate draft <span>→</span></button>
        </section>}
        {run && ['needs_review','approved'].includes(run.state) && <section className="card"><div className="card-head"><div><div className="eyebrow">03 / REVIEW</div><h2>Make it yours</h2><p>Check the meaning, not just the citation. Editing a claim marks it unverified.</p></div><span className="count">{items.length} ITEMS</span></div>
          {items.map(item=><div className="review-item" key={item.id}><div className="review-meta"><strong>{item.category.replaceAll('_',' ')}</strong><span className={item.verification==='validated_reference'?'valid':'uncertain'}>{item.verification.replaceAll('_',' ')}</span></div><label>Handover text<textarea value={item.text} onChange={e=>updateItem(item.id,{text:e.target.value})}/></label>
            {item.citations.map((c,i)=>{const src=run.artifacts.find(s=>s.id===c.sourceId);return <div className="citation" key={i}><small>↳ {src?.sourceRef || 'Missing source'}</small><p>“{c.quote}”</p></div>})}
            <div className="review-options"><label className="check"><input type="checkbox" checked={item.excluded} onChange={e=>updateItem(item.id,{excluded:e.target.checked})}/> Exclude</label><label className="check"><input type="checkbox" checked={item.needsClarification} onChange={e=>updateItem(item.id,{needsClarification:e.target.checked})}/> Needs clarification</label></div></div>)}
          <label className="check"><input type="checkbox" checked={authorised} onChange={e=>setAuthorised(e.target.checked)}/> I confirm the selected sources are authorised for this recipient.</label>
          <div className="button-row"><button disabled={busy} onClick={()=>patch({action:'save',items})}>Save review</button><button className="secondary" disabled={busy || !authorised || JSON.stringify([...selected].sort())!==JSON.stringify([...run.selectedIds].sort()) || run.state!=='needs_review' || JSON.stringify(items)!==JSON.stringify(run.items)} onClick={()=>patch({action:'approve',confirmAuthorisation:true})}>Approve current revision</button><button className="secondary" disabled={busy || JSON.stringify([...selected].sort())!==JSON.stringify([...run.selectedIds].sort()) || run.state!=='approved' || JSON.stringify(items)!==JSON.stringify(run.items)} onClick={download}>Download Markdown</button></div><p className="footnote">Save edits before approving. Changing source selection requires generating a new draft.</p>
        </section>}
      </div><div className="column"><section className="card compact"><div className="eyebrow">YOUR WORKSPACE</div><h2>Recent runs</h2><p>Each run is a separate snapshot.</p>{runs.length===0?<div className="empty">No handovers yet.<br/><span>Start a run or try the example.</span></div>:<div className="runs">{runs.map(r=><button className="run-row" key={r.id} onClick={()=>perform(async()=>{ const d=await api(`/api/runs/${r.id}`);display(d.run);})}><span><b>{r.recipient}</b><small>{new Date(r.createdAt).toLocaleString()}</small></span><span className="run-state">{r.state.replaceAll('_',' ')}</span></button>)}</div>}</section>
        <section className="card compact trust"><div className="eyebrow">DESIGNED FOR REVIEW</div><h3>A source, not a guess.</h3><p>Every draft is a starting point. Verify what it says, resolve uncertainty and decide what is safe to share.</p><div className="trust-line"><span>01</span> Select authorised sources</div><div className="trust-line"><span>02</span> Inspect supporting evidence</div><div className="trust-line"><span>03</span> Approve before export</div></section>
        {run && <section className="card compact"><div className="eyebrow">CURRENT RUN</div><h3>{run.recipient}</h3><p>Status: <b>{run.state.replaceAll('_',' ')}</b></p><button className="danger" disabled={busy} onClick={()=>perform(async()=>{if(!confirm('Delete this run and its stored snapshots? Downloaded exports cannot be revoked.')) return; await api(`/api/runs/${run.id}`,{method:'DELETE'}); setRun(null);})}>Delete run</button></section>}
      </div></div><footer>ReV <span>·</span> A clearer handover starts with the evidence.</footer></div>
    </main></div>;
}
