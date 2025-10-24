<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>FarmVista</title>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no" />
  <meta name="theme-color" content="#3B7E46" />
  <meta name="robots" content="noindex" />
  <style>
    html,body{height:100%}body{margin:0;display:grid;place-items:center;background:#f5f7f4;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
    .splash{display:flex;gap:.75rem;align-items:center;color:#2F6C3C}
    .spinner{width:18px;height:18px;border:2px solid rgba(0,0,0,.2);border-top-color:rgba(0,0,0,.7);border-radius:50%;animation:spin 1s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
  </style>
  <script>
    (function(){
      // Default landing page (change if you want a different start page)
      var DEFAULT = "/Farm-vista/pages/dashboard/";

      try {
        var u = new URL(location.href);
        var next = u.searchParams.get("next") || "";
        var safe = (typeof next === "string" && next.startsWith("/Farm-vista/")) ? next : DEFAULT;

        // Never route back to login now that auth is removed
        var norm = p => p.replace(/\/index\.html$/i,'').replace(/\/+$/,'');
        if (norm(safe).startsWith("/Farm-vista/pages/login")) safe = DEFAULT;

        location.replace(safe);
      } catch (e) {
        location.replace(DEFAULT);
      }
    })();
  </script>
</head>
<body>
  <div class="splash">
    <div class="spinner"></div>
    <div>Loading…</div>
  </div>
  <noscript>
    <p>Continue to <a href="/Farm-vista/pages/dashboard/">Dashboard</a>.</p>
  </noscript>
</body>
</html>