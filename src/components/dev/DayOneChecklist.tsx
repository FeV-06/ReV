'use client';

import React, { useEffect, useState } from 'react';

export interface ChecklistTask {
  id: string;
  text: string;
  category?: string;
  completed: boolean;
}

interface DayOneChecklistProps {
  projectId: string;
  initialTasks: { id: string; text: string; category?: string }[];
}

export default function DayOneChecklist({ projectId, initialTasks }: DayOneChecklistProps) {
  const [tasks, setTasks] = useState<ChecklistTask[]>([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`rev_dev_checklist_${projectId}`);
      const savedCompleted: Record<string, boolean> = saved ? JSON.parse(saved) : {};

      const combined: ChecklistTask[] = initialTasks.map(t => ({
        ...t,
        completed: Boolean(savedCompleted[t.id]),
      }));

      // If no tasks provided from run, supply standard day-1 engineering verification tasks
      if (combined.length === 0) {
        const defaultTasks: ChecklistTask[] = [
          { id: 't1', text: 'Verify local Git repository clone and build passes', category: 'SETUP', completed: Boolean(savedCompleted['t1']) },
          { id: 't2', text: 'Check Redis session cache fallback and unit tests', category: 'CODEBASE', completed: Boolean(savedCompleted['t2']) },
          { id: 't3', text: 'Review incident runbooks and deployment credentials with team', category: 'SECURITY', completed: Boolean(savedCompleted['t3']) },
          { id: 't4', text: 'Confirm Slack project channel access (#billing-team)', category: 'COMMUNICATION', completed: Boolean(savedCompleted['t4']) },
        ];
        setTasks(defaultTasks);
      } else {
        setTasks(combined);
      }
    } catch {
      setTasks(initialTasks.map(t => ({ ...t, completed: false })));
    }
  }, [projectId, initialTasks]);

  function toggleTask(id: string) {
    const updated = tasks.map(t => (t.id === id ? { ...t, completed: !t.completed } : t));
    setTasks(updated);

    try {
      const completedMap: Record<string, boolean> = {};
      updated.forEach(t => {
        if (t.completed) completedMap[t.id] = true;
      });
      localStorage.setItem(`rev_dev_checklist_${projectId}`, JSON.stringify(completedMap));
    } catch {
      // LocalStorage error ignore
    }
  }

  const completedCount = tasks.filter(t => t.completed).length;
  const progressPercent = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;

  return (
    <div className="m3-checklist-card">
      <div className="m3-checklist-header">
        <div>
          <div className="eyebrow">DAY 1 ACTION PLAN</div>
          <h3>Priority Onboarding Checklist</h3>
          <p>Key responsibilities and verification tasks carried over from the departing engineer.</p>
        </div>
        <div className="m3-progress-badge">
          <strong>{progressPercent}%</strong>
          <small>{completedCount}/{tasks.length} Completed</small>
        </div>
      </div>

      {/* Progress Track */}
      <div className="m3-progress-track" role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100}>
        <div className="m3-progress-fill" style={{ width: `${progressPercent}%` }} />
      </div>

      {/* Task List */}
      <div className="m3-tasks-list">
        {tasks.map(task => (
          <label
            key={task.id}
            className={`m3-task-item ${task.completed ? 'completed' : ''}`}
          >
            <input
              type="checkbox"
              checked={task.completed}
              onChange={() => toggleTask(task.id)}
              className="m3-checkbox"
            />
            <div className="m3-task-body">
              {task.category && <span className="m3-task-tag">{task.category}</span>}
              <span className="m3-task-text">{task.text}</span>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

