const el = (id) => document.getElementById(id);
const net = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
const TRUSTED_ENDPOINTS = new Set([
  'https://www.google.com/favicon.ico',
  'https://www.cloudflare.com/favicon.ico',
  'https://www.microsoft.com/favicon.ico'
]);
const SAME_ORIGIN_ENDPOINT = 'same-origin';
let samples = [], timer = null, activeProbeController = null, runVersion = 0;
let running = false, sent = 0, failed = 0, consecutiveLoss = 0, range = 60, lastPoints = [];

function addEvent(message, type = '') {
  const item = document.createElement('div');
  const time = document.createElement('b');
  item.className = `event-item ${type}`;
  time.textContent = new Date().toLocaleTimeString();
  item.append(time, document.createTextNode(message));
  const log = el('eventLog');
  log.querySelector('.no-events')?.remove();
  log.prepend(item);
  while (log.children.length > 25) log.lastElementChild.remove();
}
const average = (list) => list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
function diagnosticText() {
  const good = samples.filter(s => s.ok).map(s => s.value);
  const avg = average(good), jitter = average(good.slice(1).map((v, i) => Math.abs(v - good[i])));
  const loss = sent ? failed / sent * 100 : 0;
  const selected = el('endpoint').value;
  const endpointLabel = selected === SAME_ORIGIN_ENDPOINT ? new URL('probe.svg', window.location.href).href : selected || '-';
  return ['Network Diagnostic Summary', `Time: ${new Date().toLocaleString()}`, `Grade: ${el('gradeValue').textContent} (${el('gradeLabel').textContent})`, `Current latency: ${el('currentLatency').textContent} ms`, `Average latency: ${good.length ? avg.toFixed(1) : '-'} ms`, `Jitter: ${good.length > 1 ? jitter.toFixed(1) : '-'} ms`, `Loss: ${sent ? loss.toFixed(1) : '-'}% (${failed}/${sent} probes)`, `Consecutive loss: ${consecutiveLoss}`, `Endpoint: ${endpointLabel}`, `Browser network: ${el('connectionType').textContent}`].join('\n');
}
function updateSummary() { el('diagnosticSummary').textContent = diagnosticText(); }
function updateNetworkInfo() {
  el('connectionType').textContent = net?.effectiveType || (navigator.onLine ? 'Connected' : 'Offline');
  el('downlink').textContent = net?.downlink ? `${net.downlink.toFixed(1)} Mbps` : 'Not available';
  updateClientMeta();
}
function browserLabel() {
  const ua = navigator.userAgent;
  const browser = ua.includes('Edg/') ? 'Edge' : ua.includes('Firefox/') ? 'Firefox' : ua.includes('Chrome/') ? 'Chrome' : 'Browser';
  const platform = navigator.userAgentData?.platform || navigator.platform || 'Unknown OS';
  return `${platform} · ${browser}`;
}
function updateClientMeta() {
  el('clientBrowser').textContent = browserLabel();
  el('clientClock').textContent = new Date().toLocaleString([], { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' });
  el('clientTimezone').textContent = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time';
  const type = net?.effectiveType || (navigator.onLine ? 'Online' : 'Offline');
  const downlink = net?.downlink ? ` · ${net.downlink.toFixed(1)} Mbps` : '';
  el('clientNetwork').textContent = `${type}${downlink}`;
}
function updateStartAvailability() {
  const enabled = (el('endpoint').value === SAME_ORIGIN_ENDPOINT || TRUSTED_ENDPOINTS.has(el('endpoint').value)) && !running;
  el('startButton').disabled = !enabled;
  el('startButton').title = enabled ? 'Start network monitoring' : 'Select a trusted test endpoint first';
}
function loadImageProbe(url, signal) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const onAbort = () => { image.src = ''; cleanup(); reject(new DOMException('Probe aborted', 'AbortError')); };
    image.onload = () => { cleanup(); resolve(); };
    image.onerror = () => { cleanup(); reject(new Error('Probe image failed to load')); };
    signal?.addEventListener('abort', onAbort, { once:true });
    image.src = url;
  });
}
function updateStats() {
  const good = samples.filter(s => s.ok).map(s => s.value);
  const current = good.at(-1), avg = average(good);
  const jitter = average(good.slice(1).map((v, i) => Math.abs(v - good[i])));
  const loss = sent ? failed / sent * 100 : 0;
  el('currentLatency').textContent = current == null ? '-' : current.toFixed(0);
  el('averageLatency').textContent = good.length ? avg.toFixed(0) : '-';
  el('jitter').textContent = good.length > 1 ? jitter.toFixed(1) : '-';
  el('loss').textContent = sent ? loss.toFixed(1) : '-';
  el('lossFoot').textContent = `${failed} / ${sent} failed probes`;
  el('consecutiveLoss').textContent = `${consecutiveLoss} times`;
  el('latencyFoot').textContent = current == null ? 'No samples yet' : current > 150 ? 'High latency warning' : 'Current response is normal';
  let grade = '-', label = 'Waiting for samples';
  if (!navigator.onLine || consecutiveLoss >= 3) { grade = 'D'; label = 'Offline or repeated loss'; }
  else if (good.length >= 4 && (loss > 5 || avg > 180)) { grade = 'C'; label = 'Poor connection'; }
  else if (good.length >= 4 && (loss > 1 || avg > 90 || jitter > 30)) { grade = 'B'; label = 'Connection needs attention'; }
  else if (good.length >= 4) { grade = 'A'; label = 'Stable connection'; }
  el('gradeValue').textContent = grade;
  el('gradeLabel').textContent = label;
  el('gradeBox').className = grade === '-' ? 'grade' : `grade grade-${grade.toLowerCase()}`;
  updateSummary();
  draw();
}
function draw() {
  const canvas = el('latencyChart'), box = canvas.parentElement, ctx = canvas.getContext('2d'), rect = box.getBoundingClientRect();
  const width = Math.max(300, Math.floor(rect.width - 20)), height = Math.max(240, Math.floor(rect.height - 20)), scale = devicePixelRatio || 1;
  canvas.width = width * scale; canvas.height = height * scale; ctx.setTransform(scale, 0, 0, scale, 0, 0); ctx.clearRect(0, 0, width, height);
  const data = samples.slice(-range); el('emptyChart').classList.toggle('hidden', data.length > 0); lastPoints = []; if (!data.length) return;
  const valid = data.filter(s => s.ok).map(s => s.value), max = Math.max(200, ...valid.map(v => v + 20)), avg = average(valid), pad = { left:42,right:10,top:12,bottom:28 }, gw=width-pad.left-pad.right, gh=height-pad.top-pad.bottom;
  ctx.font='10px ui-monospace,monospace'; ctx.fillStyle='#91a0a2'; ctx.strokeStyle='#334146'; ctx.lineWidth=1;
  [0,.25,.5,.75,1].forEach(r => { const y=pad.top+gh*(1-r); ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(width-pad.right,y);ctx.stroke();ctx.fillText(`${Math.round(max*r)} ms`,3,y+3); });
  const thresholdY = pad.top+gh*(1-150/max); if (thresholdY > pad.top && thresholdY < pad.top+gh) { ctx.setLineDash([5,4]);ctx.strokeStyle='#f4aa42';ctx.beginPath();ctx.moveTo(pad.left,thresholdY);ctx.lineTo(width-pad.right,thresholdY);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#f4aa42';ctx.fillText('WARNING 150 ms',pad.left+5,thresholdY-5); }
  if (valid.length > 1) { const avgY=pad.top+gh*(1-avg/max);ctx.setLineDash([2,4]);ctx.strokeStyle='#5ed1d2';ctx.beginPath();ctx.moveTo(pad.left,avgY);ctx.lineTo(width-pad.right,avgY);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#5ed1d2';ctx.fillText(`AVG ${avg.toFixed(0)} ms`,width-pad.right-77,avgY-5); }
  const points=data.map((s,i)=>({x:pad.left+(data.length===1?gw:i*gw/(data.length-1)),y:s.ok?pad.top+gh*(1-s.value/max):pad.top+gh-6,ok:s.ok,value:s.value,time:s.time})); lastPoints=points;
  const groups=[]; let group=[];
  points.forEach(point=>{ if(point.ok) group.push(point); else if(group.length) { groups.push(group); group=[]; } });
  if(group.length) groups.push(group);
  const fill=ctx.createLinearGradient(0,pad.top,0,pad.top+gh);fill.addColorStop(0,'rgba(79,169,207,.25)');fill.addColorStop(1,'rgba(79,169,207,0)');
  groups.filter(segment=>segment.length>1).forEach(segment=>{ctx.beginPath();segment.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.lineTo(segment.at(-1).x,pad.top+gh);ctx.lineTo(segment[0].x,pad.top+gh);ctx.closePath();ctx.fillStyle=fill;ctx.fill();ctx.beginPath();segment.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.strokeStyle='#5ed1d2';ctx.lineWidth=2;ctx.stroke();});
  points.forEach(p=>{if(!p.ok){ctx.strokeStyle='#ef6565';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(p.x-4,p.y-4);ctx.lineTo(p.x+4,p.y+4);ctx.moveTo(p.x+4,p.y-4);ctx.lineTo(p.x-4,p.y+4);ctx.stroke();return;}ctx.beginPath();ctx.arc(p.x,p.y,3,0,Math.PI*2);ctx.fillStyle=p.value>150?'#f4aa42':'#5ed1d2';ctx.fill();});
  ctx.fillStyle='#91a0a2';ctx.fillText(data[0].time?new Date(data[0].time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}):'Oldest',pad.left,height-7);ctx.fillText(data.at(-1).time?new Date(data.at(-1).time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}):'Now',width-pad.right-58,height-7);
}
async function probe(version) {
  if (!running || version !== runVersion) return;
  const started = performance.now(), controller = new AbortController(), timeout = setTimeout(() => controller.abort(), Number(el('timeout').value || 5) * 1000);
  activeProbeController = controller;
  let cancelled = false;
  try {
    const selectedEndpoint = el('endpoint').value;
    const endpoint = selectedEndpoint === SAME_ORIGIN_ENDPOINT ? new URL('probe.svg', window.location.href) : new URL(selectedEndpoint);
    if (selectedEndpoint !== SAME_ORIGIN_ENDPOINT && (endpoint.protocol !== 'https:' || !TRUSTED_ENDPOINTS.has(endpoint.href))) throw new Error('Untrusted endpoint rejected');
    endpoint.searchParams.set('_netchronos', Date.now());
    await loadImageProbe(endpoint.href, controller.signal);
    const value = performance.now() - started; samples.push({ok:true,value,time:Date.now()}); sent++; consecutiveLoss=0;
    if (value > 150) addEvent(`High latency: ${value.toFixed(0)} ms`, 'warn');
  } catch (error) {
    if (error.name === 'AbortError' && (!running || version !== runVersion)) {
      cancelled = true;
    } else {
      samples.push({ok:false,value:null,time:Date.now()}); sent++; failed++; consecutiveLoss++;
      addEvent(`Loss #${consecutiveLoss}: ${error.name === 'AbortError' ? 'Timeout' : error.message}`, 'warn');
    }
  } finally {
    clearTimeout(timeout);
    if (activeProbeController === controller) activeProbeController = null;
    if (!cancelled) { samples = samples.slice(-240); updateStats(); }
    if (running && version === runVersion) timer = setTimeout(() => probe(version), Math.max(1000, Number(el('interval').value || 3) * 1000));
  }
}
function start() { if (running) return; if (el('endpoint').value !== SAME_ORIGIN_ENDPOINT && !TRUSTED_ENDPOINTS.has(el('endpoint').value)) { addEvent('Select a trusted HTTPS endpoint before starting.', 'warn'); return; } running=true; runVersion++; updateStartAvailability(); el('pauseButton').disabled=false; el('statusText').textContent='Monitoring'; el('statusDot').className='live'; addEvent('Network monitoring started'); probe(runVersion); }
function pause() { const wasRunning=running; running=false; runVersion++; clearTimeout(timer); activeProbeController?.abort(); activeProbeController=null; updateStartAvailability(); el('pauseButton').disabled=true; el('statusText').textContent='Paused'; el('statusDot').className=''; if(wasRunning) addEvent('Network monitoring paused'); }
el('startButton').onclick=start; el('pauseButton').onclick=pause;
el('clearButton').onclick=()=>{ const empty=document.createElement('p'); empty.className='no-events'; empty.textContent='No events yet'; el('eventLog').replaceChildren(empty); };
el('copySummaryButton').onclick=async()=>{ const report = diagnosticText(); try { await navigator.clipboard.writeText(report); el('copyFeedback').textContent='Summary copied to clipboard.'; } catch { const area=document.createElement('textarea'); area.value=report; document.body.append(area); area.select(); document.execCommand('copy'); area.remove(); el('copyFeedback').textContent='Summary copied to clipboard.'; } setTimeout(()=>{el('copyFeedback').textContent='';},2500); };
el('resetButton').onclick=()=>{ pause(); samples=[]; sent=failed=consecutiveLoss=0; updateStats(); el('endpoint').selectedIndex=0; el('interval').value=3; el('timeout').value=5; updateStartAvailability(); };
document.querySelectorAll('[data-range]').forEach(button => button.onclick=()=>{ document.querySelector('[data-range].active').classList.remove('active'); button.classList.add('active'); range=Number(button.dataset.range); draw(); });
el('latencyChart').addEventListener('mousemove', (event) => { const canvas=el('latencyChart'), rect=canvas.getBoundingClientRect(), x=event.clientX-rect.left, point=lastPoints.reduce((nearest,p)=>!nearest||Math.abs(p.x-x)<Math.abs(nearest.x-x)?p:nearest,null), tip=el('chartTooltip'); if(!point){tip.style.display='none';return;} tip.textContent=`${point.ok ? 'LATENCY' : 'LOSS / TIMEOUT'}\n${point.ok ? `${point.value.toFixed(1)} ms` : 'No response'}\n${point.time ? new Date(point.time).toLocaleTimeString() : ''}`; tip.style.display='block'; tip.style.left=`${Math.min(rect.width-145,Math.max(8,point.x+12))}px`; tip.style.top=`${Math.max(8,point.y-55)}px`; });
el('latencyChart').addEventListener('mouseleave', () => { el('chartTooltip').style.display='none'; });
el('helpButton').onclick=()=>{ const panel=el('helpPanel'), open=panel.hasAttribute('hidden'); panel.toggleAttribute('hidden', !open); el('helpButton').setAttribute('aria-expanded', String(open)); };
el('endpoint').addEventListener('change', updateStartAvailability); window.addEventListener('resize',draw); window.addEventListener('online',()=>{updateNetworkInfo();addEvent('Browser is online');}); window.addEventListener('offline',()=>{updateNetworkInfo();addEvent('Browser is offline','warn');}); net?.addEventListener?.('change',updateNetworkInfo); updateNetworkInfo(); updateStartAvailability(); updateStats(); setInterval(updateClientMeta, 1000);
