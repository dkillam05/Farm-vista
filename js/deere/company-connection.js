import { ready, getAuth } from '/js/firebase/firebase-init.js';

const api = 'https://farmvista-copilot-300398089669.us-central1.run.app/deere/beta';
const status = document.getElementById('deereStatus');
const result = document.getElementById('deereResult');
result.style.whiteSpace = 'pre-line';
const connect = document.getElementById('deereConnect');
const test = document.getElementById('deereTest');
const chooser = document.createElement('div');
chooser.hidden = true;
chooser.style.width = '100%';
const label = document.createElement('label');
label.textContent = 'Choose the John Deere organization for this FarmVista company';
label.htmlFor = 'deereOrganization';
const select = document.createElement('select');
select.id = 'deereOrganization';
select.style.cssText = 'display:block;width:100%;max-width:100%;margin:12px 0;padding:12px;font:inherit;';
const save = document.createElement('button');
save.type = 'button';
save.className = connect.className;
save.textContent = 'Link selected organization';
chooser.append(label, select, save);
connect.parentNode.insertBefore(chooser, connect);
let selectionId = null;
const params = new URLSearchParams(location.search);
if (params.get('deere') === 'connected') result.textContent = 'John Deere returned to FarmVista. Verifying the connection…';
if (params.get('deere') === 'no_organizations') result.textContent = 'John Deere sign-in worked, but no organization has granted FarmVista access. Connect again and allow access to Dowson Farms on the Deere organization screen.';
if (params.get('deere') === 'select') result.textContent = 'John Deere sign-in worked. Choose the organization below to finish linking this company.';
if (params.get('deere') === 'error') result.textContent = 'The connection was not completed. Please try again or contact Deere support.';
if (params.has('deere')) {
  params.delete('deere');
  history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
}

async function call(path, method = 'GET', fields = {}) {
  await ready;
  const projectId = window.FV_FIREBASE_CONFIG?.projectId;
  const user = getAuth()?.currentUser;
  if (!projectId || !user || typeof user.getIdToken !== 'function') throw new Error('Sign in to a FarmVista farm first.');
  const options = { method, cache: 'no-store', headers: { Authorization: `Bearer ${await user.getIdToken()}` } };
  let url = `${api}/${path}`;
  if (method === 'POST') {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify({ ...fields, projectId });
  } else {
    url += `?projectId=${encodeURIComponent(projectId)}`;
  }
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body.error || `Connection check failed (${response.status}).`);
  return body;
}

async function refresh() {
  try {
    const data = await call('status');
    status.textContent = data.connected
      ? `Connected to ${data.organization || 'John Deere organization'} (ID ${data.organizationId}).`
      : 'Not connected yet. Use the button below, then select your organization on John Deere.';
    selectionId = data.selection?.id || null;
    chooser.hidden = !selectionId;
    select.replaceChildren();
    if (selectionId) {
      status.textContent = 'Choose one organization to link to this FarmVista company.';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Select an organization…';
      select.append(placeholder);
      for (const org of data.selection.organizations) {
        const option = document.createElement('option');
        option.value = org.id;
        option.textContent = `${org.name} (ID ${org.id})`;
        select.append(option);
      }
      save.disabled = true;
    }
    connect.textContent = data.connected ? 'Reconnect John Deere' : 'Connect to John Deere';
    connect.disabled = false;
    test.hidden = !data.connected;
  } catch (e) {
    chooser.hidden = true;
    status.textContent = e.message;
    connect.disabled = true;
    test.hidden = true;
  }
}
select.addEventListener('change', () => { save.disabled = !select.value; });
save.addEventListener('click', async () => {
  if (!selectionId || !select.value) return;
  save.disabled = true;
  connect.disabled = true;
  select.disabled = true;
  result.textContent = 'Verifying and saving the selected organization…';
  try {
    const data = await call('select', 'POST', { selectionId, organizationId: select.value });
    result.textContent = `Connected to ${data.organization}. Use Test connection to check Fields, Field Operations and Equipment.`;
    await refresh();
  } catch (e) {
    result.textContent = e.message;
    chooser.hidden = true;
    connect.disabled = false;
  } finally { select.disabled = false; }
});
connect.addEventListener('click', async () => {
  connect.disabled = true;
  status.textContent = 'Opening John Deere…';
  try {
    const data = await call('start', 'POST');
    const destination = new URL(data.url);
    if (destination.origin !== 'https://signin.johndeere.com') throw new Error('Unexpected sign-in destination.');
    location.assign(destination.href);
  } catch (e) { status.textContent = e.message; connect.disabled = false; }
});
test.addEventListener('click', async () => {
  test.disabled = true;
  result.textContent = 'Checking Deere Fields, Field Operations and Equipment…';
  try {
    const data = await call('test');
    const names = data.fields.map(f => f.name).filter(Boolean);
    result.textContent = `${data.message}\n\n${names.length ? `Example fields: ${names.join(', ')}.` : 'No field names returned.'}`;
  } catch (e) { result.textContent = e.message; }
  finally { test.disabled = false; }
});
refresh();
