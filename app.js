import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./app.config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const page = document.body.dataset.page;

const setStatus = (el, message, isError = false) => {
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? "#b42318" : "";
};

const formatDate = (dateString) => {
  const date = new Date(`${dateString}T00:00:00`);
  return date.toLocaleDateString();
};

const isPastDue = (dateString) => {
  const due = new Date(`${dateString}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
};

const getCurrentUser = async () => {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session?.user ?? null;
};

const handleAuthRedirect = async () => {
  const user = await getCurrentUser();
  if (user) {
    window.location.href = "dashboard.html";
  }
};

const setupIndex = async () => {
  await handleAuthRedirect();

  const loginForm = document.getElementById("login-form");
  const signupForm = document.getElementById("signup-form");
  const loginStatus = document.getElementById("login-status");
  const signupStatus = document.getElementById("signup-status");

  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus(loginStatus, "Logging in...");

    const formData = new FormData(loginForm);
    const email = formData.get("email");
    const password = formData.get("password");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setStatus(loginStatus, error.message, true);
      return;
    }

    setStatus(loginStatus, "Success! Redirecting...");
    window.location.href = "dashboard.html";
  });

  signupForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus(signupStatus, "Creating account...");

    const formData = new FormData(signupForm);
    const username = formData.get("username");
    const email = formData.get("email");
    const password = formData.get("password");

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username },
      },
    });

    if (error) {
      setStatus(signupStatus, error.message, true);
      return;
    }

    if (data.user) {
      await supabase.from("profiles").upsert({
        id: data.user.id,
        username,
      });
    }

    setStatus(
      signupStatus,
      "Account created! If email confirmation is enabled, check your inbox."
    );
  });
};

const renderGroupPanel = (container, group, hasMembership) => {
  container.innerHTML = "";

  if (!hasMembership) {
    const wrapper = document.createElement("div");
    wrapper.className = "stack";
    wrapper.innerHTML = `
      <p>You are not in a group yet. Create one or join with a group ID.</p>
      <form id="create-group-form" class="stack">
        <label>
          Group name
          <input type="text" name="group_name" required />
        </label>
        <button type="submit">Create group</button>
      </form>
      <form id="join-group-form" class="stack">
        <label>
          Group ID
          <input type="text" name="group_id" placeholder="Paste group ID" required />
        </label>
        <button type="submit" class="secondary">Join group</button>
      </form>
      <p class="status" id="group-status"></p>
    `;

    container.appendChild(wrapper);
    return;
  }

  const fund = document.createElement("div");
  fund.className = "stack";
  fund.innerHTML = `
    <div>
      <div class="label">Group name</div>
      <strong>${group.name}</strong>
    </div>
    <div>
      <div class="label">Fund points</div>
      <div class="group-fund" id="group-fund">${group.fund_points}</div>
    </div>
    <div>
      <div class="label">Group ID (share with friends)</div>
      <code>${group.id}</code>
    </div>
  `;

  container.appendChild(fund);
};

const setupDashboard = async () => {
  const user = await getCurrentUser();
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  const userEmail = document.getElementById("user-email");
  if (userEmail) userEmail.textContent = user.email;

  const logoutBtn = document.getElementById("logout-btn");
  logoutBtn?.addEventListener("click", async () => {
    await supabase.auth.signOut();
    window.location.href = "index.html";
  });

  const groupPanel = document.getElementById("group-panel");
  const goalForm = document.getElementById("goal-form");
  const goalStatus = document.getElementById("goal-status");
  const goalsList = document.getElementById("goals-list");
  const totalOwed = document.getElementById("total-owed");

  const loadGroup = async () => {
    const { data: memberships, error } = await supabase
      .from("group_members")
      .select("group_id, groups(id,name,fund_points)")
      .eq("user_id", user.id);

    if (error) throw error;

    if (!memberships || memberships.length === 0) {
      renderGroupPanel(groupPanel, null, false);
      wireGroupForms();
      return null;
    }

    const membership = memberships[0];
    renderGroupPanel(groupPanel, membership.groups, true);
    return membership.groups;
  };

  const wireGroupForms = () => {
    const createForm = document.getElementById("create-group-form");
    const joinForm = document.getElementById("join-group-form");
    const status = document.getElementById("group-status");

    createForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      setStatus(status, "Creating group...");

      const formData = new FormData(createForm);
      const name = formData.get("group_name");

      const { data, error } = await supabase
        .from("groups")
        .insert({ name, fund_points: 0 })
        .select()
        .single();

      if (error) {
        setStatus(status, error.message, true);
        return;
      }

      const { error: memberError } = await supabase
        .from("group_members")
        .insert({ user_id: user.id, group_id: data.id });

      if (memberError) {
        setStatus(status, memberError.message, true);
        return;
      }

      setStatus(status, "Group created!");
      await loadAll();
    });

    joinForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      setStatus(status, "Joining group...");

      const formData = new FormData(joinForm);
      const groupId = formData.get("group_id");

      const { error } = await supabase
        .from("group_members")
        .insert({ user_id: user.id, group_id: groupId });

      if (error) {
        setStatus(status, error.message, true);
        return;
      }

      setStatus(status, "Joined!");
      await loadAll();
    });
  };

  const applyPenalties = async (goals) => {
    const overdue = goals.filter(
      (goal) => !goal.completed && !goal.penalized && isPastDue(goal.due_date)
    );

    for (const goal of overdue) {
      await supabase.rpc("apply_goal_penalty", {
        p_goal_id: goal.id,
      });
    }
  };

  const renderGoals = (goals) => {
    goalsList.innerHTML = "";

    if (!goals.length) {
      goalsList.innerHTML = "<p>No goals yet. Add one above.</p>";
      return;
    }

    goals.forEach((goal) => {
      const item = document.createElement("div");
      item.className = "goal-item";

      const statusBadge = goal.completed
        ? "<span class=\"badge\">Completed</span>"
        : goal.penalized
          ? "<span class=\"badge\">Missed</span>"
          : "";

      item.innerHTML = `
        <strong>${goal.title}</strong>
        <div class="goal-meta">
          <span>${goal.frequency}</span>
          <span>Due ${formatDate(goal.due_date)}</span>
          <span>${goal.penalty_points} pts</span>
          ${statusBadge}
        </div>
        <button data-id="${goal.id}" ${goal.completed ? "disabled" : ""}>
          Mark completed
        </button>
      `;

      const button = item.querySelector("button");
      button?.addEventListener("click", async () => {
        await supabase
          .from("goals")
          .update({ completed: true })
          .eq("id", goal.id);
        await loadAll();
      });

      goalsList.appendChild(item);
    });
  };

  const loadGoals = async () => {
    const { data, error } = await supabase
      .from("goals")
      .select("*")
      .eq("user_id", user.id)
      .order("due_date", { ascending: true });

    if (error) throw error;

    await applyPenalties(data);

    const { data: refreshed, error: refreshError } = await supabase
      .from("goals")
      .select("*")
      .eq("user_id", user.id)
      .order("due_date", { ascending: true });

    if (refreshError) throw refreshError;

    const owed = refreshed
      .filter((goal) => goal.penalized)
      .reduce((sum, goal) => sum + (goal.penalty_points || 0), 0);

    totalOwed.textContent = owed;
    renderGoals(refreshed);
  };

  const loadAll = async () => {
    const group = await loadGroup();
    await loadGoals();

    if (group) {
      const { data, error } = await supabase
        .from("groups")
        .select("fund_points")
        .eq("id", group.id)
        .single();

      if (!error && data) {
        const fundEl = document.getElementById("group-fund");
        if (fundEl) fundEl.textContent = data.fund_points;
      }
    }
  };

  goalForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus(goalStatus, "Saving goal...");

    const { data: memberships } = await supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", user.id);

    if (!memberships || memberships.length === 0) {
      setStatus(goalStatus, "Join or create a group first.", true);
      return;
    }

    const groupId = memberships[0].group_id;
    const formData = new FormData(goalForm);
    const payload = {
      title: formData.get("title"),
      frequency: formData.get("frequency"),
      due_date: formData.get("due_date"),
      penalty_points: Number(formData.get("penalty_points")),
      user_id: user.id,
      group_id: groupId,
    };

    const { error } = await supabase.from("goals").insert(payload);

    if (error) {
      setStatus(goalStatus, error.message, true);
      return;
    }

    goalForm.reset();
    setStatus(goalStatus, "Goal added!");
    await loadAll();
  });

  await loadAll();
};

if (page === "index") {
  setupIndex();
}

if (page === "dashboard") {
  setupDashboard();
}
