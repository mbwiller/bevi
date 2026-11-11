import { centralities, networkView } from './metrics.mjs';
import { overviewEdges, focusNetwork, zoomAt } from './explore.mjs';
const $ = id => document.getElementById(id);
const colors = { Bev:'#418e65',Category:'#d3a349',Brand:'#638ec0',Flavor:'#c67c96',Note:'#9a86be',User:'#78928c' };
const color = n => colors[n.labels[0]] ?? '#87968d';
let snapshot={nodes:[],edges:[]}, current=snapshot, visible=snapshot, metrics={}, selected=null, sort='degree';
let positions=new Map(), nodeTypes=new Set(), edgeTypes=new Set(), knownNodes=new Set(), knownEdges=new Set();
let scale=1, offset={x:0,y:0}, width=0,height=0, busy=false, loaded=false, signature='', animation=0;
let hovered=null, overview=[], byId=new Map(), visibleById=new Map();
const canvas=$('graph'),ctx=canvas.getContext('2d');
function text(tag,value){const el=document.createElement(tag);el.textContent=value;return el;}
function filters(container,types,enabled,known,isNode){
  for(const type of types)if(!known.has(type)){known.add(type);enabled.add(type);}
  container.replaceChildren();
  for(const type of [...types].sort()){
    const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=enabled.has(type);
    input.onchange=()=>{input.checked?enabled.add(type):enabled.delete(type);update(false);};label.append(input);
    if(isNode){const dot=text('span','');dot.className='dot';dot.style.background=colors[type]??'#87968d';label.append(dot);}
    label.append(document.createTextNode(type));container.append(label);
  }
}
function update(recalculate=true){
  current=networkView(snapshot,$('view').value,selected);
  if(recalculate)metrics=centralities(current.nodes,current.edges);
  const nodes=current.nodes.filter(n=>n.labels.some(t=>nodeTypes.has(t))),ids=new Set(nodes.map(n=>n.id));
  visible={nodes,edges:current.edges.filter(e=>edgeTypes.has(e.type)&&ids.has(e.source)&&ids.has(e.target))};
  visibleById=new Map(visible.nodes.map(n=>[n.id,n]));overview=overviewEdges(visible.edges);
  if(hovered&&!visibleById.has(hovered))hideHover();
  $('counts').textContent=`${nodes.length} / ${snapshot.nodes.length} nodes · ${visible.edges.length} / ${snapshot.edges.length} edges`;
  $('scope').textContent=`Complete ${$('view').selectedOptions[0].text.toLowerCase()} · unweighted, undirected`;
  $('empty').textContent=!snapshot.nodes.length?'The graph is empty. Waiting for Neo4j data.':!nodes.length?($('view').value==='neighborhood'&&!selected?'Search for a node to open its neighborhood.':'No nodes match these filters.'):'';
  rankings();details();draw();
}
function rankings(){
  $('ranking').replaceChildren();
  for(const n of [...visible.nodes].sort((a,b)=>(metrics[b.id]?.[sort]??0)-(metrics[a.id]?.[sort]??0))){
    const row=document.createElement('tr'),cell=document.createElement('td'),button=text('button',n.name);button.title=n.name;button.onclick=()=>select(n.id);cell.append(button);row.append(cell,text('td',metrics[n.id]?.degree??0),text('td',(metrics[n.id]?.pageRank??0).toFixed(4)));$('ranking').append(row);
  }
  $('degreeSort').textContent=`Degree${sort==='degree'?' ↓':''}`;$('rankSort').textContent=`Rank${sort==='pageRank'?' ↓':''}`;
}
function details(){
  const n=byId.get(selected),panel=$('details');panel.replaceChildren();
  if(!n){panel.textContent='Hover for a quick preview. Click to keep a node selected, inspect its strongest ties, and follow connections.';return;}
  panel.append(text('strong',n.name),text('p',n.labels.join(' · ')));
  const actions=text('div','');actions.className='detail-actions';
  const button=text('button','Explore neighborhood');button.onclick=()=>{$('view').value='neighborhood';update();fit();};
  const center=text('button','Center node');center.onclick=()=>centerNode(n.id);
  actions.append(button,center);panel.append(actions);
  const edges=snapshot.edges.filter(e=>e.source===n.id||e.target===n.id);
  const types=new Map();for(const e of edges)types.set(e.type,(types.get(e.type)??0)+1);
  panel.append(text('p',`${new Set(edges.map(e=>e.source===n.id?e.target:e.source)).size} neighbors · ${edges.length} relationships`));
  panel.append(text('p',[...types].map(([type,count])=>`${type.replaceAll('_',' ').toLowerCase()} ${count}`).join(' · ')));
  const similarity=edges.filter(e=>e.type==='SIMILAR_TO').sort((a,b)=>Number(b.properties.w??0)-Number(a.properties.w??0));
  if(similarity.length){panel.append(text('h2','Closest Bevs'));for(const e of similarity.slice(0,8))panel.append(connection(e,n.id));}
  const all=document.createElement('details');all.append(text('summary',`All ${edges.length} connections`));
  for(const e of [...edges].sort((a,b)=>a.type.localeCompare(b.type)))all.append(connection(e,n.id));panel.append(all);
  const properties=document.createElement('details');properties.append(text('summary','Properties & centrality'));const dl=document.createElement('dl');
  for(const [key,value]of Object.entries({...n.properties,...metrics[n.id]})){dl.append(text('dt',key),text('dd',typeof value==='object'?JSON.stringify(value):String(value)));}properties.append(dl);panel.append(properties);
}
function connection(e,id){
  const other=byId.get(e.source===id?e.target:e.source),button=text('button',`${e.type==='SIMILAR_TO'?'↔':e.source===id?'→':'←'} ${other?.name??'Unknown node'}`);button.className='connection';
  button.append(text('small',`${e.type.replaceAll('_',' ').toLowerCase()}${Number.isFinite(e.properties.w)?` · weight ${e.properties.w.toFixed(3)}`:''}`));
  button.title=JSON.stringify(e.properties);button.onclick=()=>{if(other)select(other.id);};return button;
}
function centerNode(id){const p=positions.get(id);if(p){offset={x:width/2-p.x*scale,y:height/2-p.y*scale};}draw();}
function select(id,center=true){stopLayout();selected=id;hideHover();update();if(center)centerNode(id);}
function clearSelection(){selected=null;hideHover();if($('view').value==='neighborhood')$('view').value='full';update();}
function radius(n){const value=metrics[n.id]?.[$('size').value]??0;return $('size').value==='uniform'?4:4+Math.min(13,Math.sqrt(value)*($('size').value==='pageRank'?65:1.2));}
function draw(){
  ctx.clearRect(0,0,width,height);ctx.save();ctx.translate(offset.x,offset.y);ctx.scale(scale,scale);
  const query=$('search').value.toLowerCase(),focus=hovered??selected;
  const {neighbors,edges:incident}=focusNetwork(visible.edges,focus);
  const mode=$('edgeMode').value,focusVisible=visibleById.has(focus);
  const edges=focusVisible?incident:mode==='focus'?[]:mode==='all'?visible.edges:overview;
  $('edgeSummary').textContent=`${edges.length.toLocaleString()} drawn / ${visible.edges.length.toLocaleString()} filtered edges${focusVisible?' · focused connections':mode==='smart'?' · top 3 similarity ties per node':''}`;
  $('zoomLevel').textContent=`${Math.round(scale*100)}%`;
  for(const e of edges){
    const a=positions.get(e.source),b=positions.get(e.target);if(!a||!b)continue;
    const weight=Number(e.properties.w??.4);
    ctx.strokeStyle=focusVisible?(e.type==='SIMILAR_TO'?'#3c8567b0':'#638aa5a0'):e.type==='SIMILAR_TO'?'#7c9d8925':'#7c91a330';
    ctx.lineWidth=(focusVisible?1+Math.max(0,Math.min(1,weight))*1.8:.65)/scale;
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    if(focusVisible&&e.type!=='SIMILAR_TO'){const angle=Math.atan2(b.y-a.y,b.x-a.x),target=visibleById.get(e.target),distance=(target?radius(target):5)+4/scale;const x=b.x-Math.cos(angle)*distance,y=b.y-Math.sin(angle)*distance;ctx.fillStyle='#638aa5';ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-Math.cos(angle-.45)*7/scale,y-Math.sin(angle-.45)*7/scale);ctx.lineTo(x-Math.cos(angle+.45)*7/scale,y-Math.sin(angle+.45)*7/scale);ctx.fill();}
  }
  const ordered=[...visible.nodes].sort((a,b)=>Number(neighbors.has(a.id))-Number(neighbors.has(b.id)));
  for(const n of ordered){const p=positions.get(n.id);if(!p)continue;const match=query&&n.name.toLowerCase().includes(query);
    ctx.globalAlpha=(focusVisible && !neighbors.has(n.id)) ? .12 : (query && !match && n.id !== focus) ? .25 : 1;
    ctx.beginPath();ctx.arc(p.x,p.y,radius(n),0,Math.PI*2);ctx.fillStyle=color(n);ctx.fill();
    if(n.id===focus||n.id===selected||match){ctx.strokeStyle='#173f2c';ctx.lineWidth=2.5/scale;ctx.stroke();}ctx.globalAlpha=1;
  }
  ctx.restore();
  // Screen-space label collision avoidance, with the focused node first.
  const candidates=visible.nodes.filter(n=>n.id===focus||n.id===selected||(query&&n.name.toLowerCase().includes(query))||(focusVisible?neighbors.has(n.id):scale>1.4));
  candidates.sort((a,b)=>Number(b.id===focus)-Number(a.id===focus)||(metrics[b.id]?.degree??0)-(metrics[a.id]?.degree??0));
  const boxes=[];ctx.font='11px system-ui';
  for(const n of candidates){const p=positions.get(n.id);if(!p)continue;const label=n.name.length>38?n.name.slice(0,36)+'…':n.name,x=p.x*scale+offset.x+radius(n)*scale+5,y=p.y*scale+offset.y,box={x,y:y-10,w:ctx.measureText(label).width+8,h:18};
    if(x<0||x+box.w>width||y<20||y>height-20||boxes.some(b=>box.x<b.x+b.w&&box.x+box.w>b.x&&box.y<b.y+b.h&&box.y+box.h>b.y))continue;
    boxes.push(box);ctx.fillStyle='#fcfdfbf0';ctx.fillRect(box.x-3,box.y,box.w,box.h);ctx.fillStyle=n.id===focus?'#123f28':'#476152';ctx.fillText(label,x,y+3);if(boxes.length>=50)break;
  }
}
function fit(){if(!visible.nodes.length)return;const ps=visible.nodes.map(n=>positions.get(n.id)).filter(Boolean);const minX=Math.min(...ps.map(p=>p.x))-30,maxX=Math.max(...ps.map(p=>p.x))+30,minY=Math.min(...ps.map(p=>p.y))-30,maxY=Math.max(...ps.map(p=>p.y))+30;scale=Math.min(width/(maxX-minX),height/(maxY-minY),2)*.88;offset={x:width/2-(minX+maxX)/2*scale,y:height/2-(minY+maxY)/2*scale};draw();}
// Bounded force layout with spatial buckets; no quadratic all-pairs repulsion.
function layout(){
  cancelAnimationFrame(animation);let tick=0;
  function step(){const grid=new Map(),nodes=snapshot.nodes;
    for(const n of nodes){const p=positions.get(n.id),key=`${Math.floor(p.x/70)},${Math.floor(p.y/70)}`;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(p);p.fx=-p.x*.001;p.fy=-p.y*.001;}
    for(const n of nodes){const p=positions.get(n.id),gx=Math.floor(p.x/70),gy=Math.floor(p.y/70);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const q of grid.get(`${gx+dx},${gy+dy}`)??[]){if(p===q)continue;const x=p.x-q.x,y=p.y-q.y,d=x*x+y*y+.1,f=Math.min(3,90/d);p.fx+=x*f;p.fy+=y*f;}}
    for(const e of snapshot.edges){const p=positions.get(e.source),q=positions.get(e.target);if(!p||!q)continue;const dx=q.x-p.x,dy=q.y-p.y,d=Math.hypot(dx,dy)||1,f=(d-(e.type==='SIMILAR_TO'?120:85))*(e.type === 'SIMILAR_TO' ? .0007 : .003);p.fx+=dx/d*f;p.fy+=dy/d*f;q.fx-=dx/d*f;q.fy-=dy/d*f;}
    for(const n of nodes){const p=positions.get(n.id);p.x+=Math.max(-6,Math.min(6,p.fx));p.y+=Math.max(-6,Math.min(6,p.fy));}draw();if(++tick<180)animation=requestAnimationFrame(step);else if(!loaded){loaded=true;fit();}
  }step();
}
async function refresh(){if(busy)return;busy=true;$('refresh').disabled=true;$('status').textContent='Reading Neo4j…';try{
  const response=await fetch('/api/graph',{signal:AbortSignal.timeout(30000)}),data=await response.json();if(!response.ok)throw new Error(data.error);
  const nextSignature=JSON.stringify([data.nodes,data.edges]);snapshot=data;byId=new Map(data.nodes.map(n=>[n.id,n]));
  if(selected&&!snapshot.nodes.some(n=>n.id===selected))selected=null;
  filters($('nodeFilters'),new Set(data.nodes.flatMap(n=>n.labels)),nodeTypes,knownNodes,true);filters($('edgeFilters'),new Set(data.edges.map(e=>e.type)),edgeTypes,knownEdges,false);
  if(nextSignature!==signature){const first=!signature;signature=nextSignature;const ids=new Set(data.nodes.map(n=>n.id));for(const id of positions.keys())if(!ids.has(id))positions.delete(id);data.nodes.forEach((n,i)=>{if(!positions.has(n.id)){const angle=i*2.39996,r=22*Math.sqrt(i+1);positions.set(n.id,{x:Math.cos(angle)*r,y:Math.sin(angle)*r});}});update();if(first){fit();layout();}}
  $('fetched').textContent=`Fetched ${new Date(data.fetchedAt).toLocaleTimeString()}`;const sync=data.meta[0]?.properties.lastSyncAt;$('synced').textContent=`Neo4j sync: ${sync?new Date(sync).toLocaleString():'not recorded'}`;$('status').textContent='Connected · read only';$('status').className='';
}catch(error){$('status').textContent=`${signature?'Stale snapshot · ':''}${error.message}`;$('status').className='error';if(!signature)$('empty').textContent='Unable to load the graph. See connection status above.';}finally{busy=false;$('refresh').disabled=false;}}
$('view').onchange=()=>{stopLayout();hideHover();update();fit();};$('size').onchange=draw;$('fit').onclick=()=>{stopLayout();fit();};$('refresh').onclick=refresh;
$('degreeSort').onclick=()=>{sort='degree';rankings();};$('rankSort').onclick=()=>{sort='pageRank';rankings();};
$('search').oninput=()=>{const q=$('search').value.trim().toLowerCase();$('results').replaceChildren();if(q)for(const n of snapshot.nodes.filter(n=>n.name.toLowerCase().includes(q)).slice(0,8)){const button=text('button',n.name);button.onclick=()=>select(n.id);$('results').append(button);}draw();};
function zoom(factor,x=width/2,y=height/2){({scale,offset}=zoomAt(scale,offset,factor,x,y));hideHover();draw();}
$('zoomIn').onclick=()=>{stopLayout();zoom(1.3);};$('zoomOut').onclick=()=>{stopLayout();zoom(1/1.3);};
function stopLayout(){cancelAnimationFrame(animation);loaded=true;}
function hitNode(x,y){
  let best=null,distance=Infinity;
  for(const n of visible.nodes){const p=positions.get(n.id);if(!p)continue;const d=Math.hypot(p.x*scale+offset.x-x,p.y*scale+offset.y-y);if(d<=Math.max(7,radius(n)*scale+4)&&d<distance){best=n;distance=d;}}
  return best;
}
function point(event){const rect=canvas.getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top};}
function hideHover(){hovered=null;$('tooltip').hidden=true;}
function hoverAt(x,y){
  const n=hitNode(x,y);hovered=n?.id??null;canvas.style.cursor=n?'pointer':'grab';const tip=$('tooltip');tip.hidden=!n;
  if(n){const {edges,neighbors}=focusNetwork(visible.edges,n.id);tip.replaceChildren(text('strong',n.name),text('small',n.labels.join(' · ')),text('p',`${neighbors.size-1} visible neighbors · ${edges.length} relationships`),text('p',`Degree ${metrics[n.id]?.degree??0} · PageRank ${(metrics[n.id]?.pageRank??0).toFixed(4)}`));
    const strongest=edges.filter(e=>e.type==='SIMILAR_TO').sort((a,b)=>Number(b.properties.w??0)-Number(a.properties.w??0))[0];
    if(strongest){const other=byId.get(strongest.source===n.id?strongest.target:strongest.source);tip.append(text('p',`Closest: ${other?.name??'—'} · ${Number(strongest.properties.w??0).toFixed(3)}`));}
    tip.append(text('small','Click to keep focus · Drag to reposition'));
    tip.style.left=`${Math.max(8,Math.min(x+18,width-tip.offsetWidth-10))}px`;tip.style.top=`${Math.max(8,Math.min(y+18,height-tip.offsetHeight-10))}px`;
  }draw();
}
canvas.addEventListener('wheel',e=>{e.preventDefault();stopLayout();const p=point(e),delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?height:1);zoom(Math.exp(-Math.max(-300,Math.min(300,delta))*(e.ctrlKey ? .008 : .002)),p.x,p.y);},{passive:false});
const pointers=new Map();let drag=null,pinch=null;
function pinchState(){const [a,b]=[...pointers.values()];return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,d:Math.hypot(a.x-b.x,a.y-b.y)};}
canvas.onpointerdown=e=>{if(e.button!==0)return;stopLayout();canvas.focus({preventScroll:true});const p=point(e);pointers.set(e.pointerId,p);hideHover();canvas.setPointerCapture(e.pointerId);
  if(pointers.size===2){pinch=pinchState();drag=null;}else if(pointers.size===1){const n=hitNode(p.x,p.y);drag={...p,startX:p.x,startY:p.y,node:n?.id,moved:false};}canvas.style.cursor='grabbing';};
canvas.onpointermove=e=>{const p=point(e);
  if(!pointers.has(e.pointerId)){if(e.pointerType!=='touch')hoverAt(p.x,p.y);return;}
  pointers.set(e.pointerId,p);
  if(pointers.size===2&&pinch){const next=pinchState();zoom(next.d/Math.max(1,pinch.d),pinch.x,pinch.y);offset.x+=next.x-pinch.x;offset.y+=next.y-pinch.y;pinch=next;draw();return;}
  if(!drag)return;const dx=p.x-drag.x,dy=p.y-drag.y;
  if(Math.hypot(p.x-drag.startX,p.y-drag.startY)>4)drag.moved=true;
  if(drag.moved){if(drag.node){const pos=positions.get(drag.node);if(pos){pos.x+=dx/scale;pos.y+=dy/scale;}}else{offset.x+=dx;offset.y+=dy;}}drag.x=p.x;drag.y=p.y;draw();};
function endPointer(e,cancelled=false){
  if(!pointers.has(e.pointerId))return;const p=point(e),wasPinch=!!pinch;pointers.delete(e.pointerId);
  if(!cancelled&&!wasPinch&&drag&&!drag.moved){const n=hitNode(p.x,p.y);n?select(n.id,false):clearSelection();}
  pinch=null;drag=null;
  if(pointers.size===1){const remaining=[...pointers.values()][0];drag={...remaining,startX:remaining.x,startY:remaining.y,moved:true};}
  canvas.style.cursor='grab';draw();
}
canvas.onpointerup=e=>endPointer(e);canvas.onpointercancel=e=>endPointer(e,true);
canvas.onpointerleave=()=>{if(!pointers.size){hideHover();draw();}};
canvas.ondblclick=e=>{stopLayout();const p=point(e);zoom(1.7,p.x,p.y);};
canvas.onkeydown=e=>{
  if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','0','Escape'].includes(e.key)){e.preventDefault();stopLayout();hideHover();
    if(e.key==='Escape')clearSelection();else if(e.key==='0')fit();else if(e.key==='+'||e.key==='=')zoom(1.25);else if(e.key==='-')zoom(.8);else{offset.x+=e.key==='ArrowLeft'?60:e.key==='ArrowRight'?-60:0;offset.y+=e.key==='ArrowUp'?60:e.key==='ArrowDown'?-60:0;draw();}}
};
$('clear').onclick=clearSelection;$('edgeMode').onchange=draw;
$('relayout').onclick=()=>{hideHover();loaded=false;layout();};
new ResizeObserver(()=>{const rect=canvas.getBoundingClientRect(),dpr=devicePixelRatio||1;width=rect.width;height=rect.height;canvas.width=width*dpr;canvas.height=height*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);draw();}).observe(canvas);
refresh();setInterval(()=>{if(!document.hidden)refresh();},30000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
