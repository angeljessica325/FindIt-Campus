
async function updateAccountNav() {
    const nav = document.getElementById("accountNav");
    if (!nav) return;

    try {
        const response = await fetch("/api/auth/me", {
            credentials: "same-origin"
        });

        if (!response.ok) throw new Error("Not logged in");

        const data = await response.json();

        // Supports common API response shapes
        const user = data.user || data.student || data;

        if (!user.id && !user._id && !user.email) {
            throw new Error("No user session");
        }

        nav.innerHTML = `
            <a href="/profile.html">My Profile</a>
            <button type="button" id="logoutBtn">Logout</button>
        `;

        document.getElementById("logoutBtn")
            .addEventListener("click", async () => {
                const result = await fetch("/api/auth/logout", {
                    method: "POST",
                    credentials: "same-origin"
                });

                if (result.ok) {
                    window.location.href = "/";
                } else {
                    alert("Logout failed. Please try again.");
                }
            });

    } catch {
        nav.innerHTML = `
            <a href="/login.html">Login</a>
            <a href="/register.html">Register</a>
        `;
    }
}

updateAccountNav();
