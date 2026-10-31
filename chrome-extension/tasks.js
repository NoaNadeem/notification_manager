const ROOT = "https://tasks.googleapis.com/tasks/v1";
export const TASK_SCOPE = "https://www.googleapis.com/auth/tasks";

export function taskReference(id) {
  if (!id?.startsWith("task:")) return null;
  const parts = id.split(":");
  if (parts.length !== 3) throw new Error("Invalid task reference.");
  return { listId: decodeURIComponent(parts[1]), id: decodeURIComponent(parts[2]) };
}
export function taskNote(notes) { return (notes || "").split(/\r?\n/).map(line => line.trim()).find(Boolean) || null; }
export function taskNoteUrl(note) {
  const match = note?.match(/https?:\/\/[^\s<>]+/i)?.[0]?.replace(/[.,;)]+$/, "") || (/^www\./i.test(note || "") ? `https://${note.split(/\s/)[0]}` : null);
  if (!match) return null;
  try { const url = new URL(match); return ["http:", "https:"].includes(url.protocol) ? url.href : null; } catch { return null; }
}
export function taskAsEvent(task, listId) {
  const due = task.due?.slice(0, 10) || null;
  const end = new Date(`${due || "1970-01-01"}T12:00:00Z`); end.setUTCDate(end.getUTCDate()+1);
  return { id: `task:${encodeURIComponent(listId)}:${encodeURIComponent(task.id)}`, summary: task.title || "(Untitled task)",
    start: { date: due || "1970-01-01" }, end: { date: end.toISOString().slice(0,10) },
    location: taskNote(task.notes), htmlLink: task.webViewLink || "https://tasks.google.com/tasks/",
    task: { listId, id: task.id, due } };
}
export async function readTasks(request) {
  const lists = []; let page;
  do {
    const url = new URL(`${ROOT}/users/@me/lists`); url.searchParams.set("maxResults", "100");
    if (page) url.searchParams.set("pageToken", page);
    const response = await request(url.href); lists.push(...(response.items || [])); page = response.nextPageToken;
  } while (page);
  const result = [];
  for (const list of lists) {
    page = undefined;
    do {
      const url = new URL(`${ROOT}/lists/${encodeURIComponent(list.id)}/tasks`);
      for (const [key, value] of Object.entries({maxResults:"100",showCompleted:"false",showDeleted:"false",showHidden:"false",showAssigned:"true"})) url.searchParams.set(key, value);
      if (page) url.searchParams.set("pageToken", page);
      const response = await request(url.href);
      result.push(...(response.items || []).filter(task => !task.deleted && !task.hidden && task.status !== "completed").map(task => taskAsEvent(task, list.id)));
      page = response.nextPageToken;
    } while (page);
  }
  return result;
}
export async function moveTask(id, option, now, destination, request) {
  const ref = taskReference(id);
  if (option.hours || option.time) throw new Error("Google Tasks supports dates only, not hour moves or times.");
  const url = `${ROOT}/lists/${encodeURIComponent(ref.listId)}/tasks/${encodeURIComponent(ref.id)}`;
  const current = await request(url);
  if (current.deleted || current.status === "completed") throw Object.assign(new Error("This task was completed or deleted. Refresh before moving it."), {status:409});
  const date = new Date(now); date.setDate(date.getDate() + (option.days || 0));
  const due = destination && Object.hasOwn(destination, "taskDue") ? destination.taskDue
    : destination?.start?.date || option.date || `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
  const currentDue = current.due?.slice(0,10) || null;
  if (currentDue === due) return taskAsEvent(current, ref.listId);
  if (destination && Object.hasOwn(destination, "originalTaskDue") && currentDue !== destination.originalTaskDue)
    throw Object.assign(new Error("This task changed after your action. Refresh and review it before moving it."), {status:409});
  const updated = await request(url, { method:"PATCH", headers:{"Content-Type":"application/json", ...(current.etag ? {"If-Match":current.etag} : {})}, body:JSON.stringify({due:due ? `${due}T00:00:00.000Z` : null}) });
  return taskAsEvent(updated, ref.listId);
}

export async function setTaskCompleted(id, completed, request) {
  const ref = taskReference(id);
  const url = `${ROOT}/lists/${encodeURIComponent(ref.listId)}/tasks/${encodeURIComponent(ref.id)}`;
  const current = await request(url);
  if (current.deleted) throw Object.assign(new Error("This task was deleted. Refresh before changing it."), {status:409});
  const status = completed ? "completed" : "needsAction";
  if (current.status === status) return taskAsEvent(current, ref.listId);
  const updated = await request(url, {method:"PATCH",headers:{"Content-Type":"application/json",...(current.etag ? {"If-Match":current.etag} : {})},
    body:JSON.stringify(completed ? {status} : {status,completed:null})});
  return taskAsEvent(updated, ref.listId);
}
