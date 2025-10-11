(function(){
  const MENU = Array.isArray(window.FV_MENU) ? window.FV_MENU : [];

  function escapeHtml(value){
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function toText(value, fallback = ""){
    if(typeof value === "string" && value.trim().length > 0){
      return value;
    }
    if(value === undefined || value === null){
      return fallback;
    }
    return String(value);
  }

  function getOutlet(){
    return document.getElementById("fvOutlet");
  }

  function findTrail(id){
    for(const item of MENU){
      if(typeof item !== "object" || !item) continue;
      if(item.id === id){
        const label = toText(item.label, toText(item.id, "Section"));
        return { trail:[{ id:item.id, label }], label };
      }
      const children = Array.isArray(item.children) ? item.children : [];
      for(const child of children){
        if(child && child.id === id){
          const parentLabel = toText(item.label, toText(item.id, "Section"));
          const childLabel = toText(child.label, toText(child.id, "Section"));
          return {
            trail:[
              { id:item.id, label:parentLabel },
              { id:child.id, label:childLabel }
            ],
            label:childLabel
          };
        }
      }
    }
    const fallbackLabel = toText(id, "Section");
    return { trail:[{ id, label:fallbackLabel }], label:fallbackLabel };
  }

  function normalizeBreadcrumb(part){
    if(part && typeof part === "object"){
      const label = toText(part.label, "");
      if(!label) return null;
      const crumb = { label };
      if(typeof part.href === "string" && part.href){
        crumb.href = part.href;
      }
      if(typeof part.go === "string" && part.go){
        crumb.go = part.go;
      }
      return crumb;
    }
    if(part === undefined || part === null) return null;
    const label = toText(part, "");
    if(!label) return null;
    return { label };
  }

  function setBreadcrumbs(parts){
    const container = document.getElementById("fvBreadcrumbs");
    if(!container) return;

    const crumbs = [];
    (Array.isArray(parts) ? parts : []).forEach((part) => {
      const crumb = normalizeBreadcrumb(part);
      if(crumb){
        crumbs.push(crumb);
      }
    });

    container.innerHTML = "";
    if(!crumbs.length) return;

    const fragment = document.createDocumentFragment();
    crumbs.forEach((crumb, index) => {
      const isCurrent = index === crumbs.length - 1;
      const isInteractive = !isCurrent && (crumb.href || crumb.go);
      const element = document.createElement(isInteractive ? "a" : "span");
      element.textContent = crumb.label;

      if(isInteractive){
        element.setAttribute("href", crumb.href || "#");
        if(crumb.go){
          element.setAttribute("data-go", crumb.go);
        }
      }else if(isCurrent){
        element.classList.add("current");
        element.setAttribute("aria-current", "page");
      }

      fragment.appendChild(element);

      if(index < crumbs.length - 1){
        const divider = document.createElement("span");
        divider.className = "divider";
        divider.setAttribute("aria-hidden", "true");
        divider.textContent = "›";
        fragment.appendChild(divider);
      }
    });

    container.appendChild(fragment);
  }

  function renderHome(){
    const outlet = getOutlet();
    if(!outlet) return;
    const sections = MENU.filter(item => item && item.id !== "home").slice(0, 6);
    const cards = sections.map(section => {
      const id = toText(section.id, "section");
      const labelText = toText(section.label, id);
      return [
        '<article class="card">',
          `<h3>${escapeHtml(labelText)}</h3>`,
          `<p>Overview &amp; tools for ${escapeHtml(labelText.toLowerCase())}.</p>`,
          `<a class="btn" href="#" data-go="${escapeHtml(id)}">Open</a>`,
        '</article>'
      ].join("");
    }).join("");

    outlet.innerHTML = [
      '<section class="hero">',
        '<div>',
          '<h1>FarmVista</h1>',
          '<p>AI-assisted farm records &amp; reporting — clean, modern, office-side data management.</p>',
        '</div>',
        '<div class="logo-wrap">',
          '<img src="assets/icons/logo.svg" alt="FarmVista Logo" style="height:72px;width:auto;">',
        '</div>',
      '</section>',
      '<section class="grid">',
        cards,
      '</section>'
    ].join("");

    setBreadcrumbs(["Home"]);
    if(typeof window.FV_setActiveNav === "function"){
      window.FV_setActiveNav("home");
    }
  }

  function renderPlaceholder(id){
    const outlet = getOutlet();
    if(!outlet) return;
    const { trail, label } = findTrail(id);
    const crumbs = [
      { label: "Home", href: "#/", go: "home" },
      ...trail.map((part) => ({ label: part.label, go: part.id }))
    ];
    setBreadcrumbs(crumbs);
    outlet.innerHTML = [
      '<section class="card" style="text-align:center;padding:40px">',
        `<h2 id="fv-coming-title" style="margin:0 0 8px 0">${escapeHtml(toText(label, "Section"))}</h2>`,
        '<p style="margin:0 0 16px 0;color:var(--fv-text-muted)">This section is under construction. The UI is ready. Data and AI features arrive soon.</p>',
        '<a class="btn" href="#/" id="fv-back-home" data-go="home">Back to Home</a>',
      '</section>'
    ].join("");
    if(typeof window.FV_setActiveNav === "function"){
      window.FV_setActiveNav(id);
    }
  }

  function openSection(id){
    if(id === "home"){
      renderHome();
    }else{
      renderPlaceholder(id);
    }
    if(typeof window.FV_closeSidebar === "function"){
      window.FV_closeSidebar();
    }
  }

  window.FV_openSection = openSection;
  window.setBreadcrumbs = setBreadcrumbs;

  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-go]");
    if(!link) return;
    const target = link.getAttribute("data-go");
    if(!target) return;
    event.preventDefault();
    openSection(target);
  });

  document.addEventListener("DOMContentLoaded", () => {
    renderHome();
    console.info(`FarmVista ${window.FV_VERSION} initialized.`);
  });
})();
