(function(){
  const NAV_ID = "fvNav";
  let drawerEl = null;

  function ensureDrawer(){
    if(drawerEl) return drawerEl;
    drawerEl = document.querySelector("#sideNav, .side-drawer, .sidebar, .fv-sidebar");
    return drawerEl;
  }

  function setDrawerOpen(isOpen){
    const drawer = ensureDrawer();
    if(!drawer) return;
    const forceOpen = window.innerWidth > 900;
    const open = forceOpen || !!isOpen;
    drawer.setAttribute("aria-hidden", open ? "false" : "true");
    document.body.classList.toggle("drawer-open", open);
  }

  function toggleDrawer(force){
    if(typeof force === "boolean"){ setDrawerOpen(force); return; }
    const isOpen = document.body.classList.contains("drawer-open");
    setDrawerOpen(!isOpen);
  }

  function toDomId(value){
    return String(value || "group")
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-");
  }

  function buildNav(menu){
    if(!Array.isArray(menu)) return "";
    return menu.map(item => {
      const title = typeof item.label === "string" ? item.label : "";
      const groupId = typeof item.id === "string" ? item.id : "";
      const children = Array.isArray(item.children) ? item.children : [];

      if(groupId === "home"){
        return [
          '<div class="fv-group fv-group-home" data-group="home">',
            `<a class="fv-home-link" href="#" data-go="${groupId}">`,
              `<span>${escapeHtml(title || "Home")}</span>`,
              '<span aria-hidden="true">›</span>',
            '</a>',
          '</div>'
        ].join("");
      }

      const sublistId = `${NAV_ID}-sub-${toDomId(groupId)}`;

      const childLinks = children.map(child => {
        const childId = typeof child.id === "string" ? child.id : "";
        const childLabel = typeof child.label === "string" ? child.label : childId;
        return `<a href="#" data-go="${childId}">${escapeHtml(childLabel)}</a>`;
      }).join("");

      return [
        `<div class="fv-group" data-group="${groupId}">`,
          `<button class="fv-group-header" type="button" data-toggle-group="${groupId}" aria-expanded="false" aria-controls="${sublistId}">`,
            `<span>${escapeHtml(title)}</span>`,
            '<span class="chevron" aria-hidden="true">⌄</span>',
          '</button>',
          `<div class="fv-sublist" id="${sublistId}" aria-hidden="true">`,
            childLinks,
          '</div>',
        '</div>'
      ].join("");
    }).join("");
  }

  function escapeHtml(value){
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function setGroupExpanded(groupEl, expanded){
    const sublist = groupEl.querySelector(".fv-sublist");
    const header = groupEl.querySelector(".fv-group-header");
    if(!sublist) return;
    const isExpanded = !!expanded;
    groupEl.classList.toggle("expanded", isExpanded);
    if(header){
      header.setAttribute("aria-expanded", isExpanded ? "true" : "false");
    }
    sublist.setAttribute("aria-hidden", isExpanded ? "false" : "true");
    if(isExpanded){
      const scrollHeight = sublist.scrollHeight;
      sublist.style.maxHeight = scrollHeight ? `${scrollHeight}px` : "none";
    }else{
      sublist.style.maxHeight = "0px";
    }
  }

  function toggleGroup(groupEl){
    if(!groupEl) return;
    const expanded = !groupEl.classList.contains("expanded");
    setGroupExpanded(groupEl, expanded);
  }

  function handleNavClick(event){
    const toggleButton = event.target.closest("[data-toggle-group]");
    if(toggleButton){
      event.preventDefault();
      const groupId = toggleButton.getAttribute("data-toggle-group");
      const groupEl = toggleButton.closest(`.fv-group[data-group="${groupId}"]`);
      toggleGroup(groupEl);
      return;
    }

    const link = event.target.closest("a[data-go]");
    if(link){
      event.preventDefault();
      const go = link.getAttribute("data-go");
      if(typeof window.FV_openSection === "function"){
        window.FV_openSection(go);
      }
      if(typeof window.FV_closeSidebar === "function"){
        window.FV_closeSidebar();
      }
    }
  }

  function initShell(){
    const root = document.getElementById("app");
    if(!root) return;

    root.innerHTML = [
      '<div class="fv-shell">',
        '<aside class="fv-sidebar" aria-label="Primary" aria-hidden="true">',
          '<div class="s-head">',
            '<img src="assets/icons/logo.svg" alt="FarmVista logo" loading="lazy" />',
            '<div class="name">FarmVista</div>',
          '</div>',
          '<div class="drawer-scroll">',
            `<nav class="fv-nav" id="${NAV_ID}" aria-label="Section navigation"></nav>`,
          '</div>',
        '</aside>',
        '<header class="fv-header site-header site-header--with-bc">',
          '<div class="fv-header-inner">',
            '<button class="icon-btn" id="fvSidebarToggle" type="button" aria-label="Toggle navigation">☰</button>',
            '<div class="fv-brand" role="link" tabindex="0" data-go="home">',
              '<img src="assets/icons/logo.svg" alt="FarmVista logo" />',
              '<span class="title">FarmVista</span>',
            '</div>',
            '<div class="fv-header-actions">',
              '<button class="icon-btn" type="button" aria-label="View notifications">🔔</button>',
              '<button id="btn-settings" class="btn-gear" type="button" aria-label="Open settings">',
                '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">',
                  '<path fill="currentColor" d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Zm8.94 3.06-.98-.57.06-1.14a1 1 0 0 0-.5-.91l-1.04-.6-.34-1.1a1 1 0 0 0-.77-.69l-1.19-.22-.73-.93a1 1 0 0 0-.94-.36l-1.18.2-.93-.73a1 1 0 0 0-.94 0l-.93.73-1.18-.2a1 1 0 0 0-.94.36l-.73.93-1.19.22a1 1 0 0 0-.77.69l-.34 1.1-1.04.6a1 1 0 0 0-.5.91l.06 1.14-.98.57a1 1 0 0 0-.37 1.36l.6 1.04-.22 1.19a1 1 0 0 0 .36.94l.93.73.2 1.18a1 1 0 0 0 .69.77l1.1.34.6 1.04a1 1 0 0 0 .91.5l1.14-.06.57.98a1 1 0 0 0 1.36.37l1.04-.6 1.19.22a1 1 0 0 0 .94-.36l.73-.93 1.18.2a1 1 0 0 0 .94-.36l.73-.93 1.19-.22a1 1 0 0 0 .77-.69l.34-1.1 1.04-.6a1 1 0 0 0 .5-.91l-.06-1.14.98-.57a1 1 0 0 0 .37-1.36l-.6-1.04.22-1.19a1 1 0 0 0-.36-.94l-.93-.73-.2-1.18a1 1 0 0 0-.69-.77l-1.1-.34-.6-1.04a1 1 0 0 0-.91-.5l-1.14.06-.57-.98a1 1 0 0 0-1.36-.37l-1.04.6-1.19-.22a1 1 0 0 0-.94.36l-.73.93-1.18-.2a1 1 0 0 0-.94.36l-.73.93Z"/>',
                '</svg>',
              '</button>',
            '</div>',
          '</div>',
          '<div class="header-breadcrumbs">',
            '<nav class="breadcrumb-bar" id="fvBreadcrumbs" aria-live="polite" aria-label="Breadcrumb"></nav>',
          '</div>',
        '</header>',
        '<main class="fv-main" id="fvMain">',
          '<div class="container">',
            '<div id="fvOutlet"></div>',
          '</div>',
        '</main>',
        '<footer class="fv-footer">',
          '<div class="inner">',
            '<span>&copy; FarmVista</span>',
            '<span class="version"></span>',
          '</div>',
        '</footer>',
      '</div>'
    ].join("");

    drawerEl = root.querySelector(".fv-sidebar");
    const startOpen = window.innerWidth > 900;
    setDrawerOpen(startOpen);

    const navEl = document.getElementById(NAV_ID);
    if(navEl){
      navEl.innerHTML = buildNav(window.FV_MENU || []);
      navEl.addEventListener("click", handleNavClick);
      navEl.querySelectorAll(".fv-group").forEach(group => setGroupExpanded(group, true));
    }

    const versionTarget = root.querySelector(".fv-footer .version");
    if(versionTarget && typeof window.FV_VERSION === "string"){
      versionTarget.textContent = `Version ${window.FV_VERSION}`;
    }

    const toggle = document.getElementById("fvSidebarToggle");
    if(toggle){
      toggle.addEventListener("click", () => {
        toggleDrawer();
      });
    }

    const handleResize = () => {
      setDrawerOpen(document.body.classList.contains("drawer-open"));
    };
    window.addEventListener("resize", handleResize);

    const brand = root.querySelector(".fv-brand");
    if(brand){
      const goHome = () => {
        if(typeof window.FV_openSection === "function"){
          window.FV_openSection("home");
        }
      };
      brand.addEventListener("click", goHome);
      brand.addEventListener("keydown", (event) => {
        if(event.key === "Enter" || event.key === " "){
          event.preventDefault();
          goHome();
        }
      });
    }
  }

  window.FV_closeSidebar = function(){
    if(window.innerWidth > 900) return;
    toggleDrawer(false);
  };

  window.FV_setActiveNav = function(targetId){
    const navEl = document.getElementById(NAV_ID);
    if(!navEl) return;

    navEl.querySelectorAll("a[data-go]").forEach(link => {
      link.classList.remove("active");
    });
    navEl.querySelectorAll(".fv-group").forEach(group => {
      group.classList.remove("active");
    });
    navEl.querySelectorAll(".fv-group-header").forEach(header => {
      header.classList.remove("active");
    });

    if(targetId === "home"){
      const homeLink = navEl.querySelector('.fv-home-link[data-go="home"]');
      if(homeLink){
        homeLink.classList.add("active");
        const homeGroup = homeLink.closest(".fv-group");
        if(homeGroup){
          homeGroup.classList.add("active");
        }
      }
      return;
    }

    const exactLink = navEl.querySelector(`a[data-go="${targetId}"]`);
    if(exactLink){
      exactLink.classList.add("active");
      const group = exactLink.closest(".fv-group");
      if(group){
        group.classList.add("active");
        setGroupExpanded(group, true);
      }
      return;
    }

    const groupMatch = navEl.querySelector(`.fv-group[data-group="${targetId}"]`);
    if(groupMatch){
      groupMatch.classList.add("active");
      const header = groupMatch.querySelector(".fv-group-header");
      if(header){
        header.classList.add("active");
      }
      setGroupExpanded(groupMatch, true);
    }
  };

  document.addEventListener("DOMContentLoaded", initShell);
})();
