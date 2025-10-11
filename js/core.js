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

  document.addEventListener("DOMContentLoaded", init);
  window.addEventListener("hashchange", handleHashRoute, false);

  function init(){
    var app = $("#app"); if(!app) return;

    app.innerHTML =
      '<div class="fv-shell">' +
        '<aside class="fv-sidebar" id="fvSidebar">' +
          '<div class="s-head">' +
            '<img src="assets/icons/logo.png" alt="FarmVista logo" onerror="this.style.display=\'none\'" />' +
            '<div class="name">FarmVista</div>' +
          '</div>' +
          '<nav class="fv-nav" id="fvNav"></nav>' +
          '<div class="s-foot" style="padding:10px 12px;color:#9fb8c1;border-top:1px solid rgba(255,255,255,0.06)">' +
            'Version <strong>' + VERSION + '</strong>' +
          '</div>' +
        '</aside>' +

        '<header class="fv-header">' +
          '<div class="fv-header-inner">' +
            '<button class="icon-btn" id="btnSidebar" aria-label="Menu" title="Menu">=</button>' +
            '<div class="fv-brand" title="FarmVista">' +
              '<img src="assets/icons/logo.png" alt="FV" onerror="this.style.display=\'none\'">' +
              '<div class="title">FarmVista</div>' +
            '</div>' +
            '<nav class="fv-breadcrumbs" id="fvBreadcrumbs" aria-label="Breadcrumb"></nav>' +
            '<div class="fv-header-actions">' +
              '<button class="icon-btn" title="Search">Search</button>' +
              '<button class="icon-btn" title="Profile">Profile</button>' +
            '</div>' +
          '</div>' +
        '</header>' +

        '<main class="fv-main"><div class="container" id="fvOutlet"></div></main>' +

        '<footer class="fv-footer">' +
          '<div class="inner"><div>© FarmVista</div><div>' + VERSION + ' • UI shell</div></div>' +
        '</footer>' +
      '</div>';

    buildSidebar($("#fvNav"), MENU);
    setBreadcrumbs(["Home"]);

    var btn = $("#btnSidebar");
    if(btn){
      btn.addEventListener("click", function(){
        if(document.body.classList.contains("sidebar-open")){
          document.body.classList.remove("sidebar-open");
        } else {
          document.body.classList.add("sidebar-open");
        }
      });
    }

    document.addEventListener("click", function(e){
      if(window.innerWidth > 900) return;
      var sb = $("#fvSidebar"); var toggle = $("#btnSidebar");
      if(!sb) return;
      var insideSidebar = sb.contains(e.target);
      var onToggle = toggle && toggle.contains(e.target);
      if(!insideSidebar && !onToggle){
        document.body.classList.remove("sidebar-open");
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
      document.body.classList.remove("sidebar-open");
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
    var el = $("#fvBreadcrumbs"); if(!el) return;
    var out = [];
    for(var i=0;i<parts.length;i++){
      var cls = (i === parts.length-1) ? "fv-crumb current" : "fv-crumb";
      out.push('<span class="'+cls+'">'+esc(String(parts[i]))+'</span>');
      if(i < parts.length-1){ out.push('<span aria-hidden="true">></span>'); }
    }
    el.innerHTML = out.join("");
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
