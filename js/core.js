// js/core.js — v1.2: shared Coming Soon page + hash routing (ASCII-only)
(function () {
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function toTitle(s){ return String(s).toLowerCase().replace(/\b\w/g, function(m){ return m.toUpperCase(); }); }
  function esc(s){ return String(s).replace(/[&<>"']/g,function(ch){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[ch]); }); }

  var VERSION = (typeof window.FV_VERSION === "string" && window.FV_VERSION) || "v1.2.0";
  var MENU = (Array.isArray(window.FV_MENU) && window.FV_MENU.length) ? window.FV_MENU : [
    { id: "home", label: "Home", children: [] },
    { id: "application-records", label: "Application Records", children: [
      { id: "spray-logs", label: "Spray Logs" },
      { id: "planting-logs", label: "Planting Logs" },
      { id: "fertilizer-logs", label: "Fertilizer Logs" },
      { id: "trials", label: "Trials" },
      { id: "harvest-logs", label: "Harvest Logs" }
    ]},
    { id: "equipment", label: "Equipment", children: [
      { id: "tractors", label: "Tractors" },
      { id: "combines", label: "Combines" },
      { id: "sprayers", label: "Sprayers" },
      { id: "implements", label: "Implements" },
      { id: "maintenance", label: "Maintenance" }
    ]},
    { id: "grain", label: "Grain", children: [
      { id: "bins", label: "Bins" },
      { id: "bags", label: "Bags" },
      { id: "contracts", label: "Contracts" },
      { id: "tickets-ocr", label: "Tickets OCR" },
      { id: "shipments", label: "Shipments" }
    ]},
    { id: "setup", label: "Setup", children: [
      { id: "farms", label: "Farms" },
      { id: "fields", label: "Fields" },
      { id: "crop-types", label: "Crop Types" },
      { id: "products", label: "Products" },
      { id: "roles", label: "Roles" },
      { id: "theme", label: "Theme" }
    ]},
    { id: "teams-partners", label: "Teams & Partners", children: [
      { id: "employees", label: "Employees" },
      { id: "vendors", label: "Vendors" },
      { id: "sub-contractors", label: "Sub-Contractors" },
      { id: "partners", label: "Partners" }
    ]}
  ];

  var NAV_OPEN_KEY = "fv_nav_open";
  var LAST_ROUTE_KEY = "fv_last_route";

  var scrollState = {
    locked: false,
    htmlOverflow: "",
    bodyPosition: "",
    bodyOverscroll: ""
  };

  function lockBodyScroll(shouldLock){
    if(shouldLock){
      if(scrollState.locked){ return; }

      scrollState.htmlOverflow = document.documentElement.style.overflow;
      scrollState.bodyPosition = document.body.style.position;
      scrollState.bodyOverscroll = document.body.style.overscrollBehavior;

      document.documentElement.style.overflow = "hidden";
      document.body.style.position = "relative";
      document.body.style.overscrollBehavior = "contain";
      scrollState.locked = true;
      return;
    }

    if(!scrollState.locked){ return; }

    document.documentElement.style.overflow = scrollState.htmlOverflow;
    document.body.style.position = scrollState.bodyPosition;
    document.body.style.overscrollBehavior = scrollState.bodyOverscroll;
    scrollState.locked = false;
  }

  document.addEventListener("DOMContentLoaded", init);
  window.addEventListener("hashchange", handleHashRoute, false);

  function setDrawerOpen(isOpen){
    var drawer = $("#fvSidebar");
    if(!drawer) return;
    var forceOpen = window.innerWidth > 900;
    var open = forceOpen || !!isOpen;
    drawer.setAttribute("aria-hidden", open ? "false" : "true");
    document.body.classList.toggle("drawer-open", open);
    lockBodyScroll(!forceOpen && open);
  }

  function init(){
    var app = $("#app"); if(!app) return;

    app.innerHTML =
      '<div class="fv-shell">' +
        '<aside class="fv-sidebar" id="fvSidebar" aria-hidden="true">' +
          '<div class="s-head">' +
            '<img src="assets/icons/logo.png" alt="FarmVista logo" onerror="this.style.display=\'none\'" />' +
            '<div class="name">FarmVista</div>' +
          '</div>' +
          '<div class="drawer-scroll">' +
            '<nav class="fv-nav" id="fvNav"></nav>' +
          '</div>' +
          '<div class="s-foot" style="padding:10px 12px;color:#9fb8c1;border-top:1px solid rgba(255,255,255,0.06)">' +
            'Version <strong>' + VERSION + '</strong>' +
          '</div>' +
        '</aside>' +

        '<header class="fv-header site-header site-header--with-bc">' +
          '<div class="fv-header-inner">' +
            '<button class="icon-btn" id="btnSidebar" aria-label="Menu" title="Menu">=</button>' +
            '<div class="fv-brand" title="FarmVista">' +
              '<img src="assets/icons/logo.png" alt="FV" onerror="this.style.display=\'none\'">' +
              '<div class="title">FarmVista</div>' +
            '</div>' +
            '<div class="fv-header-actions">' +
              '<button class="icon-btn" title="Search">Search</button>' +
              '<button id="btn-settings" class="btn-gear" type="button" aria-label="Open settings">' +
                '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">' +
                  '<path fill="currentColor" d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Zm8.94 3.06-.98-.57.06-1.14a1 1 0 0 0-.5-.91l-1.04-.6-.34-1.1a1 1 0 0 0-.77-.69l-1.19-.22-.73-.93a1 1 0 0 0-.94-.36l-1.18.2-.93-.73a1 1 0 0 0-.94 0l-.93.73-1.18-.2a1 1 0 0 0-.94.36l-.73.93-1.19.22a1 1 0 0 0-.77.69l-.34 1.1-1.04.6a1 1 0 0 0-.5.91l.06 1.14-.98.57a1 1 0 0 0-.37 1.36l.6 1.04-.22 1.19a1 1 0 0 0 .36.94l.93.73.2 1.18a1 1 0 0 0 .69.77l1.1.34.6 1.04a1 1 0 0 0 .91.5l1.14-.06.57.98a1 1 0 0 0 1.36.37l1.04-.6 1.19.22a1 1 0 0 0 .94-.36l.73-.93 1.18.2a1 1 0 0 0 .94-.36l.73-.93 1.19-.22a1 1 0 0 0 .77-.69l.34-1.1 1.04-.6a1 1 0 0 0 .5-.91l-.06-1.14.98-.57a1 1 0 0 0 .37-1.36l-.6-1.04.22-1.19a1 1 0 0 0-.36-.94l-.93-.73-.2-1.18a1 1 0 0 0-.69-.77l-1.1-.34-.6-1.04a1 1 0 0 0-.91-.5l-1.14.06-.57-.98a1 1 0 0 0-1.36-.37l-1.04.6-1.19-.22a1 1 0 0 0-.94.36l-.73.93-1.18-.2a1 1 0 0 0-.94.36l-.73.93Z"/>' +
                '</svg>' +
              '</button>' +
            '</div>' +
          '</div>' +
          '<div class="header-breadcrumbs">' +
            '<nav class="breadcrumbs" id="fvBreadcrumbs" aria-label="Breadcrumb"></nav>' +
          '</div>' +
        '</header>' +

        '<main class="fv-main"><div class="container" id="fvOutlet"></div></main>' +

        '<footer class="fv-footer">' +
          '<div class="inner"><div>© FarmVista</div><div>' + VERSION + ' • UI shell</div></div>' +
        '</footer>' +
      '</div>';

    buildSidebar($("#fvNav"), MENU);
    setDrawerOpen(window.innerWidth > 900);
    setBreadcrumbs(["Home"]);

    window.addEventListener("resize", function(){
      setDrawerOpen(document.body.classList.contains("drawer-open"));
    });

    var btn = $("#btnSidebar");
    if(btn){
      btn.addEventListener("click", function(){
        var isOpen = document.body.classList.contains("drawer-open");
        setDrawerOpen(!isOpen);
      });
    }

    document.addEventListener("click", function(e){
      if(window.innerWidth > 900) return;
      var sb = $("#fvSidebar"); var toggle = $("#btnSidebar");
      if(!sb) return;
      var insideSidebar = sb.contains(e.target);
      var onToggle = toggle && toggle.contains(e.target);
      if(!insideSidebar && !onToggle){
        setDrawerOpen(false);
      }
    });

    var route = readHashRoute() || readLastRoute();
    if(route){ navigateTo(route.group, route.sub); } else { renderHomeCard(); }
  }

  function buildSidebar(container, menu){
    if(!container) return;
    var openState = getOpenState();
    var html = "";
    for(var i=0;i<menu.length;i++){
      var group = menu[i];
      if(group.id === "home"){ continue; }
      var isOpen = !!openState[group.id];
      html += '<div class="fv-group" data-group="' + esc(group.id) + '">';
      html +=   '<div class="fv-group-header" tabindex="0" role="button" aria-expanded="'+(isOpen?'true':'false')+'">' +
                  '<span>' + esc(group.label || "") + '</span>' +
                  '<span class="chev">' + (isOpen ? "v" : ">") + '</span>' +
                '</div>';
      html +=   '<div class="fv-sublist" style="max-height='+ (isOpen ? '500px' : '0px') +'">';
      var kids = group.children || [];
      for(var k=0;k<kids.length;k++){
        var c = kids[k];
        html += '<a href="#/'+esc(group.id)+'/'+esc(c.id)+'" data-route="' + esc(group.id) + '/' + esc(c.id) + '">• ' + esc(c.label || "") + '</a>';
      }
      html +=   '</div>';
      html += '</div>';
    }
    container.innerHTML = html;

    var headers = $all(".fv-group-header", container);
    for(var h=0;h<headers.length;h++){
      headers[h].addEventListener("click", function(){ toggleGroup(this); });
      headers[h].addEventListener("keydown", function(ev){
        if(ev.key === "Enter" || ev.key === " "){
          ev.preventDefault(); toggleGroup(this);
        }
      });
    }

    var initRoute = readHashRoute();
    if(initRoute){
      var routeStr = initRoute.group + "/" + initRoute.sub;
      highlightActive(routeStr);
      ensureGroupOpen(initRoute.group);
    }

    container.addEventListener("click", function(e){
      var a = e.target.closest ? e.target.closest("a[data-route]") : null;
      if(!a) return;
      var route = a.getAttribute("data-route");
      try{ localStorage.setItem(LAST_ROUTE_KEY, route); }catch(e){}
      setDrawerOpen(false);
    });
  }

  function toggleGroup(headerEl){
    var groupEl = headerEl.parentNode;
    var id = groupEl && groupEl.getAttribute("data-group");
    var sub = $(".fv-sublist", groupEl);
    var chev = $(".chev", headerEl);
    if(!sub || !chev || !id) return;
    var isOpen = sub.style.maxHeight && sub.style.maxHeight !== "0px";
    sub.style.maxHeight = isOpen ? "0px" : "500px";
    chev.textContent = isOpen ? ">" : "v";
    headerEl.setAttribute("aria-expanded", isOpen ? "false" : "true");
    var st = getOpenState(); st[id] = !isOpen; setOpenState(st);
  }

  function ensureGroupOpen(groupId){
    var group = $('.fv-group[data-group="'+CSSescape(groupId)+'"]');
    if(!group) return;
    var headerEl = $(".fv-group-header", group);
    var sub = $(".fv-sublist", group);
    var chev = $(".chev", headerEl);
    if(sub && sub.style.maxHeight === "0px"){
      sub.style.maxHeight = "500px";
      if(chev) chev.textContent = "v";
      if(headerEl) headerEl.setAttribute("aria-expanded","true");
      var st = getOpenState(); st[groupId] = true; setOpenState(st);
    }
  }

  function highlightActive(route){
    var links = $all("#fvNav a");
    for(var i=0;i<links.length;i++){
      links[i].classList.toggle("active", links[i].getAttribute("data-route") === route);
    }
  }

  // Routing
  function handleHashRoute(){
    var r = readHashRoute();
    if(!r){
      highlightActive("");
      setBreadcrumbs(["Home"]);
      renderHomeCard();
      return;
    }
    navigateTo(r.group, r.sub);
  }

  function readHashRoute(){
    var hash = String(window.location.hash || "");
    if(hash.indexOf("#/") !== 0) return null;
    var parts = hash.slice(2).split("/");
    if(parts.length < 2) return null;
    return { group: parts[0], sub: parts[1] };
  }

  function readLastRoute(){
    try{
      var raw = localStorage.getItem(LAST_ROUTE_KEY);
      if(!raw) return null;
      var parts = raw.split("/");
      if(parts.length < 2) return null;
      return { group: parts[0], sub: parts[1] };
    }catch(e){ return null; }
  }

  function navigateTo(group, sub){
    ensureGroupOpen(group);
    var routeStr = group + "/" + sub;
    highlightActive(routeStr);

    setBreadcrumbs(["Home", toTitle(group.replace(/-/g," ")), toTitle(sub.replace(/-/g," "))]);

    var outlet = $("#fvOutlet");
    if(!outlet) return;

    fetch("pages/coming-soon.html", { cache: "no-store" })
      .then(function(res){ return res.text(); })
      .then(function(html){
        outlet.innerHTML = html;
        var h = $("#fv-coming-title", outlet);
        if(h){ h.textContent = toTitle(sub || "Section"); }
        var back = $("#fv-back-home", outlet);
        if(back){
          back.addEventListener("click", function(){
            try{ localStorage.removeItem(LAST_ROUTE_KEY); }catch(e){}
          });
        }
      })
      .catch(function(){
        outlet.innerHTML =
          '<section class="card" style="text-align:center;padding:40px">' +
            '<h2 style="margin:0 0 8px 0">' + esc(toTitle(sub || "Section")) + '</h2>' +
            '<p style="margin:0 0 16px 0;color:var(--fv-text-muted)">This section is under construction.</p>' +
            '<a class="btn" href="#/" id="fv-back-home-fallback">Back to Home</a>' +
          '</section>';
        var fallback = $("#fv-back-home-fallback", outlet);
        if(fallback){
          fallback.addEventListener("click", function(){
            try{ localStorage.removeItem(LAST_ROUTE_KEY); }catch(e){}
          });
        }
      });

    try{ localStorage.setItem(LAST_ROUTE_KEY, routeStr); }catch(e){}
  }

  window.setBreadcrumbs = setBreadcrumbs;
  function setBreadcrumbs(parts){
    var el = $("#fvBreadcrumbs");
    if(!el) return;

    var crumbs = [];
    if(Array.isArray(parts)){
      for(var i=0;i<parts.length;i++){
        var normalized = normalizeCrumb(parts[i]);
        if(normalized){ crumbs.push(normalized); }
      }
    }

    el.innerHTML = "";
    if(!crumbs.length) return;

    for(var j=0;j<crumbs.length;j++){
      var crumb = crumbs[j];
      var isCurrent = j === crumbs.length - 1;
      var isInteractive = !isCurrent && (crumb.href || crumb.go);

      var wrapper = document.createElement("span");
      wrapper.className = "crumb";

      if(isCurrent){
        wrapper.textContent = crumb.label;
        wrapper.setAttribute("aria-current", "page");
      }else if(isInteractive){
        var link = document.createElement("a");
        link.textContent = crumb.label;
        link.setAttribute("href", crumb.href || "#");
        if(crumb.go){
          link.setAttribute("data-go", crumb.go);
        }
        wrapper.appendChild(link);
      }else{
        wrapper.textContent = crumb.label;
      }

      el.appendChild(wrapper);

      if(j < crumbs.length - 1){
        var divider = document.createElement("span");
        divider.className = "sep";
        divider.setAttribute("aria-hidden", "true");
        el.appendChild(divider);
      }
    }
  }

  function normalizeCrumb(part){
    if(part && typeof part === "object"){
      var labelValue = typeof part.label === "string" ? part.label : (part.label != null ? String(part.label) : "");
      if(!labelValue) return null;
      var crumb = { label: labelValue };
      if(typeof part.href === "string" && part.href){
        crumb.href = part.href;
      }
      if(typeof part.go === "string" && part.go){
        crumb.go = part.go;
      }
      return crumb;
    }
    if(part === undefined || part === null) return null;
    var label = String(part);
    return label ? { label: label } : null;
  }

  function renderHomeCard(){
    var outlet = $("#fvOutlet");
    if(outlet){
      outlet.innerHTML =
        '<section class="card" style="padding:24px">' +
          '<h2 style="margin:0 0 8px 0">FarmVista</h2>' +
          '<p style="margin:0;color:var(--fv-text-muted)">AI-assisted farm records & reporting.</p>' +
        '</section>';
    }
  }

  function getOpenState(){
    try{ return JSON.parse(localStorage.getItem(NAV_OPEN_KEY) || "{}"); }catch(e){ return {}; }
  }
  function setOpenState(st){
    try{ localStorage.setItem(NAV_OPEN_KEY, JSON.stringify(st || {})); }catch(e){}
  }

  function CSSescape(s){
    return String(s).replace(/[^a-zA-Z0-9_-]/g, function(ch){
      var code = ch.charCodeAt(0).toString(16).toUpperCase();
      return "\\" + code + " ";
    });
  }
})();

/* ===== Drawer open/close helpers (no-op if you already manage this) ===== */
(function(){
  const html = document.documentElement;
  const body = document.body;

  function lockPage(){
    const drawer = document.querySelector('#fvSidebar, #sideNav, .side-drawer, .sidebar, .fv-sidebar');
    if(drawer){ drawer.setAttribute('aria-hidden', 'false'); }
    body.classList.add('drawer-open');
  }
  function unlockPage(){
    const drawer = document.querySelector('#fvSidebar, #sideNav, .side-drawer, .sidebar, .fv-sidebar');
    if(window.innerWidth > 900){
      if(drawer){ drawer.setAttribute('aria-hidden', 'false'); }
      body.classList.add('drawer-open');
      return;
    }
    if(drawer){ drawer.setAttribute('aria-hidden', 'true'); }
    body.classList.remove('drawer-open');
  }

  // Wire up any toggles you already use: data-drawer-open / data-drawer-close
  document.addEventListener('click', (e)=>{
    const openBtn  = e.target.closest('[data-drawer-open]');
    const closeBtn = e.target.closest('[data-drawer-close],[data-drawer-backdrop]');
    if (openBtn){ lockPage(); }
    if (closeBtn){ unlockPage(); }
  });

  // If your app fires custom events, this makes it resilient:
  window.addEventListener('fv:drawer:open', lockPage);
  window.addEventListener('fv:drawer:close', unlockPage);
})();
