
document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("reportForm");
    const typeSelect = document.getElementById("type");

    if (!form || !typeSelect) {
        console.error("Report form or type dropdown not found.");
        alert("Form connection error. Please check report.html.");
        return;
    }

    // Select Lost or Found from the homepage link
    const params = new URLSearchParams(window.location.search);
    const requestedType = params.get("type");

    if (requestedType === "lost" || requestedType === "found") {
        typeSelect.value = requestedType;
    }

    // Set today's date as the maximum
    const dateInput = document.getElementById("date");

    if (dateInput) {
        const now = new Date();
        const today = new Date(
            now.getTime() - now.getTimezoneOffset() * 60000
        ).toISOString().split("T")[0];

        dateInput.max = today;
    }

    // Handle form submission
    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        const button = form.querySelector(
            'button[type="submit"], input[type="submit"]'
        );

        const originalText = button
            ? (button.tagName === "BUTTON"
                ? button.textContent
                : button.value)
            : "";

        try {
            const reportData = {
                type: typeSelect.value,
                itemName: document.getElementById("itemName").value.trim(),
                category: document.getElementById("category").value,
                location: document.getElementById("location").value.trim(),
                date: document.getElementById("date").value,
                description: document.getElementById("description").value.trim()
            };

            // Basic validation
            if (!["lost", "found"].includes(reportData.type)) {
                throw new Error("Please select Lost or Found.");
            }

            if (
                !reportData.itemName ||
                !reportData.category ||
                !reportData.location ||
                !reportData.date ||
                !reportData.description
            ) {
                throw new Error("Please fill in all fields.");
            }

            if (button) {
                button.disabled = true;

                if (button.tagName === "BUTTON") {
                    button.textContent = "Submitting...";
                } else {
                    button.value = "Submitting...";
                }
            }

            const response = await fetch("/api/items", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(reportData)
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || "Report submission failed.");
            }

            alert("Report submitted successfully! ❤️");

            window.location.href = "/items.html";

        } catch (error) {
            console.error("Submission error:", error);

            alert(error.message || "Unable to submit report.");
        } finally {
            if (button) {
                button.disabled = false;

                if (button.tagName === "BUTTON") {
                    button.textContent = originalText;
                } else {
                    button.value = originalText;
                }
            }
        }
    });
});
