#!/usr/bin/env python3
"""Evaluate Laya and a transparent keyword baseline on synthetic labeled records."""
import argparse
import json
import os
import statistics
import time
from collections import Counter
from pathlib import Path

LABELS = ('decision', 'open_work', 'risk', 'other')
CRITERIA = {
    'decision': 'an approved, rejected, or chosen technical decision',
    'open_work': 'an unresolved task, follow-up, or work to be done',
    'risk': 'a potential issue or danger that may impact the project',
    'other': 'greetings, status, questions without a decision, and anything else',
}

def baseline(text):
    s = text.lower()
    if any(x in s for x in ('decision:', 'we decided', 'we agreed', 'team chose', 'approved:', 'we rejected')): return 'decision'
    if any(x in s for x in ('todo:', 'follow up:', 'outstanding:', 'please ', 'unfinished', 'create a rollback')): return 'open_work'
    if any(x in s for x in ('risk:', 'might corrupt', 'will stop working', 'single node failure', 'may lose', 'bypass', 'can break', 'hypothetical outage')): return 'risk'
    return 'other'

def metrics(rows):
    total=len(rows);correct=sum(r['predicted']==r['gold'] for r in rows)
    labels={}
    for label in LABELS:
        tp=sum(r['gold']==label and r['predicted']==label for r in rows)
        fp=sum(r['gold']!=label and r['predicted']==label for r in rows)
        fn=sum(r['gold']==label and r['predicted']!=label for r in rows)
        precision=tp/(tp+fp) if tp+fp else 0.0;recall=tp/(tp+fn) if tp+fn else 0.0
        labels[label]={'support':sum(r['gold']==label for r in rows),'precision':round(precision,4),'recall':round(recall,4),'f1':round(2*precision*recall/(precision+recall),4) if precision+recall else 0.0}
    latencies=sorted(r['seconds'] for r in rows)
    return {'n':total,'accuracy':round(correct/total,4) if total else None,'per_label':labels,'median_seconds':round(statistics.median(latencies),4) if latencies else None,'errors':[r['id'] for r in rows if r['predicted']!=r['gold']]}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--dataset',default='evals/classification/synthetic-pilot.json');parser.add_argument('--output',required=True);parser.add_argument('--model',default='convaiinnovations/laya');parser.add_argument('--device',default='cpu');parser.add_argument('--baseline-only',action='store_true');args=parser.parse_args()
    examples=json.loads(Path(args.dataset).read_text())['examples'];assert all(e['label'] in LABELS for e in examples)
    rows=[]
    for e in examples:
        t=time.perf_counter();prediction=baseline(e['text']);rows.append({'id':e['id'],'gold':e['label'],'predicted':prediction,'seconds':time.perf_counter()-t})
    result={'dataset':args.dataset,'dataset_warning':'Synthetic, self-labeled pilot; not a representative held-out benchmark.','baseline':metrics(rows)}
    if not args.baseline_only:
        os.environ.setdefault('USE_TF','0')
        import laya
        t=time.perf_counter();agent=laya.Agent(args.model,device=args.device);load_seconds=time.perf_counter()-t
        questions={'category':{'type':'choice','instructions':'Classify the primary role of this project record','criteria':CRITERIA}}
        model_rows=[];truncated=[]
        for e in examples:
            t=time.perf_counter();response=agent.predict(e['text'],questions);elapsed=time.perf_counter()-t
            answer=response['answers']['category'];usage=response.get('usage',{})
            model_rows.append({'id':e['id'],'gold':e['label'],'predicted':answer['choice'],'seconds':elapsed,'confidence':answer.get('answer_confidence')})
            if usage.get('truncated'):truncated.append(e['id'])
        result['laya']={'model':args.model,'device':args.device,'load_seconds':round(load_seconds,3),**metrics(model_rows),'truncated_ids':truncated,'predictions':model_rows}
    Path(args.output).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))

if __name__=='__main__':main()
