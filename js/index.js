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
        return { trail:[label], label };
      }
      const children = Array.isArray(item.children) ? item.children : [];
      for(const child of children){
        if(child && child.id === id){
          const parentLabel = toText(item.label, toText(item.id, "Section"));
          const childLabel = toText(child.label, toText(child.id, "Section"));
          return { trail:[parentLabel, childLabel], label:childLabel };
        }
      }
    }
    const fallback = "Section";
    return { trail:[fallback], label:fallback };
  }

  function setBreadcrumbs(parts){
    const container = document.getElementById("fvBreadcrumbs");
    if(!container) return;
    container.innerHTML = "";
    const fragment = document.createDocumentFragment();
    parts.forEach((part, index) => {
      const crumb = document.createElement("span");
      crumb.className = index === parts.length - 1 ? "fv-crumb current" : "fv-crumb";
      crumb.textContent = part;
      fragment.appendChild(crumb);
      if(index < parts.length - 1){
        const separator = document.createElement("span");
        separator.setAttribute("aria-hidden", "true");
        separator.textContent = "›";
        fragment.appendChild(separator);
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
    const crumbs = ["Home", ...trail];
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
