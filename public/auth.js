const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
async function request(path, data) {
  const response = await fetch(`/api/auth/${path}`, {
    credentials: "same-origin",
    ...(data === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || result.message || "Account request failed");
  return result;
}
const userOptions = (users) =>
  users
    .filter((user) => user.active !== false)
    .map((user) => `<option value="${escape(user.id)}">${escape(user.name)}</option>`)
    .join("");
const credentials = () =>
  `<label>Username<input name="username" required minlength="3" maxlength="120" autocomplete="username" autocapitalize="none" spellcheck="false" pattern="[A-Za-z0-9.@_+\\-]+"></label><label>Password<input name="password" type="password" required minlength="12" maxlength="200" autocomplete="current-password"></label>`;

function installAccountBar(identity, configured) {
  document.getElementById("auth-account-bar")?.remove();
  const bar = document.createElement("div");
  bar.id = "auth-account-bar";
  bar.className = "auth-account-bar";
  bar.innerHTML = identity
    ? `<span title="${escape(identity.company)}">${escape(identity.user.name)} · ${escape(identity.user.role)}</span>${identity.user.role === "admin" ? '<button type="button" name="accounts">Manage accounts</button>' : ""}<button type="button" name="logout">Sign out</button>`
    : '<span>Demo access</span><button type="button" name="setup">Set up shared login</button>';
  bar.addEventListener("click", async (event) => {
    event.stopPropagation();
    const button = event.target.closest("button");
    if (!button) return;
    if (button.name === "setup") location.reload();
    if (button.name === "logout") {
      button.disabled = true;
      try {
        await request("logout", {});
        location.reload();
      } catch (error) {
        button.disabled = false;
        bar.querySelector("span").textContent = error.message;
      }
    }
    if (button.name === "accounts") openAccounts();
  });
  (document.querySelector("main > header") || document.body).append(bar);
  // The demo labels belong only to the unauthenticated local trial.
  const workspace = document.getElementById("workspace-name");
  if (workspace) workspace.textContent = identity ? identity.company : "Demo workspace";
  document.getElementById("demo-badge")?.toggleAttribute("hidden", Boolean(identity));
  // Demo is allowed only before the server has any account.
  if (configured && !identity) bar.remove();
}

async function openAccounts() {
  if (document.getElementById("auth-accounts")) return;
  const dialog = document.createElement("dialog");
  dialog.id = "auth-accounts";
  dialog.className = "auth-dialog";
  dialog.innerHTML =
    '<h2>Workspace accounts</h2><p role="status">Loading accounts…</p><button type="button" name="close">Close</button>';
  document.body.append(dialog);
  dialog.showModal();
  dialog.addEventListener("close", () => dialog.remove());
  dialog.addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.target.closest('button[name="close"]')) dialog.close();
  });
  try {
    const { accounts, users } = await request("accounts");
    if (!dialog.isConnected) return;
    const available = users.filter(
      (user) => !accounts.some((account) => (account.id || account.userId) === user.id),
    );
    dialog.innerHTML = `<div class="auth-dialog-title"><h2>Workspace accounts</h2><button type="button" name="close" aria-label="Close accounts">×</button></div><p>Web and mobile use the same CRM user identity.</p><ul class="auth-account-list">${accounts.map((account) => `<li><b>${escape(account.name)}</b><span>${escape(account.username)} · ${escape(account.role)}${account.active === false ? " · disabled" : ""}</span></li>`).join("")}</ul>${available.some((user) => user.active !== false) ? `<form><h3>Create member login</h3><label>Existing CRM user<select name="userId" required>${userOptions(available)}</select></label>${credentials()}<p class="auth-error" role="alert"></p><button class="primary" type="submit">Create member account</button></form>` : "<p>All active CRM users already have accounts. Add a CRM user before creating another login.</p>"}`;
    const form = dialog.querySelector("form");
    form?.querySelector('[name="password"]').setAttribute("autocomplete", "new-password");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      const input = Object.fromEntries(new FormData(form));
      try {
        await request("accounts", input);
        form.reset();
        dialog.close();
        await openAccounts();
      } catch (error) {
        form.querySelector(".auth-error").textContent = error.message;
      } finally {
        form.querySelector('[name="password"]').value = "";
        submit.disabled = false;
      }
    });
  } catch (error) {
    dialog.querySelector('[role="status"]').textContent = error.message;
  }
}

export async function initializeAuth() {
  const status = await request("status");
  if (status.user) {
    const identity = { user: status.user, company: status.company };
    installAccountBar(identity, true);
    return identity;
  }
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "auth-dialog auth-gate";
    dialog.id = "auth-login";
    const setup = !status.configured;
    dialog.innerHTML = `<h1>Salesdesk CRM</h1><h2>${setup ? "Set up shared web & mobile login" : "Sign in to your workspace"}</h2><p>${setup ? "Create the first administrator using an existing CRM user. Each teammate can then receive their own login." : "Use the same account on your desktop and Android app."}</p><form>${setup ? `<label>Company name<input name="company" required maxlength="120" autocomplete="organization"></label><label>Administrator CRM user<select name="userId" required>${userOptions(status.users || [])}</select></label>` : ""}${credentials()}<p class="auth-error" role="alert"></p><button class="primary" type="submit">${setup ? "Create administrator" : "Sign in"}</button>${setup ? '<button type="button" name="demo">Continue demo</button>' : ""}</form><p class="muted">${setup ? "Demo mode does not enable authenticated mobile access. Passwords must be at least 12 characters." : "Contact your workspace administrator if you need an account."}</p>`;
    document.body.append(dialog);
    dialog.addEventListener("cancel", (event) => event.preventDefault());
    dialog.addEventListener("click", (event) => event.stopPropagation());
    const form = dialog.querySelector("form");
    if (setup) form.querySelector('[name="password"]').autocomplete = "new-password";
    const finish = (identity) => {
      form.reset();
      dialog.close();
      dialog.remove();
      installAccountBar(identity, status.configured);
      resolve(identity);
    };
    form.querySelector('[name="demo"]')?.addEventListener("click", () => finish(null));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const buttons = [...form.querySelectorAll("button")];
      buttons.forEach((button) => {
        button.disabled = true;
      });
      try {
        const result = await request(
          setup ? "bootstrap" : "login",
          Object.fromEntries(new FormData(form)),
        );
        finish({ user: result.user, company: result.company });
      } catch (error) {
        form.querySelector(".auth-error").textContent = error.message;
      } finally {
        form.querySelector('[name="password"]').value = "";
        buttons.forEach((button) => {
          button.disabled = false;
        });
      }
    });
    dialog.showModal();
  });
}
