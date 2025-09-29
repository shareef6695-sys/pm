import React from "react";

/* ===================== Persistence ===================== */
const LS_KEYS = {
  TASKS: "pm_tasks_v1",
  PROJECTS: "pm_projects_v1",
  NOTIFY: "pm_notify_v1",
};
const loadLS = (k, f) => { try { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : f; } catch { return f; } };
const saveLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

/* ===================== Utils & Types ===================== */
const uid = () => Math.random().toString(36).slice(2, 9);
const STATUSES = ["Todo", "In Progress", "Blocked", "Done"];
const todayISO = () => new Date().toISOString().slice(0,10);

const EMPTY_TASK = {
  id: "", projectId: "", title: "", assignee: "", priority: "Medium", status: "Todo",
  dueDate: "", estimateHrs: 0, attachments: [], comments: [], updatedAt: "",
};
const EMPTY_PROJECT = { id: "", name: "", startDate: "", endDate: "", milestonesText: "" };

/* ===================== Notification defaults (env + local) ===================== */
// Env defaults (used if no local override is set)
const ENV_NOTIFY_DEFAULTS = {
  email: (import.meta.env?.VITE_NOTIFY_EMAIL_TO || "ops@example.com"),
  whatsapp: (import.meta.env?.VITE_NOTIFY_WHATSAPP_TO || "+9665xxxxxxx"),
};
// Read current defaults (local overrides take priority)
function getNotifyDefaults() {
  const ls = loadLS(LS_KEYS.NOTIFY, {});
  return {
    email: (ls.email || ENV_NOTIFY_DEFAULTS.email),
    whatsapp: (ls.whatsapp || ENV_NOTIFY_DEFAULTS.whatsapp),
  };
}
function setNotifyDefaults(next) {
  const cur = getNotifyDefaults();
  const merged = { ...cur, ...next };
  saveLS(LS_KEYS.NOTIFY, merged);
  return merged;
}

/* ===================== Notifications (SendGrid/WhatsApp via /api/notify) ===================== */
async function sendNotification({ channel, to, subject, message }) {
  const defaults = getNotifyDefaults();
  const target = to || (channel === "email" ? defaults.email : channel === "whatsapp" ? defaults.whatsapp : undefined);

  try {
    const resp = await fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, to: target, subject, message }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (e) {
    // Fallback simulate locally
    console.log("[notify:simulated]", { channel, to: target, subject, message, error: String(e) });
    return { ok: true, simulated: true };
  }
}
function notifyTaskSaved(task, isNew) {
  const subject = isNew ? `New task: ${task.title}` : `Task updated: ${task.title}`;
  const message = `Title: ${task.title}\nStatus: ${task.status}\nAssignee: ${task.assignee || "Unassigned"}\nDue: ${task.dueDate || "TBD"}`;
  sendNotification({ channel: "email", subject, message });
}
function notifyStatusChange(task, oldStatus, newStatus) {
  const subject = `Status: ${task.title} → ${newStatus}`;
  const message = `Task "${task.title}" moved ${oldStatus} → ${newStatus}\nAssignee: ${task.assignee || "Unassigned"}\nDue: ${task.dueDate || "TBD"}`;
  sendNotification({ channel: "whatsapp", subject, message });
}
function notifyNewComment(task, comment) {
  const subject = `New comment on: ${task.title}`;
  const message = `${comment.author || "Someone"} commented: "${comment.text}"\nTask: ${task.title}`;
  sendNotification({ channel: "email", subject, message });
}

/* ===================== Reusable Inputs ===================== */
function Label({ children }) { return <label className="block text-sm font-medium text-slate-700 mb-1">{children}</label>; }
function Text({ label, value, onChange, type = "text", placeholder, required }) {
  return (
    <div>
      <Label>{label}{required && <span className="text-rose-600"> *</span>}</Label>
      <input type={type} required={required} className="w-full border rounded-lg px-3 py-1.5 text-sm"
             value={value || ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
function Number({ label, value, onChange }) {
  return (
    <div>
      <Label>{label}</Label>
      <input type="number" className="w-full border rounded-lg px-3 py-1.5 text-sm"
             value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}
function Select({ label, value, onChange, options }) {
  return (
    <div>
      <Label>{label}</Label>
      <select className="w-full border rounded-lg px-3 py-1.5 text-sm"
              value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        {options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
      </select>
    </div>
  );
}

/* ===================== Task Form (attachments + comments) ===================== */
function TaskForm({ value, onChange, onSave, onDelete, projects, onComment }) {
  const set = (k, v) => onChange({ ...value, [k]: v, updatedAt: new Date().toISOString() });

  const addAttachment = async (file) => {
    if (!file) return;
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = reject; fr.readAsDataURL(file);
    });
    set("attachments", [...(value.attachments || []), { id: uid(), name: file.name, dataUrl }]);
  };
  const removeAttachment = (id) => set("attachments", (value.attachments || []).filter(a => a.id !== id));

  const [commentAuthor, setCommentAuthor] = React.useState("");
  const [commentText, setCommentText] = React.useState("");
  const addComment = () => {
    if (!commentText.trim()) return;
    const c = { id: uid(), author: commentAuthor.trim(), text: commentText.trim(), ts: new Date().toISOString() };
    set("comments", [...(value.comments || []), c]); setCommentText(""); onComment?.(value, c);
  };

  const titleOK = value.title?.trim().length > 0;

  return (
    <div className="space-y-3">
      <Text label="Title" value={value.title} onChange={(v) => set("title", v)} required />
      <div className="grid grid-cols-2 gap-3">
        <Select label="Project" value={value.projectId} onChange={(v) => set("projectId", v)}
          options={[{ value: "", label: "—" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
        <Text label="Assignee" value={value.assignee} onChange={(v) => set("assignee", v)} placeholder="Name or email" />
        <Select label="Priority" value={value.priority || "Medium"} onChange={(v) => set("priority", v)}
          options={["Low", "Medium", "High"].map((x) => ({ value: x, label: x }))} />
        <Select label="Status" value={value.status || "Todo"} onChange={(v) => set("status", v)}
          options={STATUSES.map((x) => ({ value: x, label: x }))} />
        <Text label="Due Date" type="date" value={value.dueDate} onChange={(v) => set("dueDate", v)} />
        <Number label="Estimate (hrs)" value={value.estimateHrs || 0} onChange={(v) => set("estimateHrs", v)} />
      </div>

      {/* Attachments */}
      <div className="pt-2">
        <Label>Attachments</Label>
        <div className="flex items-center gap-2 mb-2">
          <label className="px-3 py-1.5 rounded-lg border cursor-pointer text-sm">Add file
            <input type="file" className="hidden" onChange={(e) => addAttachment(e.target.files?.[0])} />
          </label>
          <div className="text-xs text-slate-500">Stored locally (base64). Keep files small.</div>
        </div>
        <ul className="space-y-2 max-h-36 overflow-auto pr-2">
          {(value.attachments || []).map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
              <a href={a.dataUrl} download={a.name} className="underline truncate" title="Download">{a.name}</a>
              <button className="text-rose-600 text-xs" onClick={() => removeAttachment(a.id)}>remove</button>
            </li>
          ))}
          {!(value.attachments || []).length && <div className="text-xs text-slate-400">No files attached.</div>}
        </ul>
      </div>

      {/* Comments */}
      <div className="pt-2">
        <Label>Comments</Label>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <input className="border rounded-lg px-2 py-1 text-sm" placeholder="Your name (optional)"
                 value={commentAuthor} onChange={(e) => setCommentAuthor(e.target.value)} />
          <div className="flex gap-2">
            <input className="flex-1 border rounded-lg px-2 py-1 text-sm" placeholder="Write a comment"
                   value={commentText} onChange={(e) => setCommentText(e.target.value)} />
            <button className="px-3 py-1.5 rounded-lg border text-sm" onClick={addComment}>Add</button>
          </div>
        </div>
        <ul className="space-y-2 max-h-40 overflow-auto pr-2">
          {(value.comments || []).map((c) => (
            <li key={c.id} className="text-sm">
              <div className="text-[11px] text-slate-500">{(c.author || "Comment")} • {new Date(c.ts).toLocaleString()}</div>
              <div>{c.text}</div>
            </li>
          ))}
          {!(value.comments || []).length && <div className="text-xs text-slate-400">No comments yet.</div>}
        </ul>
      </div>

      <div className="flex gap-2 pt-2">
        <button className={`px-3 py-1.5 rounded-lg border ${titleOK ? "" : "opacity-50 cursor-not-allowed"}`}
                onClick={() => titleOK && onSave(value)} disabled={!titleOK}>Save</button>
        {value.id && <button className="px-3 py-1.5 rounded-lg border text-rose-600" onClick={() => onDelete(value.id)}>Delete</button>}
      </div>
    </div>
  );
}

/* ===================== Kanban ===================== */
function TaskCard({ task, onEdit }) {
  return (
    <div draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", task.id)}
         className="rounded-xl border p-2 bg-white hover:shadow-sm cursor-grab active:cursor-grabbing"
         onClick={() => onEdit(task)}>
      <div className="text-sm font-medium truncate">{task.title}</div>
      <div className="text-[11px] text-slate-500 flex items-center justify-between mt-1">
        <span>{task.assignee || "Unassigned"}</span>
        <span className={task.priority === "High" ? "text-rose-600" : task.priority === "Low" ? "text-emerald-600" : "text-slate-600"}>
          {task.priority || "Medium"}
        </span>
      </div>
      {task.dueDate && (
        <div className={`text-[11px] mt-1 ${new Date(task.dueDate) < new Date() && task.status !== "Done" ? "text-rose-600" : "text-slate-500"}`}>
          due {task.dueDate}
        </div>
      )}
      <div className="text-[11px] text-slate-500 mt-1">
        {(task.attachments?.length || 0)} file{(task.attachments?.length || 0) === 1 ? "" : "s"} · {(task.comments?.length || 0)} comment{(task.comments?.length || 0) === 1 ? "" : "s"}
      </div>
    </div>
  );
}
function KanbanBoard({ tasks, setTasks, onEdit, swimlaneBy = "None", projects = [], onStatusChanged }) {
  const projectName = React.useCallback((id) => projects.find((p) => p.id === id)?.name || "(No project)", [projects]);
  const groupedByStatus = React.useMemo(() => {
    const m = new Map(STATUSES.map((s) => [s, []])); tasks.forEach((t) => m.get(t.status || "Todo").push(t)); return m;
  }, [tasks]);
  const onDropTo = (status) => (e) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    setTasks((prev) => {
      const t = prev.find((x) => x.id === id); if (!t || t.status === status) return prev;
      const old = t.status || "Todo";
      const next = prev.map((x) => (x.id === id ? { ...x, status, updatedAt: new Date().toISOString() } : x));
      queueMicrotask(() => onStatusChanged?.({ ...t, status }, old, status));
      return next;
    });
  };
  const onDragOver = (e) => e.preventDefault();
  const keyFor = (t) => (swimlaneBy === "Project" ? projectName(t.projectId) : swimlaneBy === "Assignee" ? (t.assignee || "Unassigned") : swimlaneBy === "Priority" ? (t.priority || "Medium") : "__none__");
  const groupList = (list) => (swimlaneBy === "None" ? { __none__: list } : list.reduce((acc, t) => { const k = keyFor(t); (acc[k] ||= []).push(t); return acc; }, {}));

  return (
    <div className="grid md:grid-cols-4 gap-4">
      {STATUSES.map((status) => {
        const lanes = groupList(groupedByStatus.get(status) || []); const laneKeys = Object.keys(lanes);
        return (
          <div key={status} className="bg-white rounded-2xl p-3 border">
            <div className="font-semibold text-sm mb-2">{status}</div>
            <div className="space-y-3">
              {laneKeys.map((lk) => (
                <div key={lk}>
                  {lk !== "__none__" && <div className="text-[11px] text-slate-500 mb-1">{lk}</div>}
                  <div className="space-y-2 min-h-[120px]" onDragOver={onDragOver} onDrop={onDropTo(status)}>
                    {lanes[lk].map((t) => <TaskCard key={t.id} task={t} onEdit={onEdit} />)}
                    {lanes[lk].length === 0 && <div className="text-[11px] text-slate-400">Drop tasks here</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ===================== Projects + Timeline (Gantt) ===================== */
const parseMilestones = (text) =>
  text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
      .map(line => { const m = line.match(/^(\d{4}-\d{2}-\d{2})\s*-\s*(.*)$/); return m ? { date: m[1], title: m[2] } : null; })
      .filter(Boolean);
const toDate = (d) => (d ? new Date(d + "T00:00:00") : null);
const daysBetween = (a, b) => (!a || !b) ? 0 : Math.ceil(Math.abs(toDate(b) - toDate(a)) / (1000 * 60 * 60 * 24));

function ProjectForm({ value, onChange, onSave, onDelete }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Text label="Project Name" value={value.name} onChange={(v) => set("name", v)} required />
        <Text label="Start Date" type="date" value={value.startDate} onChange={(v) => set("startDate", v)} />
        <Text label="End Date" type="date" value={value.endDate} onChange={(v) => set("endDate", v)} />
      </div>
      <div>
        <Label>Milestones (one per line)</Label>
        <p className="text-xs text-slate-500 mb-1"><code>YYYY-MM-DD - Milestone name</code></p>
        <textarea className="w-full border rounded-xl px-3 py-2 text-sm" rows={5}
                  value={value.milestonesText} onChange={(e) => set("milestonesText", e.target.value)}
                  placeholder={`${todayISO()} - Kickoff\n${todayISO()} - Requirements\n${todayISO()} - Go-Live`} />
      </div>
      <div className="flex gap-2 pt-1">
        <button className="px-3 py-1.5 rounded-lg border" onClick={() => onSave(value)}>Save</button>
        {value.id && <button className="px-3 py-1.5 rounded-lg border text-rose-600" onClick={() => onDelete(value.id)}>Delete</button>}
      </div>
    </div>
  );
}
function ProjectsManager({ projects, setProjects }) {
  const [draft, setDraft] = React.useState(null);
  const onCreate = () => setDraft({ ...EMPTY_PROJECT, id: uid() });
  const onEdit = (p) => setDraft(p);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Projects</h2>
        <button className="px-3 py-1.5 rounded-lg border" onClick={onCreate}>New Project</button>
      </div>
      {draft && (
        <div className="bg-white rounded-2xl border p-4">
          <h3 className="font-semibold mb-3">{draft.name || "New Project"}</h3>
          <ProjectForm value={draft} onChange={setDraft}
            onSave={(p) => { setProjects(prev => prev.some(x => x.id === p.id) ? prev.map(x => x.id === p.id ? p : x) : [...prev, p]); setDraft(null); }}
            onDelete={(id) => { setProjects(prev => prev.filter(x => x.id !== id)); setDraft(null); }} />
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-4">
        {projects.map((p) => (
          <div key={p.id} className="bg-white rounded-2xl border p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-semibold">{p.name}</div>
                <div className="text-xs text-slate-500">{p.startDate || "?"} → {p.endDate || "?"} ({daysBetween(p.startDate, p.endDate)} days)</div>
              </div>
              <button className="px-2 py-1 rounded-md text-sm border" onClick={() => onEdit(p)}>Edit</button>
            </div>
            <div className="mt-3">
              <div className="text-xs text-slate-500 mb-1">Milestones</div>
              <ul className="text-sm list-disc ml-5 space-y-1 max-h-28 overflow-auto pr-2">
                {parseMilestones(p.milestonesText).map((m, i) => <li key={i}>{m.date} — {m.title}</li>)}
                {!parseMilestones(p.milestonesText).length && <div className="text-xs text-slate-400">No milestones yet</div>}
              </ul>
            </div>
          </div>
        ))}
        {projects.length === 0 && <div className="text-sm text-slate-500">No projects yet. Click <b>New Project</b>.</div>}
      </div>
    </div>
  );
}
function Timeline({ projects }) {
  const items = React.useMemo(() => projects.map((p) => ({
    id: p.id, name: p.name, start: toDate(p.startDate), end: toDate(p.endDate),
    days: daysBetween(p.startDate, p.endDate), milestones: parseMilestones(p.milestonesText || ""),
  })), [projects]);
  const starts = items.map(i => i.start).filter(Boolean);
  const ends = items.map(i => i.end).filter(Boolean);
  const minStart = starts.length ? new Date(Math.min(...starts)) : new Date();
  const maxEnd = ends.length ? new Date(Math.max(...ends)) : new Date(minStart.getTime() + 1000*60*60*24*30);
  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold">Timeline (Gantt)</h2>
      <div className="bg-white rounded-2xl p-4 border">
        <div className="space-y-3">
          {items.map((it) => {
            const leftPct = it.start && it.end ? Math.max(0, Math.min(100, ((it.start - minStart) / (maxEnd - minStart)) * 100)) : 0;
            const widthPct = it.start && it.end ? Math.max(0.5, Math.min(100, ((it.end - it.start) / (maxEnd - minStart)) * 100)) : 0;
            return (
              <div key={it.id} className="flex items-start gap-3">
                <div className="w-48 truncate text-sm pt-0.5">{it.name || "(untitled)"}</div>
                <div className="flex-1">
                  <div className="relative h-5 bg-slate-100 rounded-full overflow-hidden">
                    {it.start && it.end && <div className="absolute h-5 bg-indigo-500 rounded-full" style={{ left: `${leftPct}%`, width: `${widthPct}%` }} title={`${it.days} days`} />}
                  </div>
                  <div className="relative h-4">
                    {it.milestones.map((m, idx) => {
                      const d = toDate(m.date); if (!d) return null;
                      const left = Math.max(0, Math.min(100, ((d - minStart) / (maxEnd - minStart)) * 100));
                      return <div key={idx} className="absolute -top-2" style={{ left: `${left}%` }} title={`${m.date} - ${m.title}`}><div className="w-2 h-2 rounded-full bg-amber-500 border border-white shadow" /></div>;
                    })}
                  </div>
                </div>
                <div className="w-44 text-[11px] text-slate-500">{it.start?.toISOString().slice(0,10)} → {it.end?.toISOString().slice(0,10)}</div>
              </div>
            );
          })}
          {items.length === 0 && <div className="text-sm text-slate-500">Add projects to see the timeline.</div>}
        </div>
      </div>
    </div>
  );
}

/* ===================== Dashboard (KPIs + breakdown + overdue + CSV) ===================== */
function toCSV(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? "").replaceAll('"', '""').replaceAll("\n", " ")}"`;
  const lines = [headers.join(",")]; for (const r of rows) lines.push(headers.map((h) => esc(r[h])).join(","));
  return lines.join("\n");
}
function downloadCSV(filename, rows) {
  const csv = toCSV(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}
function Dashboard({ tasks, projects }) {
  const now = new Date();
  const counts = React.useMemo(() => {
    const byStatus = { "Todo": 0, "In Progress": 0, "Blocked": 0, "Done": 0 };
    let overdue = 0, total = tasks.length, done = 0, est = 0;
    for (const t of tasks) {
      byStatus[t.status || "Todo"] = (byStatus[t.status || "Todo"] || 0) + 1;
      if (t.status === "Done") done++;
      est += Number(t.estimateHrs || 0);
      if (t.dueDate && t.status !== "Done" && new Date(t.dueDate) < now) overdue++;
    }
    return { byStatus, overdue, total, done, est };
  }, [tasks]);

  const overdueList = React.useMemo(
    () => tasks.filter((t) => t.dueDate && t.status !== "Done" && new Date(t.dueDate) < now)
               .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)).slice(0, 20),
    [tasks]
  );

  const projectName = (id) => projects.find((p) => p.id === id)?.name || "";
  const tasksCSV = React.useMemo(() => tasks.map((t) => ({
    id: t.id, project: projectName(t.projectId), title: t.title, assignee: t.assignee,
    priority: t.priority, status: t.status, dueDate: t.dueDate, estimateHrs: t.estimateHrs, updatedAt: t.updatedAt
  })), [tasks, projects]);

  const bar = (n, total) => {
    const width = total ? Math.round((n / total) * 100) : 0;
    return <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-2 bg-indigo-500" style={{ width: `${width}%` }} /></div>;
  };
  const box = (label, value, sub) => (
    <div className="rounded-xl border bg-white p-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-4 gap-4">
        {box("Total Tasks", counts.total, `${counts.done} done`)}
        {box("Overdue", counts.overdue, "not done & past due")}
        {box("Estimated Hours", counts.est)}
        {box("Projects", projects.length)}
      </div>

      <div className="rounded-xl border bg-white p-4">
        <div className="font-semibold mb-3">Status Breakdown</div>
        <div className="grid md:grid-cols-2 gap-3">
          {["Todo", "In Progress", "Blocked", "Done"].map((s) => (
            <div key={s}>
              <div className="flex items-center justify-between text-sm mb-1">
                <span>{s}</span><span className="text-slate-500">{counts.byStatus[s] || 0}</span>
              </div>
              {bar(counts.byStatus[s] || 0, counts.total)}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold">Overdue (top 20)</div>
          <button className="px-3 py-1.5 rounded-lg border text-sm"
                  onClick={() => downloadCSV(`tasks_${new Date().toISOString().slice(0,10)}.csv`, tasksCSV)}>
            Export Tasks CSV
          </button>
        </div>
        {overdueList.length === 0 ? (
          <div className="text-sm text-slate-500">No overdue tasks — nice!</div>
        ) : (
          <div className="space-y-2">
            {overdueList.map((t) => (
              <div key={t.id} className="flex items-center justify-between text-sm border rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <div className="font-medium truncate">{t.title}</div>
                  <div className="text-xs text-slate-500">{t.assignee || "Unassigned"} · due {t.dueDate} · {t.priority}</div>
                </div>
                <span className="text-xs text-rose-600">OVERDUE</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ===================== Calendar (Month from due dates) ===================== */
function startOfMonth(d) { const x = new Date(d); x.setDate(1); x.setHours(0,0,0,0); return x; }
function endOfMonth(d) { const x = new Date(d); x.setMonth(x.getMonth()+1, 0); x.setHours(23,59,59,999); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function sameDay(a, b) { return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
function formatISO(d) { return d.toISOString().slice(0,10); }
function Calendar({ tasks }) {
  const [cursor, setCursor] = React.useState(() => { const t = new Date(); t.setDate(1); return t; });
  const monthStart = startOfMonth(cursor);
  const gridStart = addDays(monthStart, -((monthStart.getDay()+6)%7)); // Monday-start

  const tasksByDate = React.useMemo(() => {
    const m = new Map();
    for (const t of tasks) {
      if (!t.dueDate) continue;
      const key = t.dueDate;
      (m.get(key) || m.set(key, []).get(key)).push(t);
    }
    for (const [k, arr] of m) arr.sort((a,b) => (b.priority==="High") - (a.priority==="High") || a.status.localeCompare(b.status));
    return m;
  }, [tasks]);

  const weeks = [];
  let day = gridStart;
  for (let w=0; w<6; w++) {
    const cells = [];
    for (let i=0; i<7; i++) {
      const isCurMonth = day.getMonth() === cursor.getMonth();
      const key = formatISO(day);
      const list = tasksByDate.get(key) || [];
      cells.push(
        <div key={i} className={`h-36 border p-2 rounded-lg overflow-hidden ${isCurMonth ? "bg-white" : "bg-slate-50 text-slate-400"}`}>
          <div className="text-xs mb-1 flex items-center justify-between">
            <span className={`font-medium ${sameDay(day, new Date()) ? "text-indigo-600" : ""}`}>{day.getDate()}</span>
            {list.length > 0 && <span className="text-[11px] text-slate-500">{list.length}</span>}
          </div>
          <div className="space-y-1 overflow-y-auto pr-1" style={{ maxHeight: "2.9rem" }}>
            {list.slice(0,3).map(t => (
              <div key={t.id} title={`${t.title} · ${t.status} · ${t.priority}`} className={`text-[11px] truncate px-1 py-0.5 rounded ${t.status==="Done" ? "bg-emerald-100" : "bg-indigo-100"}`}>
                {t.title}
              </div>
            ))}
            {list.length > 3 && <div className="text-[11px] text-slate-500">+{list.length - 3} more</div>}
          </div>
        </div>
      );
      day = addDays(day, 1);
    }
    weeks.push(<div key={w} className="grid grid-cols-7 gap-2">{cells}</div>);
  }

  const monthName = cursor.toLocaleString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xl font-semibold">{monthName}</div>
        <div className="flex gap-2">
          <button className="px-3 py-1.5 rounded-lg border" onClick={() => setCursor(addDays(startOfMonth(cursor), -1))}>Prev</button>
          <button className="px-3 py-1.5 rounded-lg border" onClick={() => setCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Today</button>
          <button className="px-3 py-1.5 rounded-lg border" onClick={() => setCursor(addDays(endOfMonth(cursor), 1))}>Next</button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-2 text-[11px] text-slate-500">
        {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => <div key={d} className="px-2">{d}</div>)}
      </div>
      <div className="space-y-2">{weeks}</div>
      <div className="text-[11px] text-slate-500">Tip: tasks appear on the day of their <b>Due Date</b>. Mark <i>Done</i> to show in green.</div>
    </div>
  );
}

/* ===================== Settings (Notification targets + Tests) ===================== */
function Settings() {
  const [form, setForm] = React.useState(() => getNotifyDefaults());
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = () => {
    const next = setNotifyDefaults(form);
    setForm(next);
    alert("Notification settings saved.");
  };

  const testEmail = async () => {
    const r = await sendNotification({
      channel: "email",
      subject: "PM Lite — Test Email",
      message: "This is a test email from your PM app.",
    });
    alert(r.ok ? "Email test sent (check inbox or logs)." : "Email test failed.");
  };

  const testWhatsApp = async () => {
    const r = await sendNotification({
      channel: "whatsapp",
      subject: "PM Lite — Test WhatsApp",
      message: "This is a test WhatsApp message from your PM app.",
    });
    alert(r.ok ? "WhatsApp test sent (check device or logs)." : "WhatsApp test failed.");
  };

  const env = ENV_NOTIFY_DEFAULTS;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Settings</h2>
      <div className="bg-white rounded-2xl border p-4 space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>Default Email “To”</Label>
            <input className="w-full border rounded-lg px-3 py-1.5 text-sm"
                   placeholder={env.email} value={form.email} onChange={(e) => set("email", e.target.value)} />
            <div className="text-[11px] text-slate-500 mt-1">Used when sending email notifications.</div>
          </div>
          <div>
            <Label>Default WhatsApp “To” (E.164)</Label>
            <input className="w-full border rounded-lg px-3 py-1.5 text-sm"
                   placeholder={env.whatsapp} value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} />
            <div className="text-[11px] text-slate-500 mt-1">Example: +9665XXXXXXXX</div>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="px-3 py-1.5 rounded-lg border" onClick={save}>Save Settings</button>
          <button className="px-3 py-1.5 rounded-lg border" onClick={testEmail}>Send Test Email</button>
          <button className="px-3 py-1.5 rounded-lg border" onClick={testWhatsApp}>Send Test WhatsApp</button>
        </div>
        <div className="text-[11px] text-slate-500">
          Backend must be configured in Vercel env vars: <code>SENDGRID_API_KEY</code>, <code>SENDGRID_FROM</code>, <code>META_WHATSAPP_TOKEN</code>, <code>META_WHATSAPP_PHONE_ID</code>.
        </div>
      </div>
    </div>
  );
}

/* ===================== Root App with Tabs ===================== */
export default function App() {
  const [tab, setTab] = React.useState("calendar"); // try the Calendar by default

  const [tasks, setTasks] = React.useState(() => loadLS(LS_KEYS.TASKS, []));
  const [projects, setProjects] = React.useState(() => loadLS(LS_KEYS.PROJECTS, []));

  React.useEffect(() => saveLS(LS_KEYS.TASKS, tasks), [tasks]);
  React.useEffect(() => saveLS(LS_KEYS.PROJECTS, projects), [projects]);

  // Filters (for Kanban)
  const [query, setQuery] = React.useState("");
  const [fProject, setFProject] = React.useState("");
  const [fAssignee, setFAssignee] = React.useState("");
  const [fPriority, setFPriority] = React.useState("");
  const [swimlaneBy, setSwimlaneBy] = React.useState("None");

  const [draft, setDraft] = React.useState({ ...EMPTY_TASK });
  const assignees = React.useMemo(() => Array.from(new Set(tasks.map((t) => t.assignee).filter(Boolean))).sort(), [tasks]);

  const filtered = React.useMemo(() => tasks.filter((t) => {
    if (fProject && t.projectId !== fProject) return false;
    if (fAssignee && (t.assignee || "") !== fAssignee) return false;
    if (fPriority && (t.priority || "Medium") !== fPriority) return false;
    if (query) { const q = query.toLowerCase(); if (!(t.title?.toLowerCase().includes(q) || t.assignee?.toLowerCase().includes(q))) return false; }
    return true;
  }), [tasks, fProject, fAssignee, fPriority, query]);

  const saveTask = (task) => {
    const title = (task.title || "").trim(); if (!title) { alert("Please enter a title before saving."); return; }
    const normalized = { ...EMPTY_TASK, ...task, id: task.id || uid(), title, status: task.status || "Todo",
      priority: task.priority || "Medium", estimateHrs: Number(task.estimateHrs) || 0, updatedAt: new Date().toISOString() };
    const isNew = !tasks.some((t) => t.id === normalized.id);
    setTasks((prev) => prev.some((t) => t.id === normalized.id) ? prev.map((t) => (t.id === normalized.id ? normalized : t)) : [...prev, normalized]);
    setDraft({ ...EMPTY_TASK });
    setFProject(""); setFAssignee(""); setFPriority(""); setQuery("");
    notifyTaskSaved(normalized, isNew);
  };
  const deleteTask = (id) => { setTasks((prev) => prev.filter((t) => t.id !== id)); setDraft({ ...EMPTY_TASK }); };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Tabs */}
        <div className="flex items-center gap-2">
          {[
            ["dashboard","Dashboard"],
            ["calendar","Calendar"],
            ["tasks","Tasks"],
            ["projects","Projects"],
            ["timeline","Timeline"],
            ["settings","Settings"],
          ].map(([id,label]) => (
            <button key={id} className={`px-3 py-1.5 rounded-full border text-sm ${tab===id? "bg-indigo-600 text-white border-indigo-600":"bg-white"}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>

        {tab === "dashboard" && <div className="bg-white p-6 rounded-xl border"><Dashboard tasks={tasks} projects={projects} /></div>}
        {tab === "calendar" && <div className="bg-white p-6 rounded-xl border"><Calendar tasks={tasks} /></div>}

        {tab === "tasks" && (
          <>
            <div className="bg-white p-6 rounded-xl border">
              <h1 className="text-2xl font-bold mb-4">Project & Task Manager</h1>
              <TaskForm value={draft} onChange={setDraft} onSave={saveTask} onDelete={deleteTask}
                        projects={projects} onComment={(task, c) => notifyNewComment(task, c)} />
            </div>
            <div className="bg-white p-6 rounded-xl border space-y-4">
              <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                <div className="flex flex-wrap gap-2 items-end">
                  <input className="border rounded-lg px-2 py-1 text-sm" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
                  <select className="border rounded-lg px-2 py-1 text-sm" value={fProject} onChange={(e) => setFProject(e.target.value)}>
                    <option value="">All Projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <select className="border rounded-lg px-2 py-1 text-sm" value={fAssignee} onChange={(e) => setFAssignee(e.target.value)}>
                    <option value="">All Assignees</option>{assignees.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                  <select className="border rounded-lg px-2 py-1 text-sm" value={fPriority} onChange={(e) => setFPriority(e.target.value)}>
                    <option value="">All Priority</option>{["Low","Medium","High"].map((p)=> <option key={p} value={p}>{p}</option>)}
                  </select>
                  <select className="border rounded-lg px-2 py-1 text-sm" value={swimlaneBy} onChange={(e) => setSwimlaneBy(e.target.value)}>
                    {["None","Project","Assignee","Priority"].map((x)=><option key={x} value={x}>Swimlane: {x}</option>)}
                  </select>
                </div>
                <div className="flex gap-2">
                  <button className="px-3 py-1.5 rounded-lg border" onClick={() => setDraft({ ...EMPTY_TASK, status:"Todo", priority:"Medium" })}>New Task</button>
                  <button className="px-3 py-1.5 rounded-lg border" onClick={() => { setFProject(""); setFAssignee(""); setFPriority(""); setQuery(""); }}>Reset Filters</button>
                </div>
              </div>
              <KanbanBoard tasks={filtered} setTasks={(next) => setTasks(next)} onEdit={setDraft}
                           swimlaneBy={swimlaneBy} projects={projects}
                           onStatusChanged={(task, oldS, newS) => notifyStatusChange(task, oldS, newS)} />
            </div>
          </>
        )}

        {tab === "projects" && <div className="bg-white p-6 rounded-xl border"><ProjectsManager projects={projects} setProjects={setProjects} /></div>}
        {tab === "timeline" && (
          <div className="space-y-4">
            <div className="bg-white p-6 rounded-xl border"><Timeline projects={projects} /></div>
            <div className="text-xs text-slate-500">Tip: Add or edit projects (with start/end dates and milestones) in the <b>Projects</b> tab.</div>
          </div>
        )}
        {tab === "settings" && <div className="bg-white p-6 rounded-xl border"><Settings /></div>}
      </div>
    </div>
  );
}
