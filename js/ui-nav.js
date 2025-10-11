(function(){
  const NAV_ID = "fvNav";
  let drawerEl = null;
  let keydownBound = false;
  let resizeBound = false;

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

  function openDrawer(){
    toggleDrawer(true);
  }

  function closeDrawer(){
    toggleDrawer(false);
  }

  function bindDrawerDismiss(){
    if(!keydownBound){
      document.addEventListener("keydown", (event) => {
        if(event.key === "Escape"){
          closeDrawer();
        }
      });
      keydownBound = true;
    }

    const overlay = document.querySelector(".drawer-overlay");
    if(overlay && !overlay.dataset.fvDrawerBound){
      overlay.addEventListener("click", closeDrawer);
      overlay.dataset.fvDrawerBound = "true";
    }
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
    const root = document.querySelector(".fv-shell") || document.getElementById("app") || document.body;
    if(!root) return;

    drawerEl = ensureDrawer();
    if(drawerEl){
      const startOpen = window.innerWidth > 900;
      setDrawerOpen(startOpen);
      bindDrawerDismiss();
    }

    const navEl = root.querySelector(`#${NAV_ID}`) || document.getElementById(NAV_ID);
    if(navEl && !navEl.dataset.fvNavReady){
      if(!navEl.children.length && !navEl.textContent.trim()){
        navEl.innerHTML = buildNav(window.FV_MENU || []);
      }
      navEl.addEventListener("click", handleNavClick);
      navEl.dataset.fvNavReady = "true";
      navEl.querySelectorAll(".fv-group").forEach(group => setGroupExpanded(group, true));
    }

    const versionTarget = root.querySelector(".fv-footer .version");
    if(versionTarget && typeof window.FV_VERSION === "string"){
      versionTarget.textContent = `Version ${window.FV_VERSION}`;
    }

    const hamburgerButtons = root.querySelectorAll("[data-hamburger]");
    hamburgerButtons.forEach(button => {
      if(button.dataset.fvHamburgerBound === "true") return;
      button.addEventListener("click", () => {
        toggleDrawer();
      });
      button.dataset.fvHamburgerBound = "true";
    });

    if(!resizeBound){
      const handleResize = () => {
        setDrawerOpen(document.body.classList.contains("drawer-open"));
      };
      window.addEventListener("resize", handleResize);
      resizeBound = true;
    }

    const brand = root.querySelector(".fv-brand");
    if(brand && !brand.dataset.fvBrandBound){
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
      brand.dataset.fvBrandBound = "true";
    }
  }

  window.FV_openSidebar = openDrawer;

  window.FV_closeSidebar = function(){
    if(window.innerWidth > 900) return;
    closeDrawer();
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
