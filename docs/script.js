const VALUE_HIGHLIGHTS = [
  "전체적인 프로세스 흐름",
  "팀의 생산성 향상",
  "문서로 정리하고 공유",
  "유지보수",
  "가이드를 제시",
  "확장성과 유지보수를 용이",
  "타 팀과의 협력",
];

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const data = await loadPortfolioData();
    renderShellLinks(data.profile);
    renderWebPortfolio(data);
    bindInteractions();
  } catch (error) {
    renderLoadError(error);
  }
});

async function loadPortfolioData() {
  if (window.PORTFOLIO_DATA) return window.PORTFOLIO_DATA;
  throw new Error("Portfolio data is not available. Check data/portfolio-data.js script loading");
}

function renderShellLinks(profile) {
  const logo = document.querySelector(".logo");
  const socialRoot = document.getElementById("social-root");
  const footerLinks = document.getElementById("footer-links");
  const contacts = profile.contacts;
  const displayName = profile.name?.en || profile.name || "Kim Seung Hyeon";
  const koreanName = profile.name?.ko || profile.name || "김승현";

  if (logo) logo.textContent = displayName;
  document.title = `${koreanName} - Portfolio`;

  socialRoot.replaceChildren(
    linkEl(contacts.github.url, [
      el("img", { src: "assets/github.svg", alt: "GitHub", className: "icon" }),
    ], { external: true, ariaLabel: "GitHub" }),
    linkEl(`mailto:${contacts.email.value}`, "Email", {
      id: "email-link",
      ariaLabel: "Email",
    }),
  );

  footerLinks.replaceChildren(
    linkEl(contacts.github.url, "GitHub", { external: true }),
    document.createTextNode(" · "),
    linkEl(`mailto:${contacts.email.value}`, "Email"),
  );
}

function renderWebPortfolio(data) {
  const root = document.getElementById("web-root");
  const workCases = data.cases.filter((item) => item.type === "work");
  const projectCases = data.cases.filter((item) => item.type === "project");

  root.replaceChildren(
    renderAboutSection(data.profile),
    renderCaseSection("work", "Work Experience", workCases),
    renderCaseSection("project", "Project", projectCases),
    renderActivitiesSection(data.profile.activities),
  );
}

function renderAboutSection(profile) {
  return el("section", { id: "about", className: "section intro" }, [
    el("h2", {}, "About"),
    el("div", { className: "work-divider", ariaHidden: "true" }),
    el("div", { className: "intro-inner" }, [
      el("div", { className: "photo" }, [
        el("img", { src: profile.photo, alt: "Profile photo" }),
      ]),
      el("div", { className: "intro-text" }, [
        el("p", { className: "big" }, renderInlineText(profile.webIntro)),
        renderTechStack(profile.techStack),
        renderCertifications(profile.certifications),
      ]),
      el("div", { className: "values" }, profile.values.flatMap((group) => [
        el("h3", {}, group.title),
        el("ul", {}, group.items.map((item) =>
          el("li", {}, renderHighlightedText(item, VALUE_HIGHLIGHTS)),
        )),
      ])),
    ]),
  ]);
}

function renderTechStack(techStack) {
  return el("div", { className: "tech-stack" }, [
    el("h3", {}, "Tech Stack"),
    el("div", { className: "tech-badges" }, techStack.flatMap((group) =>
      group.items.map((item) => el("span", { className: "tech-badge" }, item)),
    )),
  ]);
}

function renderCertifications(certifications) {
  return el("div", { className: "certs-inline" }, [
    el("h3", {}, "Certification"),
    el("div", { className: "cert-badges" }, certifications.map((cert) => {
      const label = `${cert.title} · ${cert.date}`;
      if (!cert.url) return el("span", { className: "cert-badge" }, label);
      return linkEl(cert.url, label, { className: "cert-badge", external: true });
    })),
  ]);
}

function renderCaseSection(id, title, cases) {
  return el("section", { id, className: `section ${id === "project" ? "projects" : "work-section"}` }, [
    el("h2", {}, title),
    el("div", { className: "work-divider", ariaHidden: "true" }),
    el("div", { className: "work-list" }, cases.map(renderWebCase)),
  ]);
}

function renderWebCase(item) {
  return el("article", { className: "work-entry", id: item.id }, [
    el("div", { className: "work-meta sticky" }, [
      el("img", {
        src: item.asset.src,
        alt: item.asset.alt,
        className: item.asset.noPad ? "no-pad" : "",
      }),
      el("div", { className: "info" }, [
        el("h3", {}, item.title),
        el("span", {}, item.roles.join(" / ")),
        el("span", {}, item.period),
        el("span", {}, item.teamSize),
      ]),
      renderCaseLinks(item.links),
    ]),
      el("div", { className: "work-content" }, item.webDetails.map((detail) => renderWebDetail(detail, item))),
  ]);
}

function renderCaseLinks(links = []) {
  if (!links.length) return null;
  return el("div", { className: "meta-links" }, links.map((link) =>
    linkEl(link.url, [
      el("img", {
        src: link.type === "demo" ? "assets/Youtube_logo.png" : "assets/github.svg",
        alt: link.label,
      }),
      el("span", { className: "print-url" }, [
        el("b", {}, link.label),
        el("br"),
        link.url,
      ]),
    ], {
      className: "meta-link",
      ariaLabel: link.label,
      external: true,
    }),
  ));
}

function renderWebDetail(detail, item) {
  if (detail.type === "heading") {
    return el(detail.level === 4 ? "h4" : "h3", {}, detail.text);
  }

  if (detail.type === "paragraph") {
    return el("p", {}, renderInlineText(detail.text));
  }

  if (detail.type === "image") {
    return el("img", {
      src: detail.src,
      alt: detail.alt,
      className: `project-logo ${detail.className || ""}`.trim(),
    });
  }

  if (detail.type === "list") {
    return el("ul", { className: "detail-list" }, detail.items.map((item) =>
      el("li", {}, renderInlineText(item)),
    ));
  }

  if (detail.type === "quote") {
    return renderTroubleshootingQuote(detail);
  }

  if (detail.type === "troubleshooting") {
    return el("div", { className: "troubleshooting-list" }, item.troubleshooting.map(renderTroubleshootingQuote));
  }

  return el("p", {}, detail.text || "");
}

function renderTroubleshootingQuote(detail) {
  const children = [el("strong", {}, detail.title)];

  if (detail.problem) children.push(renderQuoteDetail("문제", detail.problem));
  if (detail.solution) children.push(renderQuoteDetail("해결", detail.solution));
  if (detail.lesson) children.push(renderQuoteDetail("배운점", detail.lesson));
  if (!detail.problem && !detail.solution && !detail.lesson) {
    children.push(renderQuoteDetail("요약", detail.summary || detail.description || ""));
  }

  return el("p", { className: "quote" }, children);
}

function renderQuoteDetail(label, text) {
  return el("span", { className: "quote-detail muted" }, [
    el("strong", { className: "quote-detail-label" }, `${label}:`),
    " ",
    ...renderInlineText(text),
  ]);
}

function renderActivitiesSection(activities) {
  return el("section", { id: "activities", className: "section activities" }, [
    el("h2", {}, "Activities"),
    el("div", { className: "work-divider", ariaHidden: "true" }),
    el("div", { className: "work-list" }, activities.map((activity) =>
      el("article", { className: "work-entry activity-entry" }, [
        el("div", { className: "work-meta sticky" }, [
          el("div", { className: "info" }, [
            el("h3", {}, activity.title),
            el("span", {}, activity.period),
          ]),
        ]),
        el("div", { className: "work-content" }, [
          el("p", { className: "muted" }, activity.description),
        ]),
      ]),
    )),
  ]);
}

function bindInteractions() {
  bindSmoothScroll();
  bindEmailCopy();
  bindQuoteToggle();
}

function bindSmoothScroll() {
  const links = Array.from(document.querySelectorAll(".topbar nav a"));
  const topbar = document.querySelector(".topbar");
  const topbarHeight = topbar ? topbar.offsetHeight : 0;
  const sections = Array.from(document.querySelectorAll("main .section"));

  links.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const target = document.querySelector(link.getAttribute("href"));
      if (!target) return;
      const top = target.getBoundingClientRect().top + window.scrollY - topbarHeight - 12;
      window.scrollTo({ top, behavior: "smooth" });
    });
  });

  function updateActiveLink() {
    const offset = topbarHeight + 12;
    let closest = null;
    let closestDistance = Infinity;

    sections.forEach((section) => {
      const distance = Math.abs(section.getBoundingClientRect().top - offset);
      if (distance < closestDistance) {
        closest = section;
        closestDistance = distance;
      }
    });

    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 10;
    if (atBottom) {
      closest = sections[sections.length - 1] || closest;
    }

    if (!closest) return;
    links.forEach((link) => link.classList.remove("active"));
    const active = document.querySelector(`.topbar nav a[href="#${closest.id}"]`);
    if (active) active.classList.add("active");
  }

  let ticking = false;
  window.addEventListener("scroll", () => {
    if (ticking) return;
    window.requestAnimationFrame(() => {
      updateActiveLink();
      ticking = false;
    });
    ticking = true;
  }, { passive: true });

  updateActiveLink();
}

function bindEmailCopy() {
  const emailLink = document.getElementById("email-link");
  if (!emailLink) return;

  emailLink.addEventListener("click", async (event) => {
    event.preventDefault();
    const email = (emailLink.getAttribute("href") || "").replace(/^mailto:/i, "");
    try {
      await navigator.clipboard.writeText(email);
      showToast("Email copied to clipboard");
    } catch (error) {
      const input = document.createElement("input");
      input.value = email;
      document.body.appendChild(input);
      input.select();
      try {
        document.execCommand("copy");
        showToast("Email copied to clipboard");
      } catch (copyError) {
        showToast("Copy failed");
      }
      input.remove();
    }
  });
}

function bindQuoteToggle() {
  document.querySelectorAll(".work-content .quote > strong").forEach((title) => {
    title.setAttribute("tabindex", "0");
    const toggle = () => title.parentElement.classList.toggle("expanded");
    title.addEventListener("click", toggle);
    title.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggle();
      }
    });
  });
}

function renderHighlightedText(text, highlights) {
  const matches = highlights
    .filter((word) => text.includes(word))
    .sort((a, b) => text.indexOf(a) - text.indexOf(b));

  if (!matches.length) return text;

  const fragments = [];
  let cursor = 0;

  matches.forEach((word) => {
    const index = text.indexOf(word, cursor);
    if (index < 0) return;
    if (index > cursor) fragments.push(text.slice(cursor, index));
    fragments.push(el("strong", {}, word));
    cursor = index + word.length;
  });

  if (cursor < text.length) fragments.push(text.slice(cursor));
  return fragments;
}

function renderInlineText(text = "") {
  const fragments = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let cursor = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) fragments.push(text.slice(cursor, match.index));
    fragments.push(el("strong", {}, match[1]));
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) fragments.push(text.slice(cursor));
  return fragments.length ? fragments : [""];
}

function showToast(text) {
  const toast = el("div", { className: "toast" }, text);
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 250);
  }, 1800);
}

function renderLoadError(error) {
  const root = document.getElementById("web-root");
  root.replaceChildren(el("section", { className: "section loading-state" }, [
    el("h2", {}, "Portfolio data load failed"),
    el("p", { className: "muted" }, `${error.message}. data/portfolio-data.js 로드 구성을 확인해주세요.`),
  ]));
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    if (key === "className") node.className = value;
    else if (key === "ariaHidden") node.setAttribute("aria-hidden", value);
    else if (key === "ariaLabel") node.setAttribute("aria-label", value);
    else node.setAttribute(key, value);
  });

  const childList = Array.isArray(children) ? children : [children];
  childList.filter((child) => child !== null && child !== undefined).forEach((child) => {
    if (Array.isArray(child)) node.append(...child);
    else if (child instanceof Node) node.appendChild(child);
    else node.appendChild(document.createTextNode(child));
  });
  return node;
}

function linkEl(href, children, options = {}) {
  const attrs = {
    href,
    className: options.className,
    id: options.id,
    ariaLabel: options.ariaLabel,
  };
  if (options.external) {
    attrs.target = "_blank";
    attrs.rel = "noopener";
  }
  return el("a", attrs, children);
}
