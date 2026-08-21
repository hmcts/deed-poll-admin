// Progressive enhancement for onboarding form

document.addEventListener("DOMContentLoaded", () => {
  // Role page "Other" field toggle
  const otherRadio = document.getElementById("roleType-4") as HTMLInputElement;
  const otherField = document.getElementById("conditional-roleType-4") as HTMLElement;

  if (otherRadio && otherField) {
    // Show/hide other field based on selection
    function toggleOtherField() {
      if (otherRadio.checked) {
        otherField.style.display = "block";
        const otherInput = document.getElementById("roleOther") as HTMLInputElement;
        if (otherInput) {
          otherInput.focus();
        }
      } else {
        otherField.style.display = "none";
      }
    }

    // Listen to all role radio buttons
    const roleRadios = document.querySelectorAll('input[name="roleType"]');
    roleRadios.forEach((radio) => {
      radio.addEventListener("change", toggleOtherField);
    });

    // Set initial state
    toggleOtherField();
  }

  // Postcode formatting
  const postcodeInput = document.getElementById("postcode") as HTMLInputElement;
  if (postcodeInput) {
    postcodeInput.addEventListener("blur", () => {
      let value = postcodeInput.value.replace(/\s/g, "").toUpperCase();
      if (value.length >= 3) {
        // Add space before last 3 characters
        value = `${value.slice(0, -3)} ${value.slice(-3)}`;
        postcodeInput.value = value;
      }
    });
  }

  // Date input validation helpers
  const dayInput = document.getElementById("day") as HTMLInputElement;
  const monthInput = document.getElementById("month") as HTMLInputElement;
  const yearInput = document.getElementById("year") as HTMLInputElement;

  if (dayInput && monthInput && yearInput) {
    // Prevent invalid characters
    [dayInput, monthInput, yearInput].forEach((input) => {
      input.addEventListener("input", (e) => {
        const target = e.target as HTMLInputElement;
        target.value = target.value.replace(/\D/g, "");
      });
    });

    // Add realistic max lengths
    dayInput.setAttribute("maxlength", "2");
    monthInput.setAttribute("maxlength", "2");
    yearInput.setAttribute("maxlength", "4");
  }
});
