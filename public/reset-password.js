const dialog = document.querySelector("#reset"),
  form = dialog.querySelector("form"),
  status = form.querySelector('[role="status"]');
let token = new URLSearchParams(location.hash.slice(1)).get("token") || "";
history.replaceState(null, "", location.pathname);
dialog.showModal();
dialog.addEventListener("cancel", (event) => event.preventDefault());
if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
  status.textContent =
    "This reset link is missing or invalid. Ask your administrator for a fresh recovery link.";
  form.querySelector("button").disabled = true;
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const fields = new FormData(form),
    button = form.querySelector("button");
  if (fields.get("password") !== fields.get("confirmation")) {
    status.textContent = "Passwords do not match.";
    return;
  }
  button.disabled = true;
  status.textContent = "Updating your password…";
  try {
    const response = await fetch("/api/auth/reset", {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: fields.get("password") }),
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "Reset failed");
    token = "";
    form.reset();
    form.hidden = true;
    document.querySelector("#signin").hidden = false;
    dialog.querySelector("h2").textContent = "Password updated";
    dialog.querySelector("p").textContent =
      "Sign in on web and mobile with your username and new password. Old sessions have been signed out.";
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  } finally {
    form.querySelectorAll('input[type="password"]').forEach((input) => (input.value = ""));
  }
});
