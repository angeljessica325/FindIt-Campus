
async function submitAuth(formId, endpoint) {
    const form = document.getElementById(formId);
    const message = document.getElementById("message");
    const button = document.getElementById("submitBtn");

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        message.textContent = "";
        button.disabled = true;
        button.textContent = "Please wait...";

        try {
            const data = Object.fromEntries(new FormData(form).entries());

            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify(data)
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || result.error || "Request failed.");
            }

            message.textContent = "Success! Redirecting...";
            message.style.color = "green";

            window.location.href = "/";

        } catch (error) {
            message.style.color = "crimson";
            message.textContent = error.message || "Unable to connect. Try again.";
        } finally {
            button.disabled = false;
            button.textContent = formId === "registerForm"
                ? "Create Account" : "Login";
        }
    });
}

if (document.getElementById("registerForm")) {
    submitAuth("registerForm", "/api/auth/register");
}

if (document.getElementById("loginForm")) {
    submitAuth("loginForm", "/api/auth/login");
}
