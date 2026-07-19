const API = "https://xkrpxvswdkreglmefuot.supabase.co/functions/v1/agent-api";

const $ = (id) => document.getElementById(id);
const panels = ["today", "chat", "settings"];
let token = null;

async function api(action, extra = {}) {
  const resp = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-token": token },
    body: JSON.stringify({ action, ...extra }),
  });
  if (resp.status === 401) throw new Error("unauthorized");
  return resp.json();
}

// ---------------------------------------------------------------- tabs
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    panels.forEach((p) => $(p).classList.toggle("hidden", p !== btn.dataset.tab));
    if (btn.dataset.tab === "settings") loadProfile();
  });
});

// ---------------------------------------------------------------- setup
function showSetup(show) {
  $("setup").classList.toggle("hidden", !show);
  document.querySelector("nav").style.display = show ? "none" : "flex";
  panels.forEach((p) => $(p).classList.add("hidden"));
  if (!show) $("today").classList.remove("hidden");
}

$("saveToken").addEventListener("click", async () => {
  token = $("tokenInput").value.trim();
  try {
    const res = await api("profile_get");
    if (res.error) throw new Error(res.error);
    await chrome.storage.sync.set({ token });
    $("setupError").classList.add("hidden");
    showSetup(false);
    loadDigest();
  } catch {
    $("setupError").classList.remove("hidden");
  }
});

$("disconnect").addEventListener("click", async () => {
  await chrome.storage.sync.remove("token");
  token = null;
  showSetup(true);
});

// ---------------------------------------------------------------- today
const CAT_LABELS = {
  urgent: "⚡ Urgent",
  action_needed: "✋ Action needed",
  fyi: "📋 FYI",
  low_priority: "🔕 Low priority",
  spam_or_poor_fit: "🗑 Filtered out",
};

async function loadDigest() {
  const res = await api("digest");
  const byCat = {};
  for (const e of res.emails ?? []) (byCat[e.category] ??= []).push(e);

  const digest = $("digest");
  digest.innerHTML = "";
  if (res.last_run?.finished_at) {
    $("lastRun").textContent =
      `Last sweep: ${new Date(res.last_run.finished_at).toLocaleString()}`;
  }

  const order = ["urgent", "action_needed", "fyi", "low_priority", "spam_or_poor_fit"];
  let any = false;
  for (const cat of order) {
    const items = byCat[cat];
    if (!items?.length) continue;
    // collapse the noise categories into a one-line count
    if (cat === "spam_or_poor_fit" || cat === "low_priority") {
      const div = document.createElement("div");
      div.className = "cat";
      div.innerHTML = `<h3>${CAT_LABELS[cat]} — ${items.length} handled</h3>`;
      digest.appendChild(div);
      any = true;
      continue;
    }
    const wrap = document.createElement("div");
    wrap.className = `cat ${cat}`;
    wrap.innerHTML = `<h3>${CAT_LABELS[cat]}</h3>`;
    for (const e of items) {
      const card = document.createElement("div");
      card.className = "card";
      const badge = e.auto_sent
        ? '<span class="badge sent">reply sent</span>'
        : e.draft_created
          ? '<span class="badge draft">draft ready</span>'
          : "";
      card.innerHTML =
        `<div class="from"></div><div class="subj"></div><div class="sum"></div>${badge}`;
      card.querySelector(".from").textContent = e.sender;
      card.querySelector(".subj").textContent = e.subject;
      card.querySelector(".sum").textContent = e.summary;
      wrap.appendChild(card);
    }
    digest.appendChild(wrap);
    any = true;
  }
  if (!any) {
    digest.innerHTML =
      '<div class="empty"><span class="big">🎉</span>All caught up.</div>';
  }
}

$("sweepBtn").addEventListener("click", async () => {
  $("sweepBtn").textContent = "Sweeping…";
  try { await api("sweep"); await loadDigest(); } catch {}
  $("sweepBtn").textContent = "Sweep now";
});

// ---------------------------------------------------------------- chat
function addMsg(cls, text) {
  const div = document.createElement("div");
  div.className = `msg ${cls}`;
  div.textContent = text;
  $("messages").appendChild(div);
  $("messages").scrollTop = $("messages").scrollHeight;
}

$("chatForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const text = $("chatInput").value.trim();
  if (!text) return;
  $("chatInput").value = "";
  addMsg("user", text);
  try {
    const res = await api("chat", { message: text });
    addMsg("agent", res.reply ?? res.error ?? "…");
    if (res.rule_added) addMsg("rule", `New rule saved: ${res.rule_added}`);
  } catch {
    addMsg("agent", "Connection problem — try again.");
  }
});

// ---------------------------------------------------------------- settings
const FIELDS = ["display_name", "occupation", "services", "tone", "signoff", "custom_rules"];

async function loadProfile() {
  const res = await api("profile_get");
  if (!res.profile) return;
  for (const f of FIELDS) $(`f_${f}`).value = res.profile[f] ?? "";
  $("f_auto_send").checked = res.profile.auto_send === true;
}

$("saveProfile").addEventListener("click", async () => {
  const fields = {};
  for (const f of FIELDS) fields[f] = $(`f_${f}`).value;
  fields.auto_send = $("f_auto_send").checked;
  const res = await api("profile_set", { fields });
  if (res.ok) {
    $("saveMsg").classList.remove("hidden");
    setTimeout(() => $("saveMsg").classList.add("hidden"), 2000);
  }
});

// ---------------------------------------------------------------- init
(async function init() {
  const stored = await chrome.storage.sync.get("token");
  if (stored.token) {
    token = stored.token;
    showSetup(false);
    loadDigest().catch(() => showSetup(true));
  } else {
    showSetup(true);
  }
})();
