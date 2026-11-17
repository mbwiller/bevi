import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSnapshot, SNAPSHOT_QUERY } from './dashboard-core.ts';
// @ts-expect-error Browser-native module is exercised directly by Node.
import { centralities, networkView } from './dashboard/metrics.mjs';
test('snapshot includes isolated nodes and parallel edges, separates Meta', async () => {
  const nodes = [
    { id:'a',labels:['Bev'],keys:['name'],values:['Tea'] },
    { id:'b',labels:['User'],keys:[],values:[] },
    { id:'c',labels:['Bev'],keys:[],values:[] },
    { id:'m',labels:['Meta'],keys:['lastSyncAt'],values:['today'] },
  ];
  const edges = ['1','2'].map(id=>({id,source:'a',target:'b',type:'RANKED',properties:{score:1}}));
  const snapshot = await readSnapshot({query: async query=>{assert.equal(query,SNAPSHOT_QUERY);return [{nodes,edges}];}});
  assert.equal(snapshot.nodes.length,3); assert.equal(snapshot.edges.length,2);assert.equal(snapshot.meta.length,1);
  assert.equal(snapshot.nodes[1].name,'User b');
  assert.match(SNAPSHOT_QUERY,/k <> 'embedding' AND k <> 'pseudonym'/);
  assert.doesNotMatch(SNAPSHOT_QUERY,/\b(CREATE|MERGE|DELETE|SET)\b/);
  const empty=await readSnapshot({query:async()=>[{nodes:[],edges:[]}]});assert.equal(empty.nodes.length,0);
});
test('centralities handle isolates, parallel edges and dangling PageRank',()=>{
  const nodes=['a','b','c','d'].map(id=>({id}));
  const metrics=centralities(nodes,[{source:'a',target:'b'},{source:'a',target:'b'},{source:'a',target:'c'},{source:'a',target:'a'}]);
  assert.equal(metrics.a.degree,2);assert.equal(metrics.d.degree,0);assert.ok(metrics.a.pageRank>metrics.b.pageRank);
  const sum=Object.values(metrics).reduce((s:number,m:any)=>s+m.pageRank,0);assert.ok(Math.abs(Number(sum)-1)<1e-9);
  assert.deepEqual(centralities([],[]),{});
});
test('views retain Bev isolates and select induced neighborhoods',()=>{
  const snapshot={nodes:[{id:'a',labels:['Bev']},{id:'b',labels:['Bev']},{id:'c',labels:['Brand']}],edges:[{source:'a',target:'c',type:'BY_BRAND'}]};
  assert.equal(networkView(snapshot,'similarity').nodes.length,2);
  assert.equal(networkView(snapshot,'similarity').edges.length,0);
  assert.equal(networkView(snapshot,'neighborhood','a').nodes.length,2);
  assert.equal(networkView(snapshot,'neighborhood',null).nodes.length,0);
});
test('snapshot failure is propagated, never represented as an empty successful graph',async()=>{
  await assert.rejects(readSnapshot({query:async()=>{throw new Error('offline');}}),/offline/);
  await assert.rejects(readSnapshot({query:async()=>[]}),/Invalid graph snapshot/);
});

test('successive snapshots reflect property edits and deleted nodes and edges',async()=>{
  let version=0;
  const client={query:async()=>[{nodes:version===0?[{id:'a',labels:['Bev'],keys:['name'],values:['Old']},{id:'b',labels:['Bev'],keys:[],values:[]}]:[{id:'a',labels:['Bev'],keys:['name'],values:['New']}],edges:version===0?[{id:'e',source:'a',target:'b',type:'SIMILAR_TO',properties:{w:.5}}]:[]}]};
  const before=await readSnapshot(client);version++;const after=await readSnapshot(client);
  assert.equal(before.nodes.length,2);assert.equal(after.nodes.length,1);assert.equal(after.nodes[0].name,'New');assert.equal(after.edges.length,0);
});

// @ts-expect-error Browser-native module is exercised directly by Node.
import { overviewEdges, focusNetwork, zoomAt } from './dashboard/explore.mjs';
test('overview keeps strongest ties for each endpoint and all structural edges',()=>{
  const edges=[
    {id:'ab',source:'a',target:'b',type:'SIMILAR_TO',properties:{w:.9}},
    {id:'ac',source:'a',target:'c',type:'SIMILAR_TO',properties:{w:.8}},
    {id:'bc',source:'b',target:'c',type:'SIMILAR_TO',properties:{w:.1}},
    {id:'cat',source:'a',target:'category',type:'IN_CATEGORY',properties:{}},
  ];
  assert.deepEqual(overviewEdges(edges,1).map((e:any)=>e.id),['ab','ac','cat']);
  // Focus uses the complete filtered edges, including ties omitted from overview.
  const focus=focusNetwork(edges,'b');assert.deepEqual(focus.edges.map((e:any)=>e.id),['ab','bc']);
  assert.deepEqual([...focus.neighbors].sort(),['a','b','c']);
  assert.equal(focusNetwork(edges,null).edges.length,0);
});
test('zoom keeps the world point under the cursor stationary and clamps extremes',()=>{
  const offset={x:20,y:40},scale=2,x=100,y=160;
  const next=zoomAt(scale,offset,1.5,x,y);
  assert.equal((x-next.offset.x)/next.scale,(x-offset.x)/scale);
  assert.equal((y-next.offset.y)/next.scale,(y-offset.y)/scale);
  assert.equal(zoomAt(1,offset,100,x,y).scale,12);
  assert.equal(zoomAt(1,offset,.0001,x,y).scale,.03);
});
