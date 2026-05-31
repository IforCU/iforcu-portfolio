// PDF-only portfolio deck renderer.
// This file is intentionally standalone so pdf.html can render the deck directly.

function renderPrintPortfolio(data) {
  const root = document.getElementById("print-root");
  if (!root) return;

  const cases = getOrderedPrintCases(data);
  const pageFactories = [
    (page, totalPages) => renderPrintCover(data.profile, page, totalPages),
    (page, totalPages) => renderPrintAbout(data.profile, cases, page, totalPages),
  ];

  cases.forEach((item) => {
    pageFactories.push((page, totalPages) => renderPrintCaseSlide(item, page, totalPages));
    if ((item.troubleshooting || []).length) {
      pageFactories.push((page, totalPages) => renderPrintTroubleDetailSlide(item, page, totalPages));
    }
  });

  root.replaceChildren(
    ...pageFactories.map((factory, index) => factory(index + 1, pageFactories.length)),
  );
}

function getOrderedPrintCases(data) {
  const casesById = new Map(data.cases.map((item) => [item.id, item]));
  const order = data.print?.order || data.cases.map((item) => item.id);
  return order.map((id) => casesById.get(id)).filter(Boolean);
}

function renderPrintCover(profile, page, totalPages) {
  return printPage("print-cover-page", [
    printTop("BACKEND / DEVOPS PORTFOLIO", page, totalPages),
    pdfEl("div", { className: "print-cover-layout" }, [
      pdfEl("div", { className: "print-cover-copy" }, [
        pdfEl("p", { className: "print-eyebrow" }, "Backend Developer"),
        pdfEl("h1", { className: "print-title print-title-xl" }, profile.name?.en || profile.name),
        pdfEl("p", { className: "print-korean-name" }, profile.name?.ko || ""),
        pdfEl("p", { className: "print-lead" }, renderPdfInlineText(profile.summary)),
        renderPrintChips(profile.keywords, "print-keyword-row"),
        pdfEl("div", { className: "print-contact-strip" }, [
          renderPrintContactItem("Email", profile.contacts.email.value),
          renderPrintContactItem("GitHub", profile.contacts.github.label),
        ]),
      ]),
      pdfEl("div", { className: "print-profile-panel" }, [
        pdfEl("img", { src: profile.photo, alt: "Profile photo", className: "print-profile-photo" }),
        renderPrintProfileStack(profile),
      ]),
    ]),
    pdfEl("div", { className: "print-activity-band" }, [
      pdfEl("div", {}, [
        pdfEl("h2", { className: "print-section-label" }, "Activities"),
      ]),
      pdfEl("div", { className: "print-activity-content" }, [
        renderPrintEducation(profile.activities || []),
        renderPrintAwards(profile.awards || []),
      ]),
    ]),
    printFooter(profile.name?.en || "Kim Seung Hyeon", page, totalPages),
  ]);
}

function renderPrintAbout(profile, cases, page, totalPages) {
  return printPage("print-about-page", [
    printTop("ABOUT / PROJECT PREVIEW", page, totalPages),
    pdfEl("div", { className: "print-two-column" }, [
      pdfEl("div", { className: "print-about-main" }, [
        pdfEl("h1", { className: "print-title" }, "전체 흐름을 보고, 유지 가능한 구조로 정리합니다."),
        pdfEl("div", { className: "print-panel print-about-copy" }, [
          renderPrintAboutCopy(profile),
        ]),
        pdfEl("div", { className: "print-value-grid" }, (profile.pdfValues || []).map((value) =>
          pdfEl("div", { className: "print-value-card" }, [
            pdfEl("span", {}, value.number),
            pdfEl("strong", {}, value.title),
            pdfEl("p", {}, value.description),
          ]),
        )),
      ]),
      renderPrintProjectPreview(cases),
    ]),
    printFooter(profile.name?.en || "Kim Seung Hyeon", page, totalPages),
  ]);
}

function renderPrintCaseSlide(item, page, totalPages) {
  const caseType = item.type === "work" ? "WORK EXPERIENCE" : "PROJECT";

  return printPage(`print-case-page print-${item.id}`, [
    printTop(caseType, page, totalPages),
    pdfEl("div", { className: "print-case-head" }, [
      pdfEl("div", {}, [
        pdfEl("h1", { className: "print-title" }, item.title),
        pdfEl("p", { className: "print-case-meta" }, [
          item.roles.join(" / "),
          " · ",
          item.period,
          " · ",
          item.teamSize,
        ]),
      ]),
    ]),
    pdfEl("div", { className: "print-case-hero" }, [
      pdfEl("div", { className: "print-panel print-overview-panel" }, [
        pdfEl("p", { className: "print-section-label" }, "Overview"),
        pdfEl("p", { className: "print-case-overview" }, renderPdfInlineText(item.overview)),
        renderPrintProcess(item.process || []),
      ]),
      pdfEl("div", { className: "print-visual-panel" }, [
        pdfEl("img", { src: item.asset.src, alt: item.asset.alt, className: "print-case-visual" }),
      ]),
    ]),
    pdfEl("div", { className: "print-case-bottom" }, [
      pdfEl("div", { className: "print-panel print-contribution-panel" }, [
        pdfEl("p", { className: "print-section-label" }, "Contribution"),
        renderPrintContributionGroups(item.roleContributions || []),
      ]),
      renderPrintCaseInfoPanel(item),
    ]),
    printFooter("Kim Seung Hyeon Portfolio", page, totalPages),
  ]);
}

function renderPrintTroubleDetailSlide(item, page, totalPages) {
  const troubleItems = item.troubleshooting || [];

  return printPage(`print-trouble-detail-page print-${item.id}`, [
    printTop("TROUBLESHOOTING DETAIL", page, totalPages),
    pdfEl("div", { className: "print-detail-head" }, [
      pdfEl("div", {}, [
        pdfEl("h1", { className: "print-title" }, `${item.title} Troubleshooting`),
        pdfEl("p", { className: "print-case-meta" }, [
          item.roles.join(" / "),
          " · ",
          item.period,
          " · ",
          item.teamSize,
        ]),
      ]),
    ]),
    pdfEl("div", { className: `print-before-after-grid count-${Math.min(troubleItems.length, 4)}` }, troubleItems.map((trouble, index) =>
      renderPrintBeforeAfterCard(trouble, index),
    )),
    printFooter("Kim Seung Hyeon Portfolio", page, totalPages),
  ]);
}

function printPage(className, children) {
  return pdfEl("article", { className: `print-page ${className}` }, children);
}

function printTop(label, page, totalPages) {
  return pdfEl("div", { className: "print-top" }, [
    pdfEl("span", { className: "print-pill" }, label),
  ]);
}

function printFooter(title, page, totalPages) {
  return pdfEl("div", { className: "print-footer" }, [
    pdfEl("span", {}, title),
    pdfEl("span", {}, `${String(page).padStart(2, "0")} / ${String(totalPages).padStart(2, "0")}`),
  ]);
}

function renderPrintChips(items = [], className) {
  return pdfEl("div", { className }, items.map((item) => pdfEl("span", { className: "print-chip" }, item)));
}

function renderPrintProcess(steps) {
  if (!steps.length) return null;
  return pdfEl("div", { className: "print-process-block" }, [
    pdfEl("p", { className: "print-subsection-label" }, "Core Flow"),
    pdfEl("div", { className: "print-process" }, steps.map((step, index) =>
      pdfEl("div", { className: "print-process-step" }, [
        pdfEl("span", {}, String(index + 1).padStart(2, "0")),
        pdfEl("strong", {}, step),
      ]),
    )),
  ]);
}

function renderPrintContactItem(label, value) {
  return pdfEl("div", { className: "print-contact-item" }, [
    pdfEl("strong", {}, label),
    pdfEl("span", {}, value),
  ]);
}

function renderPrintEducation(activities) {
  if (!activities.length) return null;
  return pdfEl("div", { className: "print-education-section" }, [
    pdfEl("p", { className: "print-education-heading" }, "Education"),
    pdfEl("div", { className: "print-activity-timeline" }, sortPrintItemsByDate(activities).map((activity) =>
      pdfEl("div", { className: "print-activity-item" }, [
        pdfEl("span", {}, activity.period),
        pdfEl("strong", {}, activity.title),
        pdfEl("p", {}, activity.description),
      ]),
    )),
  ]);
}

function renderPrintProfileStack(profile) {
  return pdfEl("div", { className: "print-profile-stack" }, [
    pdfEl("p", { className: "print-section-label" }, "Tech Stack"),
    pdfEl("div", { className: "print-profile-stack-groups" }, profile.techStack.map((group) =>
      pdfEl("div", { className: "print-profile-stack-group" }, [
        pdfEl("strong", {}, group.category),
        renderPrintChips(group.items, "print-profile-chip-row"),
      ]),
    )),
    pdfEl("p", { className: "print-section-label print-profile-cert-label" }, "Certification"),
    pdfEl("div", { className: "print-profile-cert-list" }, profile.certifications.map((cert) =>
      pdfEl("div", { className: "print-profile-cert-item" }, [
        pdfEl("strong", {}, cert.title),
        pdfEl("span", {}, cert.date),
      ]),
    )),
  ]);
}

function renderPrintAwards(awards) {
  if (!awards.length) return null;
  return pdfEl("div", { className: "print-award-section" }, [
    pdfEl("p", { className: "print-award-heading" }, "Awards"),
    pdfEl("div", { className: "print-award-list" }, sortPrintItemsByDate(awards).map((award) =>
      pdfEl("div", { className: "print-award-item" }, [
        pdfEl("span", {}, `${award.date} · ${award.host}`),
        pdfEl("strong", {}, award.title),
        pdfEl("p", {}, `${award.program} · ${award.description}`),
      ]),
    )),
  ]);
}

function sortPrintItemsByDate(items = []) {
  return [...items].sort((a, b) => getPrintDateRank(b) - getPrintDateRank(a));
}

function getPrintDateRank(item) {
  const rawDate = item.date || item.period || "";
  if (rawDate.includes("현재")) return Number.MAX_SAFE_INTEGER;

  const matches = rawDate.match(/\d{4}[.-]\d{1,2}(?:[.-]\d{1,2})?/g);
  const target = matches ? matches[matches.length - 1] : "";
  if (!target) return 0;

  const [year, month = "1", day = "1"] = target.split(/[.-]/).map(Number);
  return new Date(year, month - 1, day).getTime();
}

function renderPrintAboutCopy(profile) {
  const valueItems = (profile.values || []).flatMap((group) => group.items || []).slice(0, 4);

  return pdfEl("div", { className: "print-about-copy-inner" }, [
    pdfEl("p", {}, renderPdfInlineText(profile.about)),
    pdfEl("ul", { className: "print-about-bullet-list" }, valueItems.map((item) =>
      pdfEl("li", {}, renderPdfInlineText(item)),
    )),
  ]);
}

function renderPrintProjectPreview(cases) {
  return pdfEl("aside", { className: "print-project-preview-panel" }, [
    pdfEl("p", { className: "print-section-label" }, "Project Preview"),
    pdfEl("div", { className: "print-project-preview-grid" }, cases.map((item) =>
      pdfEl("div", { className: "print-project-preview-card" }, [
        pdfEl("div", { className: "print-project-preview-image" }, [
          pdfEl("img", { src: item.asset.src, alt: item.asset.alt }),
        ]),
        pdfEl("strong", {}, item.title),
        pdfEl("span", {}, item.roles.join(" / ")),
      ]),
    )),
  ]);
}

function renderPrintCaseInfoPanel(item) {
  return pdfEl("div", { className: "print-panel print-case-info-panel" }, [
    pdfEl("p", { className: "print-section-label" }, "Tech Stack"),
    renderPrintChips(item.tech || [], "print-case-tech"),
    pdfEl("p", { className: "print-section-label print-link-label" }, "Links"),
    renderPrintCaseLinks(item.links || []),
  ]);
}

function renderPrintCaseLinks(links) {
  if (!links.length) {
    return pdfEl("p", { className: "print-empty-link" }, "공개 링크 없음");
  }

  return pdfEl("div", { className: "print-case-link-list" }, links.map((link) =>
    pdfEl("a", { href: link.url, target: "_blank", rel: "noopener" }, [
      pdfEl("strong", {}, link.label),
      pdfEl("span", {}, link.url),
    ]),
  ));
}

function renderPrintContributionGroups(groups) {
  return pdfEl("div", { className: "print-contribution-groups" }, groups.map((group) =>
    pdfEl("div", { className: "print-contribution-group" }, [
      pdfEl("strong", {}, group.role),
      pdfEl("ul", {}, group.items.map((item) => pdfEl("li", {}, renderPdfInlineText(item)))),
    ]),
  ));
}

function renderPrintBeforeAfterCard(trouble, index) {
  return pdfEl("div", { className: "print-ba-card" }, [
    pdfEl("div", { className: "print-ba-card-head" }, [
      pdfEl("span", {}, String(index + 1).padStart(2, "0")),
      pdfEl("strong", {}, trouble.title),
    ]),
    renderPrintBeforeAfterLine("before", "문제", trouble.problem || trouble.summary),
    renderPrintBeforeAfterLine("after", "해결", trouble.solution || trouble.summary),
    renderPrintBeforeAfterLine("lesson", "배운점", trouble.lesson || trouble.summary),
  ]);
}

function renderPrintBeforeAfterLine(type, label, text) {
  return pdfEl("div", { className: `print-ba-line print-ba-${type}` }, [
    pdfEl("span", {}, label),
    pdfEl("div", {}, [
      pdfEl("p", {}, renderPdfInlineText(text || "")),
    ]),
  ]);
}

function renderPdfInlineText(text = "") {
  const fragments = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let cursor = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) fragments.push(text.slice(cursor, match.index));
    fragments.push(pdfEl("strong", {}, match[1]));
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) fragments.push(text.slice(cursor));
  return fragments.length ? fragments : [""];
}

function pdfEl(tag, attrs = {}, children = []) {
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

window.renderPrintPortfolio = renderPrintPortfolio;
