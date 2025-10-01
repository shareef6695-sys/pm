import React from "react";
import { createClient } from "@supabase/supabase-js";

/* ================== Supabase (guarded) ================== */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase =
  SUPABASE_URL && SUPABASE_ANON
    ? createClient(SUPABASE_URL, SUPABASE_ANON, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null;

/* ================== Local storage helpers ================== */
const LS = {
  TASKS: "pm_tasks_v1",
  PROJECTS: "pm_projects_v1",
  NOTIFY: "pm_notify_v1",
  SCHEMA: "pm_schema_v",
};
const load = (k, fallback) => {
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};
const save = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

/* ================== Schema migration (SAFE) ================== */
const SCHEMA_VERSION = 2;
function runMigrationsSafe(curTasks, curProjects) {
  const safeTasks = Array.isArray(curTasks) ? curTasks : [];
  const safeProjects = Array.isArray(curProjects) ? curProjects : [];

  let schema = Number(localStorage.getItem(LS.SCHEMA) || 1);
  if (!Number.isFinite(schema)) schema = 1;

  if (schema < SCHEMA_VERSION) {
    // v2: ensure every task has projectId as a string
    const migratedTasks = safeTasks.map((t) => ({
      ...t,
      projectId: typeof t.projectId === "string" ? t.projectId : "",
    }));
    save(LS.TASKS, migratedTasks);
    localStorage.setItem(LS.SCHEMA, String(SCHEMA_VERSION));
    return { tasks: migratedTasks, projects: safeProjects };
  }

  return { tasks: safeTasks, projects: safeProjects };
}

/* ================== Utils / constants ================== */
const uid = () => Math.random().toString(36).slice(2, 9);
const todayISO = () => new Date().toISOString().slice(0, 10);
const STATUSES = ["Todo", "In Progress", "Blocked", "Done"];
const EMPTY_TASK = {
  id: "",
  projectId: "",
  title: "",
  assignee: "",
  priority: "Medium",
  status: "Todo",
  dueDate: "",
  estimateHrs: 0,
  attachments: [],
  comments: [],
  updatedAt: "",
};
const EMPTY_PROJECT = { id: "", name: "", startDate: "", endDate: "", milestonesText: "" };
const upsertById = (list, item, key = "id") => {
  const i = list.findIndex((x) => x[key] === item[key]);
  if (i === -1) return [...list, item];
  const n = list.slice();
  n[i] = item;
  return n;
};

/* ================== Notifications (serverless) ================== */
const ENV_NOTIFY = {
  email: import.meta.env?.VITE_NOTIFY_EMAIL_TO || "ops@example.com",
  whatsapp: import.meta.env?.VITE_NOTIFY_WHATSAPP_TO || "+9665xxxxxxx",
};
const getNotify = () => {
  const v = load(LS.NOTIFY, {});
  return { email: v.email || ENV_NOTIFY.email, whatsapp: v.whatsapp || ENV_NOTIFY.whatsapp };
};
const setNotify = (p) => {
  const next = { ...getNotify(), ...p };
  save(LS.NOTIFY, next);
  return next;
};
async function notify({ channel, subject, message, to }) {
  const d = getNotify();
  const target = to || (channel === "email" ? d.email : d.whatsapp);
  try {
    await fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, subject, message, to: target }),
    });
  } catch {}
}
const notifyTaskSaved = (t, isNew) =>
  notify({
    channel: "email",
    subject: isNew ? `New task: ${t.title}` : `Task updated: ${t.title}`,
    message: `Status: ${t.status}\nAssignee: ${t.assignee || "Unassigned"}\nDue: ${
      t.dueDate || "TBD"
    }`,
  });
const notifyStatusChange = (t, from, to) =>
  notify({
    channel: "whatsapp",
    subject: `Status: ${t.title} → ${to}`,
    message: `${from} → ${to} · ${t.assignee || "Unassigned"} · Due ${t.dueDate || "TBD"}`,
  });
const notifyNewComment = (t, c) =>
  notify({
    channel: "email",
    subject: `New comment on ${t.title}`,
    message: `${c.author || "Someone"}: ${c.text}`,
  });

/* ================== Supabase helpers ================== */
async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}
async function signInWithEmail(email) {
  if (!supabase) return alert("Cloud disabled: set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY in Vercel.");
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) alert(error.message);
  else alert("Magic link sent. Check your email.");
}
async function signOut() {
  if (supabase) await supabase.auth.signOut();
}

const rowToProject = (p) => ({
  id: p.id,
  name: p.name,
  startDate: p.start_date || "",
  endDate: p.end_date || "",
  milestonesText: p.milestones_text || "",
});
const rowToTask = (r) => ({
  id: r.id,
  projectId: r.project_id || "",
  title: r.title,
  assignee: r.assignee || "",
  priority: r.priority || "Medium",
  status: r.status || "Todo",
  dueDate: r.due_date || "",
  estimateHrs: r.estimate_hrs || 0,
  attachments: r.attachments || [],
  comments: r.comments || [],
  updatedAt: r.updated_at || "",
});

async function fetchProjects() {
  if (!supabase) return [];
  const { data, error } = await supabase.from("projects").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  return data.map(rowToProject);
}
async function fetchTasks() {
  if (!supabase) return [];
  const { data, error } = await supabase.from("tasks").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  return data.map(rowToTask);
}
async function upsertProject(p) {
  if (!supabase) return p;
  const user_id = (await getSession())?.user?.id;
  if (!user_id) return p;
  const payload = {
    id: p.id || undefined,
    user_id,
    name: p.name,
    start_date: p.startDate || null,
    end_date: p.endDate || null,
    milestones_text: p.milestonesText || "",
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("projects").upsert(payload).select("*").single();
  if (error) throw error;
  return rowToProject(data);
}
async function deleteProjectCloud(id) {
  if (!supabase) return;
  await supabase.from("projects").delete().eq("id", id);
}
async function upsertTask(t) {
  if (!supabase) return t;
  const user_id = (await getSession())?.user?.id;
  if (!user_id) return t;
  const payload = {
    id: t.id || undefined,
    user_id,
    project_id: t.projectId || null,
    title: t.title,
    assignee: t.assignee || null,
    priority: t.priority || "Medium",
    status: t.status || "Todo",
    due_date: t.dueDate || null,
    estimate_hrs: Number(t.estimateHrs || 0),
    attachments: t.attachments || [],
    comments: t.comments || [],
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("tasks").upsert(payload).select("*").single();
  if (error) throw error;
  return rowToTask(data);
}
async function deleteTaskCloud(id) {
  if (!supabase) return;
  await supabase.from("tasks").delete().eq("id", id);
}
async function uploadAttachment(file) {
  if (!supabase) throw new Error("Cloud disabled.");
  const uid = (await getSession())?.user?.id;
  if (!uid) throw new Error("Sign in first.");
  const path = `${uid}/${Date.now()}_${file.name}`;
  const { error } = await supabase.storage.from("attachments").upload(path, file, { upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from("attachments").getPublicUrl(path);
  return { name: file.name, url: data.publicUrl, size: file.size };
}

/* ================== Small UI atoms ================== */
function Label({ children }) {
  return <label className="block text-sm font-medium text-slate-700 mb-1">{children}</label>;
}
function Text({ label, value, onChange, type = "text", placeholder, required }) {
  return (
    <div>
      <Label>
        {label}
        {required && <span className="text-rose-600"> *</span>}
      </Label>
      <input
        type={type}
        className="w-full border rounded-lg px-3 py-1.5 text-sm"
        value={value || ""}
        placeholder={placeholder}
        required={required}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
function Number({ label, value, onChange }) {
  return (
    <div>
      <Label>{label}</Label>
      <input
        type="number"
        className="w-full border rounded-lg px-3 py-1.5 text-sm"
        value={value ?? ""}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
function Select({ label, value, onChange, options }) {
  return (
    <div>
      <Label>{label}</Label>
      <select className="w-full border rounded-lg px-3 py-1.5 text-sm" value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ================== Top Bar ================== */
function TopBar() {
  return (
    <div className="sticky top-0 z-30 backdrop-blur bg-white/70 border-b">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-xl bg-blue-600 grid place-items-center text-white font-bold">PM</div>
          <div className="font-semibold text-blue-700">Project Manager</div>
        </div>
        <span className="chip-live">Live</span>
      </div>
    </div>
  );
}

/* ================== Modal ================== */
function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute inset-0 flex items-start justify-center p-4 md:p-8">
        <div className="w-full max-w-2xl bg-white rounded-2xl border shadow-lg">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div className="font-semibold">{title}</div>
            <button className="btn" onClick={onClose}>
              Close
            </button>
          </div>
          <div className="p-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

/* ================== Auth Bar ================== */
function AuthBar({ onSignedIn }) {
  const [email, setEmail] = React.useState("");
  const [session, setSession] = React.useState(null);

  React.useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      onSignedIn?.(s);
    });
    return () => sub?.subscription?.unsubscribe();
  }, [onSignedIn]);

  if (!supabase) return <div className="text-xs text-slate-500">Cloud disabled</div>;
  if (session)
    return (
      <div className="flex items-center gap-2 text-sm">
        <div className="text-slate-600">Signed in as {session.user.email}</div>
        <button className="btn" onClick={signOut}>
          Sign out
        </button>
      </div>
    );

  return (
    <div className="flex items-center gap-2 text-sm">
      <input className="border rounded px-2 py-1" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button className="btn" onClick={() => email && signInWithEmail(email)}>
        Send sign-in link
      </button>
    </div>
  );
}

/* ================== Task Form ================== */
function TaskForm({ value, onChange, onSave, onDelete, projects, onComment }) {
  const set = (k, v) => onChange({ ...value, [k]: v, updatedAt: new Date().toISOString() });

  const addAttachment = async (file) => {
    if (!file) return;
    try {
      const uploaded = await uploadAttachment(file);
      set("attachments", [...(value.attachments || []), uploaded]);
    } catch (e) {
      alert("Upload failed: " + String(e.message || e));
    }
  };
  const removeAttachment = (name) => set("attachments", (value.attachments || []).filter((a) => a.name !== name));

  const [author, setAuthor] = React.useState("");
  const [text, setText] = React.useState("");
  const addComment = () => {
    if (!text.trim()) return;
    const c = { id: uid(), author: author.trim(), text: text.trim(), ts: new Date().toISOString() };
    set("comments", [...(value.comments || []), c]);
    setText("");
    onComment?.(value, c);
  };

  const titleOK = (value.title || "").trim().length > 0;

  return (
    <div className="space-y-3">
      <Text label="Title" value={value.title} onChange={(v) => set("title", v)} required />
      <div className="grid md:grid-cols-2 gap-3">
        <Select
          label="Project"
          value={value.projectId}
          onChange={(v) => set("projectId", v)}
          options={[{ value: "", label: "—" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
        />
        <Text label="Assignee" value={value.assignee} onChange={(v) => set("assignee", v)} placeholder="Name or email" />
        <Select label="Priority" value={value.priority || "Medium"} onChange={(v) => set("priority", v)} options={["Low", "Medium", "High"].map((x) => ({ value: x, label: x }))} />
        <Select label="Status" value={value.status || "Todo"} onChange={(v) => set("status", v)} options={STATUSES.map((x) => ({ value: x, label: x }))} />
        <Text label="Due Date" type="date" value={value.dueDate} onChange={(v) => set("dueDate", v)} />
        <Number label="Estimate (hrs)" value={value.estimateHrs || 0} onChange={(v) => set("estimateHrs", v)} />
      </div>

      <div className="pt-2">
        <Label>Attachments</Label>
        <label className="btn cursor-pointer">
          Add file
          <input type="file" className="hidden" onChange={(e) => addAttachment(e.target.files?.[0])} />
        </label>
        <ul className="space-y-2 mt-2 max-h-32 overflow-auto pr-2">
          {(value.attachments || []).map((a) => (
            <li key={a.url || a.name} className="flex items-center justify-between text-sm">
              <a className="underline truncate" href={a.url} target="_blank" rel="noreferrer">
                {a.name}
              </a>
              <button className="text-rose-600 text-xs" onClick={() => removeAttachment(a.name)}>
                remove
              </button>
            </li>
          ))}
          {!(value.attachments || []).length && <div className="text-xs text-slate-400">No files attached.</div>}
        </ul>
      </div>

      <div className="pt-2">
        <Label>Comments</Label>
        <div className="grid md:grid-cols-2 gap-2">
          <input className="border rounded px-2 py-1 text-sm" placeholder="Your name (optional)" value={author} onChange={(e) => setAuthor(e.target.value)} />
          <div className="flex gap-2">
            <input className="flex-1 border rounded px-2 py-1 text-sm" placeholder="Write a comment" value={text} onChange={(e) => setText(e.target.value)} />
            <button className="btn" onClick={addComment}>
              Add
            </button>
          </div>
        </div>
        <ul className="space-y-2 mt-2 max-h-36 overflow-auto pr-2">
          {(value.comments || []).map((c) => (
            <li key={c.id} className="text-sm">
              <div className="text-[11px] text-slate-500">
                {(c.author || "Comment")} • {new Date(c.ts).toLocaleString()}
              </div>
              <div>{c.text}</div>
            </li>
          ))}
          {!(value.comments || []).length && <div className="text-xs text-slate-400">No comments yet.</div>}
        </ul>
      </div>

      <div className="flex gap-2 pt-2">
        <button className={`btn ${titleOK ? "btn-primary" : "opacity-50 cursor-not-allowed"}`} onClick={() => titleOK && onSave(value)} disabled={!titleOK}>
          Save
        </button>
        {value.id && (
          <button className="btn text-rose-600" onClick={() => onDelete(value.id)}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

/* ================== Task card & Kanban ================== */
function TaskCard({ task, onEdit }) {
  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", task.id)}
      className="rounded-2xl border p-3 bg-white hover:shadow-md shadow-sm cursor-grab active:cursor-grabbing transition-shadow"
      onClick={() => onEdit(task)}
    >
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
        {(task.attachments?.length || 0)} file(s) · {(task.comments?.length || 0)} comment(s)
      </div>
    </div>
  );
}

function Kanban({ tasks = [], setTasks, onEdit, swimlaneBy = "None", projects = [], onStatusChanged }) {
  const grouped = React.useMemo(() => {
    const m = new Map(STATUSES.map((s) => [s, []]));
    tasks.forEach((t) => m.get(t.status || "Todo").push(t));
    return m;
  }, [tasks]);

  const projName = (id) => projects.find((p) => p.id === id)?.name || "(No project)";
  const keyFor = (t) =>
    swimlaneBy === "Project" ? projName(t.projectId) : swimlaneBy === "Assignee" ? t.assignee || "Unassigned" : swimlaneBy === "Priority" ? t.priority || "Medium" : "__none__";
  const groupList = (list) =>
    swimlaneBy === "None" ? { __none__: list } : list.reduce((a, t) => ((a[keyFor(t)] ||= []).push(t), a), {});

  const onDropTo = (status) => (e) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    setTasks((prev) => {
      const t = prev.find((x) => x.id === id);
      if (!t || t.status === status) return prev;
      const old = t.status || "Todo";
      const next = prev.map((x) => (x.id === id ? { ...x, status, updatedAt: new Date().toISOString() } : x));
      queueMicrotask(() => onStatusChanged?.({ ...t, status }, old, status));
      return next;
    });
  };

  return (
    <div className="grid md:grid-cols-4 gap-4">
      {STATUSES.map((status) => {
        const lanes = groupList(grouped.get(status) || []);
        const keys = Object.keys(lanes);
        return (
          <div key={status} className="card p-3">
            <div className="font-semibold text-sm mb-2">{status}</div>
            <div className="space-y-3">
              {keys.map((k) => (
                <div key={k}>
                  {k !== "__none__" && <div className="text-[11px] text-slate-500 mb-1">{k}</div>}
                  <div className="space-y-2 min-h-[120px]" onDragOver={(e) => e.preventDefault()} onDrop={onDropTo(status)}>
                    {lanes[k].map((t) => (
                      <TaskCard key={t.id} task={t} onEdit={onEdit} />
                    ))}
                    {lanes[k].length === 0 && <div className="text-[11px] text-slate-400">Drop tasks here</div>}
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

/* ================== Projects (milestones) ================== */
const parseMilestones = (text) =>
  (text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(\d{4}-\d{2}-\d{2})\s*-\s*(.*)$/);
      return m ? { date: m[1], title: m[2] } : null;
    })
    .filter(Boolean);
const toDate = (d) => (d ? new Date(d + "T00:00:00") : null);
const daysBetween = (a, b) => (!a || !b ? 0 : Math.ceil(Math.abs(toDate(b) - toDate(a)) / (1000 * 60 * 60 * 24)));

function ProjectForm({ value, onChange, onSave, onDelete }) {
  const parseRows = React.useCallback(
    (text) =>
      (text || "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const m = line.match(/^(\d{4}-\d{2}-\d{2})\s*-\s*(.*)$/);
          return m ? { date: m[1], title: m[2] } : { date: "", title: line };
        }),
    []
  );
  const toText = React.useCallback((rows) => rows.filter((r) => r.date || r.title).map((r) => `${r.date || ""} - ${r.title || ""}`.trim()).join("\n"), []);
  const [rows, setRows] = React.useState(() => parseRows(value.milestonesText || ""));
  React.useEffect(() => {
    setRows(parseRows(value.milestonesText || ""));
  }, [value.id, value.milestonesText, parseRows]);

  const setField = (k, v) => onChange({ ...value, [k]: v });
  const updateRow = (i, p) => {
    const nx = rows.slice();
    nx[i] = { ...nx[i], ...p };
    setRows(nx);
    setField("milestonesText", toText(nx));
  };
  const addRow = () => {
    const nx = [...rows, { date: "", title: "" }];
    setRows(nx);
    setField("milestonesText", toText(nx));
  };
  const removeRow = (i) => {
    const nx = rows.filter((_, x) => x !== i);
    setRows(nx);
    setField("milestonesText", toText(nx));
  };

  return (
    <div className="space-y-3">
      <div className="grid md:grid-cols-2 gap-3">
        <Text label="Project Name" value={value.name} onChange={(v) => setField("name", v)} required />
        <Text label="Start Date" type="date" value={value.startDate} onChange={(v) => setField("startDate", v)} />
        <Text label="End Date" type="date" value={value.endDate} onChange={(v) => setField("endDate", v)} />
      </div>
      <div className="space-y-2">
        <Label>Milestones</Label>
        <div className="text-xs text-slate-500 -mt-1">
          Each milestone has a <b>Date</b> and a <b>Title</b>.
        </div>
        <div className="space-y-2">
          {rows.length === 0 && <div className="text-xs text-slate-400">No milestones yet. Click “Add milestone”.</div>}
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-3">
                <Label className="text-xs">Date</Label>
                <input type="date" className="w-full border rounded-lg px-3 py-1.5 text-sm" value={r.date} onChange={(e) => updateRow(i, { date: e.target.value })} />
              </div>
              <div className="col-span-8">
                <Label className="text-xs">Title</Label>
                <input type="text" className="w-full border rounded-lg px-3 py-1.5 text-sm" value={r.title} placeholder="Kickoff / Go-live…" onChange={(e) => updateRow(i, { title: e.target.value })} />
              </div>
              <div className="col-span-1 flex justify-end">
                <button className="btn text-rose-600" onClick={() => removeRow(i)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
        <button className="btn" onClick={addRow}>
          + Add milestone
        </button>
      </div>
      <div className="flex gap-2 pt-1">
        <button className="btn btn-primary" onClick={() => onSave(value)}>
          Save
        </button>
        {value.id && (
          <button className="btn text-rose-600" onClick={() => onDelete(value.id)}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function ProjectsManager({ projects, setProjects, setTasks }) {
  const [draft, setDraft] = React.useState(null);
  const onCreate = () => setDraft({ ...EMPTY_PROJECT, id: uid() });
  const onEdit = (p) => setDraft(p);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Projects</h2>
        <button className="btn" onClick={onCreate}>
          New Project
        </button>
      </div>

      {draft && (
        <div className="card">
          <h3 className="font-semibold mb-3">{draft.name || "New Project"}</h3>
          <ProjectForm
            value={draft}
            onChange={setDraft}
            onSave={async (p) => {
              setProjects((prev) => (prev.some((x) => x.id === p.id) ? prev.map((x) => (x.id === p.id ? p : x)) : [...prev, p]));
              setDraft(null);
              try {
                const s = await getSession();
                if (s?.user) await upsertProject(p);
              } catch {}
            }}
            onDelete={async (id) => {
              setProjects((prev) => prev.filter((x) => x.id !== id));
              setTasks((prev) => prev.map((t) => (t.projectId === id ? { ...t, projectId: "" } : t)));
              setDraft(null);
              try {
                const s = await getSession();
                if (s?.user) await deleteProjectCloud(id);
              } catch {}
            }}
          />
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {projects.map((p) => (
          <div key={p.id} className="card p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-semibold">{p.name}</div>
                <div className="text-xs text-slate-500">
                  {p.startDate || "?"} → {p.endDate || "?"} ({daysBetween(p.startDate, p.endDate)} days)
                </div>
              </div>
              <button className="btn" onClick={() => onEdit(p)}>
                Edit
              </button>
            </div>
            <div className="mt-3">
              <div className="text-xs text-slate-500 mb-1">Milestones</div>
              <ul className="text-sm list-disc ml-5 space-y-1 max-h-28 overflow-auto pr-2">
                {parseMilestones(p.milestonesText).map((m, i) => (
                  <li key={i}>
                    {m.date} — {m.title}
                  </li>
                ))}
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

/* ================== Timeline ================== */
function Timeline({ projects }) {
  const items = React.useMemo(
    () =>
      projects.map((p) => ({
        id: p.id,
        name: p.name,
        start: toDate(p.startDate),
        end: toDate(p.endDate),
        days: daysBetween(p.startDate, p.endDate),
        milestones: parseMilestones(p.milestonesText || ""),
      })),
    [projects]
  );
  const starts = items.map((i) => i.start).filter(Boolean);
  const ends = items.map((i) => i.end).filter(Boolean);
  const minStart = starts.length ? new Date(Math.min(...starts)) : new Date();
  const maxEnd = ends.length ? new Date(Math.max(...ends)) : new Date(minStart.getTime() + 1000 * 60 * 60 * 24 * 30);

  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold">Timeline (Gantt)</h2>
      <div className="card p-4">
        <div className="space-y-3">
          {items.map((it) => {
            const leftPct =
              it.start && it.end ? Math.max(0, Math.min(100, ((it.start - minStart) / (maxEnd - minStart)) * 100)) : 0;
            const widthPct =
              it.start && it.end ? Math.max(0.5, Math.min(100, ((it.end - it.start) / (maxEnd - minStart)) * 100)) : 0;
            return (
              <div key={it.id} className="flex items-start gap-3">
                <div className="w-48 truncate text-sm pt-0.5">{it.name || "(untitled)"}</div>
                <div className="flex-1">
                  <div className="relative h-5 bg-slate-100 rounded-full overflow-hidden">
                    {it.start && it.end && (
                      <div className="absolute h-5 bg-blue-500 rounded-full" style={{ left: `${leftPct}%`, width: `${widthPct}%` }} title={`${it.days} days`} />
                    )}
                  </div>
                  <div className="relative h-4">
                    {it.milestones.map((m, idx) => {
                      const d = toDate(m.date);
                      if (!d) return null;
                      const left = Math.max(0, Math.min(100, ((d - minStart) / (maxEnd - minStart)) * 100));
                      return (
                        <div key={idx} className="absolute -top-2" style={{ left: `${left}%` }} title={`${m.date} - ${m.title}`}>
                          <div className="w-2 h-2 rounded-full bg-amber-500 border border-white shadow" />
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="w-44 text-[11px] text-slate-500">
                  {it.start?.toISOString().slice(0, 10)} → {it.end?.toISOString().slice(0, 10)}
                </div>
              </div>
            );
          })}
          {items.length === 0 && <div className="text-sm text-slate-500">Add projects to see the timeline.</div>}
        </div>
      </div>
    </div>
  );
}

/* ================== Dashboard ================== */
function toCSV(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? "").replaceAll('"', '""').replaceAll("\n", " ") }"`;
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map((h) => esc(r[h])).join(","));
  return lines.join("\n");
}
function downloadCSV(filename, rows) {
  const csv = toCSV(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function Dashboard({ tasks = [], projects = [] }) {
  const now = new Date();
  const counts = React.useMemo(() => {
    const byStatus = { Todo: 0, "In Progress": 0, Blocked: 0, Done: 0 };
    let overdue = 0,
      total = tasks.length,
      done = 0,
      est = 0;
    for (const t of tasks) {
      byStatus[t.status || "Todo"] = (byStatus[t.status || "Todo"] || 0) + 1;
      if (t.status === "Done") done++;
      est += Number(t.estimateHrs || 0);
      if (t.dueDate && t.status !== "Done" && new Date(t.dueDate) < now) overdue++;
    }
    return { byStatus, overdue, total, done, est };
  }, [tasks]);

  const overdueList = React.useMemo(
    () => tasks.filter((t) => t.dueDate && t.status !== "Done" && new Date(t.dueDate) < now).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)).slice(0, 20),
    [tasks]
  );
  const projectName = (id) => projects.find((p) => p.id === id)?.name || "";
  const tasksCSV = tasks.map((t) => ({
    id: t.id,
    project: projectName(t.projectId),
    title: t.title,
    assignee: t.assignee,
    priority: t.priority,
    status: t.status,
    dueDate: t.dueDate,
    estimateHrs: t.estimateHrs,
    updatedAt: t.updatedAt,
  }));

  const bar = (n, total) => (
    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
      <div className="h-2 bg-blue-500" style={{ width: `${total ? Math.round((n / total) * 100) : 0}%` }} />
    </div>
  );
  const box = (label, value, sub) => (
    <div className="card p-4">
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
      <div className="card p-4">
        <div className="font-semibold mb-3">Status Breakdown</div>
        <div className="grid md:grid-cols-2 gap-3">
          {["Todo", "In Progress", "Blocked", "Done"].map((s) => (
            <div key={s}>
              <div className="flex items-center justify-between text-sm mb-1">
                <span>{s}</span>
                <span className="text-slate-500">{counts.byStatus[s] || 0}</span>
              </div>
              {bar(counts.byStatus[s] || 0, counts.total)}
            </div>
          ))}
        </div>
      </div>
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold">Overdue (top 20)</div>
          <button className="btn" onClick={() => downloadCSV(`tasks_${todayISO()}.csv`, tasksCSV)}>
            Export Tasks CSV
          </button>
        </div>
        {overdueList.length === 0 ? (
          <div className="text-sm text-slate-500">No overdue tasks — nice!</div>
        ) : (
          <div className="space-y-2">
            {overdueList.map((t) => (
              <div key={t.id} className="flex items-center justify-between text-sm border rounded-lg px-3 py-2 bg-white">
                <div className="min-w-0">
                  <div className="font-medium truncate">{t.title}</div>
                  <div className="text-xs text-slate-500">
                    {t.assignee || "Unassigned"} · due {t.dueDate} · {t.priority}
                  </div>
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

/* ================== Calendar (add + drilldown) ================== */
function startOfMonth(d) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfMonth(d) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + 1, 0);
  x.setHours(23, 59, 59, 999);
  return x;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function iso(d) {
  return d.toISOString().slice(0, 10);
}

function Calendar({ tasks = [], onCreateTaskForDate, onOpenTask }) {
  const [cursor, setCursor] = React.useState(() => {
    const t = new Date();
    t.setDate(1);
    return t;
  });
  const monthStart = startOfMonth(cursor);
  const gridStart = addDays(monthStart, -((monthStart.getDay() + 6) % 7)); // Monday

  const tasksByDate = React.useMemo(() => {
    const m = new Map();
    for (const t of tasks) {
      if (!t.dueDate) continue;
      const k = t.dueDate;
      (m.get(k) || m.set(k, []).get(k)).push(t);
    }
    for (const [k, arr] of m) arr.sort((a, b) => (b.priority === "High") - (a.priority === "High") || a.status.localeCompare(b.status));
    return m;
  }, [tasks]);

  const weeks = [];
  let day = gridStart;
  for (let w = 0; w < 6; w++) {
    const cells = [];
    for (let i = 0; i < 7; i++) {
      const inMonth = day.getMonth() === cursor.getMonth();
      const key = iso(day);
      const list = tasksByDate.get(key) || [];
      cells.push(
        <div key={i} className={`h-36 border p-2 rounded-lg overflow-hidden relative group ${inMonth ? "bg-white" : "bg-slate-50 text-slate-400"}`}>
          {/* date + add button */}
          <div className="text-xs mb-1 flex items-center justify-between">
            <span className={`font-medium ${sameDay(day, new Date()) ? "text-blue-600" : ""}`}>{day.getDate()}</span>
            <button title="Add task on this day" className="opacity-0 group-hover:opacity-100 btn text-xs px-2 py-0.5" onClick={() => onCreateTaskForDate?.(key)}>
              +
            </button>
          </div>

          {/* tasks list */}
          <div className="space-y-1 overflow-y-auto pr-1" style={{ maxHeight: "2.9rem" }}>
            {list.slice(0, 3).map((t) => (
              <button
                key={t.id}
                title={`${t.title} · ${t.status} · ${t.priority}`}
                className={`w-full text-left text-[11px] truncate px-1 py-0.5 rounded ${t.status === "Done" ? "bg-emerald-100" : "bg-blue-100"}`}
                onClick={() => onOpenTask?.(t)}
              >
                {t.title}
              </button>
            ))}
            {list.length > 3 && <div className="text-[11px] text-slate-500">+{list.length - 3} more</div>}
          </div>
        </div>
      );
      day = addDays(day, 1);
    }
    weeks.push(
      <div key={w} className="grid grid-cols-7 gap-2">
        {cells}
      </div>
    );
  }

  const monthName = cursor.toLocaleString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xl font-semibold">{monthName}</div>
        <div className="flex gap-2">
          <button className="btn" onClick={() => setCursor(addDays(startOfMonth(cursor), -1))}>
            Prev
          </button>
          <button
            className="btn"
            onClick={() => setCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}
          >
            Today
          </button>
          <button className="btn" onClick={() => setCursor(addDays(endOfMonth(cursor), 1))}>
            Next
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-2 text-[11px] text-slate-500">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="px-2">
            {d}
          </div>
        ))}
      </div>
      <div className="space-y-2">{weeks}</div>
      <div className="text-[11px] text-slate-500">
        Tip: click the <b>+</b> on a day to add a task; click a task chip to open details.
      </div>
    </div>
  );
}

/* ================== Settings ================== */
function Settings() {
  const [form, setForm] = React.useState(() => getNotify());
  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));
  const saveNotify = () => {
    const next = setNotify(form);
    setForm(next);
    alert("Notification settings saved.");
  };
  const testEmail = () => notify({ channel: "email", subject: "PM Lite — Test Email", message: "Test message" });
  const testWhatsApp = () => notify({ channel: "whatsapp", subject: "PM Lite — Test WhatsApp", message: "Test message" });

  const exportJSON = () => {
    const payload = {
      pm_tasks_v1: JSON.parse(localStorage.getItem("pm_tasks_v1") || "[]"),
      pm_projects_v1: JSON.parse(localStorage.getItem("pm_projects_v1") || "[]"),
      pm_notify_v1: JSON.parse(localStorage.getItem("pm_notify_v1") || "{}"),
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pm-backup-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  const importJSON = (file) =>
    new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => {
        try {
          const d = JSON.parse(fr.result);
          if (d.pm_tasks_v1) localStorage.setItem("pm_tasks_v1", JSON.stringify(d.pm_tasks_v1));
          if (d.pm_projects_v1) localStorage.setItem("pm_projects_v1", JSON.stringify(d.pm_projects_v1));
          if (d.pm_notify_v1) localStorage.setItem("pm_notify_v1", JSON.stringify(d.pm_notify_v1));
          res(true);
        } catch (e) {
          rej(e);
        }
      };
      fr.onerror = rej;
      fr.readAsText(file);
    });

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Settings</h2>
      <div className="card space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>Default Email “To”</Label>
            <input className="w-full border rounded-lg px-3 py-1.5 text-sm" placeholder={ENV_NOTIFY.email} value={form.email} onChange={(e) => set("email", e.target.value)} />
          </div>
          <div>
            <Label>Default WhatsApp “To” (E.164)</Label>
            <input className="w-full border rounded-lg px-3 py-1.5 text-sm" placeholder={ENV_NOTIFY.whatsapp} value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-primary" onClick={saveNotify}>
            Save Settings
          </button>
          <button className="btn" onClick={testEmail}>
            Send Test Email
          </button>
          <button className="btn" onClick={testWhatsApp}>
            Send Test WhatsApp
          </button>
        </div>

        <div className="pt-2 border-t mt-2">
          <div className="text-sm font-semibold mb-2">Backup & Restore</div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn" onClick={exportJSON}>
              Export JSON
            </button>
            <label className="btn cursor-pointer">
              Import JSON
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    await importJSON(f);
                    alert("Import complete. Reloading…");
                    location.reload();
                  } catch (err) {
                    alert("Import failed: " + String(err));
                  }
                }}
              />
            </label>
          </div>
        </div>

        <div className="pt-2 border-t mt-2">
          <div className="text-sm font-semibold mb-2">Cloud Sync (Supabase)</div>
          <button
            className="btn"
            onClick={async () => {
              const tasks = JSON.parse(localStorage.getItem("pm_tasks_v1") || "[]");
              const projects = JSON.parse(localStorage.getItem("pm_projects_v1") || "[]");
              for (const p of projects) await upsertProject(p);
              for (const t of tasks) await upsertTask(t);
              alert("Synced Local → Cloud");
            }}
          >
            Sync Local → Cloud
          </button>
          <div className="text-[11px] text-slate-500 mt-1">Requires sign-in (top-right).</div>
        </div>
      </div>
    </div>
  );
}

/* ================== Root App ================== */
export default function App() {
  // ---- Safe initial state (no boot object) ----
  const [tasks, setTasks] = React.useState(() => {
    const parsed = load(LS.TASKS, []);
    return Array.isArray(parsed) ? parsed : [];
  });
  const [projects, setProjects] = React.useState(() => {
    const parsed = load(LS.PROJECTS, []);
    return Array.isArray(parsed) ? parsed : [];
  });

  // Persist on change
  React.useEffect(() => save(LS.TASKS, tasks || []), [tasks]);
  React.useEffect(() => save(LS.PROJECTS, projects || []), [projects]);

  // Run migration once after mount
  React.useEffect(() => {
    const { tasks: t2, projects: p2 } = runMigrationsSafe(tasks, projects);
    if (t2 !== tasks) setTasks(t2);
    if (p2 !== projects) setProjects(p2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filters & UI
  const [tab, setTab] = React.useState("calendar");
  const [query, setQuery] = React.useState("");
  const [fProject, setFProject] = React.useState("");
  const [fAssignee, setFAssignee] = React.useState("");
  const [fPriority, setFPriority] = React.useState("");
  const [swimlaneBy, setSwimlaneBy] = React.useState("None");
  const [draft, setDraft] = React.useState({ ...EMPTY_TASK });

  const assignees = React.useMemo(
    () => Array.from(new Set((tasks || []).map((t) => t.assignee).filter(Boolean))).sort(),
    [tasks]
  );

  // Calendar drill-down modal state
  const [calendarDraft, setCalendarDraft] = React.useState(null);
  const createTaskForDate = (dateISO) => setCalendarDraft({ ...EMPTY_TASK, id: uid(), dueDate: dateISO, status: "Todo", priority: "Medium" });
  const openTaskDetails = (task) => setCalendarDraft(task);

  // Cloud load on sign-in
  React.useEffect(() => {
    if (!supabase) return;
    const sub = supabase.auth.onAuthStateChange(async (_e, s) => {
      if (s?.user) {
        const [cp, ct] = await Promise.all([fetchProjects(), fetchTasks()]);
        setProjects(cp);
        setTasks(ct);
      }
    });
    return () => sub.data.subscription.unsubscribe();
  }, []);

  // Realtime sync (if supabase available)
  React.useEffect(() => {
    if (!supabase) return;
    let channel;
    (async () => {
      const s = await supabase.auth.getSession();
      const user = s.data.session?.user;
      if (!user) return;
      channel = supabase
        .channel("pm-realtime")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "projects", filter: `user_id=eq.${user.id}` },
          (p) => {
            if (p.eventType === "DELETE") {
              const id = p.old.id;
              setProjects((prev) => prev.filter((x) => x.id !== id));
              setTasks((prev) => prev.map((t) => (t.projectId === id ? { ...t, projectId: "" } : t)));
            } else {
              const a = rowToProject(p.new);
              setProjects((prev) => upsertById(prev, a));
            }
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "tasks", filter: `user_id=eq.${user.id}` },
          (p) => {
            if (p.eventType === "DELETE") {
              const id = p.old.id;
              setTasks((prev) => prev.filter((x) => x.id !== id));
            } else {
              const a = rowToTask(p.new);
              setTasks((prev) => upsertById(prev, a));
            }
          }
        )
        .subscribe();
    })();
    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  const filtered = React.useMemo(
    () =>
      (tasks || []).filter((t) => {
        if (fProject && t.projectId !== fProject) return false;
        if (fAssignee && (t.assignee || "") !== fAssignee) return false;
        if (fPriority && (t.priority || "Medium") !== fPriority) return false;
        if (query) {
          const q = query.toLowerCase();
          if (!(t.title?.toLowerCase().includes(q) || t.assignee?.toLowerCase().includes(q))) return false;
        }
        return true;
      }),
    [tasks, fProject, fAssignee, fPriority, query]
  );

  const saveTask = async (task) => {
    const title = (task.title || "").trim();
    if (!title) return alert("Please enter a title");
    const normalized = {
      ...EMPTY_TASK,
      ...task,
      id: task.id || uid(),
      title,
      priority: task.priority || "Medium",
      status: task.status || "Todo",
      estimateHrs: Number(task.estimateHrs) || 0,
      updatedAt: new Date().toISOString(),
    };
    const isNew = !(tasks || []).some((t) => t.id === normalized.id);
    setTasks((prev) => (prev.some((t) => t.id === normalized.id) ? prev.map((t) => (t.id === normalized.id ? normalized : t)) : [...prev, normalized]));
    setDraft({ ...EMPTY_TASK });
    setFProject("");
    setFAssignee("");
    setFPriority("");
    setQuery("");
    try {
      const s = await getSession();
      if (s?.user) await upsertTask(normalized);
    } catch {}
    notifyTaskSaved(normalized, isNew);
  };
  const deleteTask = async (id) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setDraft({ ...EMPTY_TASK });
    try {
      const s = await getSession();
      if (s?.user) await deleteTaskCloud(id);
    } catch {}
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <TopBar />

      <div className="p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Tabs */}
          <div className="flex items-center gap-2">
            {[
              ["dashboard", "Dashboard"],
              ["calendar", "Calendar"],
              ["tasks", "Tasks"],
              ["projects", "Projects"],
              ["timeline", "Timeline"],
              ["settings", "Settings"],
            ].map(([id, label]) => (
              <button key={id} className={`tab ${tab === id ? "tab-active" : "tab-inactive"}`} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>

          {/* Auth bar */}
          <div className="flex items-center justify-between">
            <div />
            <AuthBar onSignedIn={() => void 0} />
          </div>

          {tab === "dashboard" && (
            <div className="card">
              <Dashboard tasks={tasks} projects={projects} />
            </div>
          )}

          {tab === "calendar" && (
            <div className="card">
              <Calendar tasks={tasks} onCreateTaskForDate={createTaskForDate} onOpenTask={openTaskDetails} />
            </div>
          )}

          {/* Calendar drilldown modal */}
          {calendarDraft && (
            <Modal
              title={calendarDraft.id && tasks.find((t) => t.id === calendarDraft.id) ? "Edit Task" : "New Task"}
              onClose={() => setCalendarDraft(null)}
            >
              <TaskForm
                value={calendarDraft}
                onChange={setCalendarDraft}
                projects={projects}
                onComment={(t, c) => notifyNewComment(t, c)}
                onSave={(t) => {
                  saveTask(t);
                  setCalendarDraft(null);
                }}
                onDelete={(id) => {
                  deleteTask(id);
                  setCalendarDraft(null);
                }}
              />
            </Modal>
          )}

          {tab === "tasks" && (
            <>
              <div className="card">
                <h1 className="text-2xl font-bold mb-4">Project & Task Manager</h1>
                <TaskForm value={draft} onChange={setDraft} onSave={saveTask} onDelete={deleteTask} projects={projects} onComment={(t, c) => notifyNewComment(t, c)} />
              </div>

              <div className="card space-y-4">
                <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                  <div className="flex flex-wrap gap-2 items-end">
                    <input className="border rounded-lg px-2 py-1 text-sm" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
                    <select className="border rounded-lg px-2 py-1 text-sm" value={fProject} onChange={(e) => setFProject(e.target.value)}>
                      <option value="">All Projects</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <select className="border rounded-lg px-2 py-1 text-sm" value={fAssignee} onChange={(e) => setFAssignee(e.target.value)}>
                      <option value="">All Assignees</option>
                      {assignees.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                    <select className="border rounded-lg px-2 py-1 text-sm" value={fPriority} onChange={(e) => setFPriority(e.target.value)}>
                      <option value="">All Priority</option>
                      {["Low", "Medium", "High"].map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                    <select className="border rounded-lg px-2 py-1 text-sm" value={swimlaneBy} onChange={(e) => setSwimlaneBy(e.target.value)}>
                      {["None", "Project", "Assignee", "Priority"].map((x) => (
                        <option key={x} value={x}>
                          Swimlane: {x}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn btn-primary" onClick={() => setDraft({ ...EMPTY_TASK, status: "Todo", priority: "Medium" })}>
                      New Task
                    </button>
                    <button
                      className="btn"
                      onClick={() => {
                        setFProject("");
                        setFAssignee("");
                        setFPriority("");
                        setQuery("");
                      }}
                    >
                      Reset Filters
                    </button>
                  </div>
                </div>

                <Kanban tasks={filtered} setTasks={setTasks} onEdit={setDraft} swimlaneBy={swimlaneBy} projects={projects} onStatusChanged={(t, o, n) => notifyStatusChange(t, o, n)} />
              </div>
            </>
          )}

          {tab === "projects" && (
            <div className="card">
              <ProjectsManager projects={projects} setProjects={setProjects} setTasks={setTasks} />
            </div>
          )}

          {tab === "timeline" && (
            <div className="space-y-4">
              <div className="card">
                <Timeline projects={projects} />
              </div>
              <div className="text-xs text-slate-500">Tip: add/edit projects in the <b>Projects</b> tab.</div>
            </div>
          )}

          {tab === "settings" && (
            <div className="card">
              <Settings />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
