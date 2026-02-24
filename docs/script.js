document.addEventListener("DOMContentLoaded", () => {
  const links = Array.from(document.querySelectorAll(".topbar nav a"));

  // Smooth scroll for anchor links using topbar height as offset
  const topbar = document.querySelector(".topbar");
  const topbarHeight = topbar ? topbar.offsetHeight : 0;
  links.forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const href = link.getAttribute("href");
      const target = document.querySelector(href);
      if (target) {
        const offset = topbarHeight + 12; // small extra spacing
        const top =
          target.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top, behavior: "smooth" });
      }
    });
  });

  // Highlight active section in topnav (scroll-driven, robust for fixed header)
  const sections = Array.from(document.querySelectorAll("main .section"));

  function updateActiveLink() {
    const offset = topbarHeight + 12; // keep consistent with smooth scroll offset
    let closest = null;
    let closestDistance = Infinity;
    sections.forEach((sec) => {
      const rect = sec.getBoundingClientRect();
      const distance = Math.abs(rect.top - offset);
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = sec;
      }
    });
    // If user scrolled to the very bottom, ensure Certification is active
    const atBottom =
      window.innerHeight + window.scrollY >=
      document.documentElement.scrollHeight - 10;
    if (atBottom) {
      const cert = document.getElementById("certification");
      if (cert) closest = cert;
    }
    if (closest && closest.id) {
      links.forEach((l) => l.classList.remove("active"));
      const link = document.querySelector(
        '.topbar nav a[href="#' + closest.id + '"]',
      );
      if (link) link.classList.add("active");
    }
  }

  // Throttle updates using requestAnimationFrame
  let ticking = false;
  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          updateActiveLink();
          ticking = false;
        });
        ticking = true;
      }
    },
    { passive: true },
  );

  // run once to set initial state
  updateActiveLink();

  // Email copy-to-clipboard
  const emailLink = document.getElementById("email-link");
  if (emailLink) {
    emailLink.addEventListener("click", async (e) => {
      e.preventDefault();
      const href = emailLink.getAttribute("href") || "";
      const email = href.replace(/^mailto:/i, "");
      try {
        await navigator.clipboard.writeText(email);
        showToast("Email copied to clipboard");
      } catch (err) {
        // fallback: select and copy using execCommand
        const input = document.createElement("input");
        input.value = email;
        document.body.appendChild(input);
        input.select();
        try {
          document.execCommand("copy");
          showToast("Email copied to clipboard");
        } catch (e) {
          showToast("Copy failed");
        }
        input.remove();
      }
    });
  }

  function showToast(text) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = text;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("visible"));
    setTimeout(() => {
      t.classList.remove("visible");
      setTimeout(() => t.remove(), 300);
    }, 2000);
  }

  // Toggle quote details when clicking the strong title
  document.querySelectorAll(".work-content .quote > strong").forEach((s) => {
    s.setAttribute("tabindex", "0");
    s.addEventListener("click", () => {
      const p = s.parentElement;
      p.classList.toggle("expanded");
    });
    s.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const p = s.parentElement;
        p.classList.toggle("expanded");
      }
    });
  });

  // Convert markdown-like list lines (lines starting with "- ") inside
  // elements with `.quote-detail.muted` into real nested <ul>/<li> structures.
  // This lets authors write:
  //   - first item
  //   - second item
  //     - nested item
  // and have it render with indentation (tab-like effect).
  function renderMarkdownLists() {
    const els = Array.from(document.querySelectorAll('.quote-detail.muted'));
    els.forEach((el) => {
      const raw = el.textContent || '';
      const lines = raw.split(/\r?\n/).map((l) => l.replace(/\u00A0/g, ' '));
      // If none of the lines look like a markdown list, skip.
      if (!lines.some((ln) => /^\s*-\s+/.test(ln))) return;

      const root = document.createElement('ul');
      const ulStack = [root];

      lines.forEach((line) => {
        const m = line.match(/^(\s*)-\s+(.*)$/);
        if (!m) return; // ignore non-list lines
        const indent = m[1].replace(/\t/g, '    ').length; // tabs -> 4 spaces
        const level = Math.floor(indent / 2); // 0 = top

        // Ensure stack has a UL for this level
        while (ulStack.length <= level) {
          // create a nested UL under the last LI of the current deepest UL
          const parentUl = ulStack[ulStack.length - 1];
          let lastLi = parentUl.lastElementChild;
          if (!lastLi) {
            lastLi = document.createElement('li');
            lastLi.textContent = '';
            parentUl.appendChild(lastLi);
          }
          const newUl = document.createElement('ul');
          lastLi.appendChild(newUl);
          ulStack.push(newUl);
        }
        while (ulStack.length > level + 1) ulStack.pop();

        const li = document.createElement('li');
        li.textContent = m[2].trim();
        ulStack[ulStack.length - 1].appendChild(li);
      });

      // Replace element content with rendered list
      el.innerHTML = '';
      el.appendChild(root);
    });
  }

  renderMarkdownLists();
});
