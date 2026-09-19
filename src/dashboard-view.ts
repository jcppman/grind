export function dashboardHtml(nonce: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Grind — Initiatives</title><style nonce="${nonce}">
:root{font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#24352e;background:#f4f5f1;font-synthesis:none}
*{box-sizing:border-box}
body{margin:0}
button,input{font:inherit}
button{cursor:pointer}
button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #84a98c;outline-offset:3px}
button:disabled{cursor:default;opacity:.45}
header{background:#183b2d;color:#fff;padding:26px max(5vw,24px);display:flex;align-items:center;justify-content:space-between}
.brand{font-size:23px;font-weight:750;letter-spacing:-1px}
.brand span{color:#bad6b5;font-weight:400;margin-left:14px;font-size:13px;letter-spacing:2px;text-transform:uppercase}
.local{font-size:12px;color:#c4d3c8}
.local:before{content:'●';color:#bfe7a8;margin-right:7px}
main{max-width:1180px;margin:0 auto;padding:48px 24px}
h1{font-size:38px;letter-spacing:-1.4px;margin:8px 0 10px}
p{line-height:1.6}
.intro{display:flex;justify-content:space-between;align-items:center;gap:20px}
.muted{color:#6d7c73;font-size:13px;overflow-wrap:anywhere}
.refresh{background:#fff;border:1px solid #cbd3c9;padding:10px 18px;border-radius:7px}
.toolbar{display:flex;align-items:center;justify-content:space-between;gap:20px;margin:30px 0 22px}
.filters{display:flex;gap:5px;flex-wrap:wrap}
.filter{border:0;background:transparent;padding:9px 13px;border-radius:6px;color:#617367}
.filter[aria-pressed=true]{background:#dce8d8;color:#234a33;font-weight:650}
input{border:1px solid #d2d9cd;border-radius:7px;background:#fafbf8;padding:10px 12px;min-width:240px}
.card{background:#fff;border:1px solid #dce1d7;border-radius:12px;margin-bottom:18px;overflow:hidden}
.cardhead{padding:23px 25px 18px;display:flex;justify-content:space-between;align-items:flex-start;gap:18px}
h2{font-size:18px;letter-spacing:-.3px;margin:9px 0;overflow-wrap:anywhere}
.badges{display:flex;gap:7px}
.badge{font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:5px 8px;border-radius:4px;background:#e4efdf;color:#426137}
.closed{background:#eef0ed;color:#67736c}
.unavailable{background:#fff0dc;color:#8b5b22}
.archived{background:#eeebf5;color:#76638d}
.task{margin:5px 0;font-size:14px}
.next{font-size:13px;color:#6d7c73;margin:7px 0 0}
.copy{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:36px;height:36px;background:#f8faf5;border:1px solid #d5dfce;color:#35553a;border-radius:6px;padding:8px}
.copy:hover:not(:disabled){background:#edf4e7}
.repos{border-top:1px solid #eef0ea;padding:17px 25px;background:#fbfcf9}
.sectionlabel{font-size:10px;letter-spacing:1.4px;text-transform:uppercase;color:#81907c;font-weight:700}
.repo{display:flex;justify-content:space-between;gap:16px;align-items:center;margin-top:14px}
.reponame{font-size:13px;font-weight:650}
.branch{font-family:ui-monospace,monospace;font-size:11px;color:#788575;margin-left:12px}
.path{font-family:ui-monospace,monospace;font-size:11px;color:#7c897b;overflow-wrap:anywhere;margin-top:6px}
.warning{font-size:12px;color:#986528;margin:7px 0}
.diagnostics{margin:0;padding:13px 25px;background:#fff9ed;border-top:1px solid #f1e7ce;font-size:12px;color:#85652f;list-style:none}
.diagnostics li+li{margin-top:6px}
.empty{padding:54px 24px;text-align:center;border:1px dashed #cbd6c6;border-radius:12px;color:#6d7c73}
footer{margin-top:25px;display:flex;justify-content:space-between;font-size:11px;color:#839080}
#notice{font-size:13px;color:#456642}
#fallback{background:#fff5df;padding:18px;border-radius:8px;margin-bottom:18px}
#fallback textarea{display:block;width:100%;margin-top:10px;padding:10px;min-height:70px;border:1px solid #d3c7a8;border-radius:5px}
#error{color:#984e35;margin:16px 0}
 @media(max-width:650px){main{padding:28px 16px}
h1{font-size:30px}
.toolbar{align-items:stretch;flex-direction:column}
.cardhead{padding:18px;flex-direction:column}
.repos{padding:16px 18px}
.repo{align-items:flex-start}
.brand span{display:none}
.intro{align-items:flex-start}
.branch{display:block;margin:5px 0}
.local{font-size:11px}
footer{gap:14px}
}

</style></head><body><header><div class="brand">grind<span>Workspace</span></div><div class="local">Local · read only</div></header>
<main><div class="intro"><div><h1>Initiatives</h1><div id="workspace" class="muted">Loading workspace…</div></div><button id="refresh" class="refresh">↻ Refresh</button></div>
<div class="toolbar"><div class="filters" aria-label="Filter initiatives"><button class="filter" data-filter="all" aria-pressed="true">All</button><button class="filter" data-filter="open" aria-pressed="false">Open</button><button class="filter" data-filter="closed" aria-pressed="false">Closed</button><button class="filter" data-filter="archived" aria-pressed="false">Archived</button></div><input id="search" type="search" aria-label="Search initiatives" placeholder="Search initiatives…"></div>
<p id="notice" role="status" aria-live="polite"></p><div id="fallback" hidden><label for="command">Clipboard unavailable. Copy this command manually.</label><textarea id="command" readonly></textarea></div><div id="error" role="alert"></div><div id="listing" aria-live="polite"></div><footer><span>Records stay in your workspace.</span><span id="updated"></span></footer></main><script nonce="${nonce}" src="app.js"></script></body></html>`;
}

export const dashboardScript = String.raw`
const $ = (id) => document.getElementById(id);
let data = null;
let filter = 'all';
function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function copyButton(command, label) {
  const button = element('button', 'copy');
  button.setAttribute('aria-label', label);
  button.title = label;
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('width', '18');
  icon.setAttribute('height', '18');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '1.7');
  icon.setAttribute('aria-hidden', 'true');
  const outline = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  outline.setAttribute('d', 'M9 5V3h12v14h-2M3 7h12v14H3z');
  outline.setAttribute('stroke-linejoin', 'round');
  icon.append(outline);
  button.append(icon);
  button.disabled = command === null;
  button.addEventListener('click', async () => {
    $('fallback').hidden = true;
    $('notice').textContent = '';
    try {
      await navigator.clipboard.writeText(command);
      $('notice').textContent = 'Copied: ' + command;
    } catch {
      $('command').value = command;
      $('fallback').hidden = false;
      $('command').focus();
      $('command').select();
    }
  });
  return button;
}
function render() {
  const query = $('search').value.toLowerCase();
  const entries = data.initiatives.filter(i =>
    (filter === 'all' || (filter === 'archived' ? i.archived : !i.archived && i.status === filter)) &&
    (i.id + ' ' + (i.task || '')).toLowerCase().includes(query));
  $('listing').replaceChildren();
  if (!entries.length) $('listing').append(element('div', 'empty', data.initiatives.length ? 'No initiatives match this view.' : 'No initiatives yet. Create an initiative to see it here.'));
  for (const initiative of entries) {
    const card = element('article', 'card');
    const head = element('div', 'cardhead');
    const summary = element('div', '');
    const badges = element('div', 'badges');
    badges.append(element('span', 'badge ' + (initiative.status || 'unavailable'), initiative.status || 'Status unavailable'));
    if (initiative.archived) badges.append(element('span', 'badge archived', 'Archived'));
    summary.append(badges, element('h2', '', initiative.id));
    if (initiative.task) summary.append(element('p', 'task', initiative.task));
    if (initiative.next) summary.append(element('p', 'next', 'Next · ' + initiative.next));
    if (initiative.result) summary.append(element('p', 'next', initiative.result));
    summary.append(element('div', 'path', initiative.directory));
    head.append(summary, copyButton(initiative.command, 'Copy cd command for initiative ' + initiative.id));
    const repos = element('div', 'repos');
    repos.append(element('div', 'sectionlabel', 'Repository checkouts · ' + initiative.repositories.length));
    if (!initiative.repositories.length) repos.append(element('p', 'muted', initiative.status ? 'No repositories associated.' : 'Repository information unavailable.'));
    for (const repo of initiative.repositories) {
      const row = element('div', 'repo');
      const info = element('div', '');
      const name = element('div', 'reponame', repo.name);
      name.append(element('span', 'branch', 'Recorded: ' + repo.branch));
      info.append(name, element('div', 'path', repo.directory));
      if (!repo.available) info.append(element('div', 'warning', 'Checkout unavailable'));
      else {
        info.append(element('div', repo.onRecordedBranch ? 'muted' : 'warning', 'Current: ' + (repo.actualBranch || 'detached HEAD') + ' · ' + repo.changes + ' changed files'));
      }
      row.append(info, copyButton(repo.command, 'Copy cd command for repository ' + repo.name));
      repos.append(row);
    }
    card.append(head, repos);
    if (initiative.diagnostics.length) {
      const diagnostics = element('ul', 'diagnostics');
      for (const item of initiative.diagnostics) diagnostics.append(element('li', '', item.message));
      card.append(diagnostics);
    }
    $('listing').append(card);
  }
}
async function refresh() {
  $('refresh').disabled = true;
  $('error').textContent = '';
  try {
    const response = await fetch('api');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load initiatives');
    data = result;
    $('workspace').textContent = data.workspace;
    $('updated').textContent = 'Updated ' + new Date(data.refreshedAt).toLocaleTimeString();
    $('error').textContent = data.diagnostics.map(d => d.message).join(' · ');
    render();
  } catch (error) {
    $('error').textContent = 'Refresh failed: ' + error.message + (data ? '. Showing the previous view.' : '. Try Refresh again.');
    if (!data) $('workspace').textContent = 'Workspace unavailable';
  } finally { $('refresh').disabled = false; }
}
$('refresh').addEventListener('click', refresh);
$('search').addEventListener('input', () => { if (data) render(); });
for (const button of document.querySelectorAll('[data-filter]')) button.addEventListener('click', () => {
  filter = button.dataset.filter;
  for (const other of document.querySelectorAll('[data-filter]')) other.setAttribute('aria-pressed', String(other === button));
  if (data) render();
});
refresh();
`;
