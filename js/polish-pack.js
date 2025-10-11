/* FarmVista Polish Pack v1 — behavior glue
   - Make sidebar reliably scrollable (wrap menus if needed)
   - Replace header search/profile with a gear button (to Settings)
   - Normalize breadcrumbs to a single horizontal row with separators
   - Zero dependencies; safe to load on any page
*/

(function(){
  const onReady = (fn) => (document.readyState === "loading") ? document.addEventListener("DOMContentLoaded", fn) : fn();

  onReady(() => {
    try {
      mountSidebarScroll();
      mountSettingsGear();
      normalizeBreadcrumbs();
    } catch(err){
      console.warn("[ui-polish] minor init issue:", err);
    }
  });

  function q(sel, root=document){ return root.querySelector(sel); }
  function qa(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }

  /* 1) Sidebar scroll wrapper (non-destructive) */
  function mountSidebarScroll(){
    const sidebars = qa("nav#side-drawer, .side-drawer, .app-sidebar");
    sidebars.forEach(sb => {
      // If a scroll wrapper already exists, just ensure class is present
      let wrapper = q(".drawer-scroll", sb);
      if(!wrapper){
        // Try to find menu container to wrap
        const menus = qa(".menu, .menu-root, .nav, .drawer-content", sb);
        const target = menus.length ? menus[0] : sb.firstElementChild || sb;
        if(target){
          wrapper = document.createElement("div");
          wrapper.className = "drawer-scroll";
          // Move all siblings of target into wrapper to capture overflow
          const toWrap = [];
          Array.from(sb.childNodes).forEach(n => {
            if(n.nodeType === 1) toWrap.push(n);
          });
          toWrap.forEach(n => wrapper.appendChild(n));
          sb.appendChild(wrapper);
        }
      }
      // nothing else needed; CSS handles the overflow
    });
  }

  /* 2) Header gear button (replaces header search/profile box without editing HTML) */
  function mountSettingsGear(){
    const header = q("#app-header, header");
    if(!header) return;

    // try to find an existing right-side header actions area
    let actions = q(".header-actions, .actions, .right, .toolbar-right", header);
    if(!actions){
      actions = document.createElement("div");
      actions.className = "header-actions";
      header.appendChild(actions);
      actions.style.marginLeft = "auto";
      actions.style.display = "flex";
      actions.style.alignItems = "center";
      actions.style.gap = "10px";
      actions.style.paddingRight = "12px";
    }

    // Remove existing search/profile widgets if present (CSS already hides them)
    qa(".header-search, .profile-box", header).forEach(el => el.remove());

    // Inject a gear button
    if(!q("#fvSettingsBtn", actions)){
      const btn = document.createElement("button");
      btn.id = "fvSettingsBtn";
      btn.className = "fv-gear-btn";
      btn.setAttribute("title","Settings");
      btn.setAttribute("aria-label","Open Settings");
      btn.textContent = "⚙";
      btn.addEventListener("click", () => {
        // Default route to Settings/Setup home; adjust path if needed
        const target = "/settings-setup/index.html";
        // Try same-origin relative path first
        if(location.pathname.endsWith("/")) {
          location.href = `.${target}`;
        } else {
          // resolve from site root and from current folder
          const tryLocal = location.pathname.replace(/\/[^\/]*$/, "") + target;
          location.href = tryLocal;
        }
      });
      actions.appendChild(btn);
    }
  }

  /* 3) Breadcrumbs: ensure single horizontal row with separators */
  function normalizeBreadcrumbs(){
    // Accept common selectors
    let bc = q(".breadcrumbs, .fv-breadcrumbs, #breadcrumbs");
    if(!bc){
      // Sometimes breadcrumbs are a <ul> in the header—convert on the fly
      const ul = q("#app-header ul.breadcrumbs, header ul.breadcrumbs, ul.breadcrumbs");
      if(ul){
        bc = document.createElement("nav");
        bc.className = "breadcrumbs";
        const frag = document.createDocumentFragment();
        qa("li", ul).forEach((li, i, arr) => {
          const link = q("a", li) ? q("a", li).cloneNode(true) : document.createElement("span");
          if(!q("a", li)) link.textContent = li.textContent.trim();
          frag.appendChild(link);
          if(i < arr.length - 1){
            const sep = document.createElement("span");
            sep.className = "sep";
            frag.appendChild(sep);
          }
        });
        bc.appendChild(frag);
        ul.replaceWith(bc);
      }
    } else {
      // If it's a list stack, flatten separators
      const items = qa("li", bc);
      if(items.length){
        const frag = document.createDocumentFragment();
        items.forEach((li, i) => {
          const link = q("a", li) ? q("a", li).cloneNode(true) : document.createElement("span");
          if(!q("a", li)) link.textContent = li.textContent.trim();
          frag.appendChild(link);
          if(i < items.length - 1){
            const sep = document.createElement("span");
            sep.className = "sep";
            frag.appendChild(sep);
          }
        });
        bc.replaceChildren(frag);
      } else {
        // Ensure separators exist between inline anchors if missing
        const anchors = qa("a", bc);
        if(anchors.length){
          const frag = document.createDocumentFragment();
          anchors.forEach((a, i) => {
            frag.appendChild(a.cloneNode(true));
            if(i < anchors.length - 1){
              const sep = document.createElement("span");
              sep.className = "sep";
              frag.appendChild(sep);
            }
          });
          bc.replaceChildren(frag);
        }
      }
    }

    // Optionally pin breadcrumbs to header bottom if header exists
    const header = q("#app-header, header");
    if(header && bc && !header.contains(bc)){
      header.appendChild(bc);
    }
  }
})();
