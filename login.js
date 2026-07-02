function login() {
  const name     = document.getElementById("name").value.trim();
  const usn      = document.getElementById("usn").value.trim();
  const cgpa     = document.getElementById("cgpa").value.trim();
  const backlogs = document.getElementById("backlogs").value;

  if (!name || !usn || !cgpa || !backlogs) {
    // Inline shake on empty/unselected fields instead of alert
    ["name", "usn", "cgpa", "backlogs"].forEach(id => {
      const el = document.getElementById(id);
      if (!el.value.trim()) {
        el.style.borderColor = "#e53e3e";
        el.style.animation = "none";
        setTimeout(() => { el.style.borderColor = ""; }, 1500);
      }
    });
    return;
  }

  const cgpaNum = parseFloat(cgpa);
  if (isNaN(cgpaNum) || cgpaNum < 0 || cgpaNum > 10) {
    const el = document.getElementById("cgpa");
    el.style.borderColor = "#e53e3e";
    setTimeout(() => { el.style.borderColor = ""; }, 1500);
    return;
  }

  localStorage.setItem("name", name);
  localStorage.setItem("usn",  usn);
  localStorage.setItem("cgpa", cgpaNum.toFixed(2));
  localStorage.setItem("backlogs", backlogs);

  // Show rules modal
  document.getElementById("rulesModal").classList.add("active");
}

function startExam() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;

  const go = () => { window.location.href = "exam.html"; };

  if (req) {
    req.call(el).then(go).catch(go);
  } else {
    go();
  }
}

// Clear red border on input/selection
document.addEventListener("DOMContentLoaded", () => {
  ["name", "usn", "cgpa"].forEach(id => {
    document.getElementById(id).addEventListener("input", function () {
      this.style.borderColor = "";
    });
  });
  document.getElementById("backlogs").addEventListener("change", function () {
    this.style.borderColor = "";
  });
});
