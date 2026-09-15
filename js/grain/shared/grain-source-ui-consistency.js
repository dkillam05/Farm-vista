/*
  FarmVista grain source UI consistency
  -------------------------------------
  The data value remains active_field_harvest for compatibility.
  The user-facing name is ALWAYS "Active Harvest".

  Field is not a separate storage type. It is a scoped Active Harvest source.
*/

const path = String(location.pathname || '').toLowerCase();
const supported = [
  '/pages/grain/grain-ticket.html',
  '/pages/grain/grain-ticket-add.html',
  '/pages/grain/grain-ticket-detail.html'
].some(value => path.endsWith(value));

if (supported) {
  const rename = root => {
    const scope = root?.nodeType === Node.ELEMENT_NODE || root?.nodeType === Node.DOCUMENT_NODE
      ? root
      : document;

    const walker = document.createTreeWalker(
      scope,
      NodeFilter.SHOW_TEXT
    );

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    nodes.forEach(node => {
      const raw = String(node.nodeValue || '');
      const trimmed = raw.trim();

      if (trimmed === 'Active Field Harvest') {
        node.nodeValue = raw.replace('Active Field Harvest', 'Active Harvest');
        return;
      }

      if (trimmed.includes('ETA is N/A for Active Field Harvest')) {
        node.nodeValue = raw.replace(
          'ETA is N/A for Active Field Harvest',
          'ETA is N/A for Active Harvest'
        );
      }
    });
  };

  const boot = () => {
    rename(document);

    const observer = new MutationObserver(records => {
      records.forEach(record => {
        record.addedNodes.forEach(node => {
          if (node.nodeType === Node.TEXT_NODE) {
            const raw = String(node.nodeValue || '');
            if (raw.includes('Active Field Harvest')) {
              node.nodeValue = raw.replaceAll('Active Field Harvest', 'Active Harvest');
            }
            return;
          }

          if (node.nodeType === Node.ELEMENT_NODE) rename(node);
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}
