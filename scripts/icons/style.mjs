// Frozen pilot primitives. Product geometry and colors belong in family recipes.
export const STYLE_VERSION = 'bevi-dimensional-v1';
export const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export const ref = name => `url(#__ID__${name})`;
export const shadow = (rx = 58) => `<ellipse cx="100" cy="239" rx="${rx}" ry="11" fill="${ref('shadow')}"/>`;
export const text = (x,y,label,size=10,fill='#fff',attrs='') => `<text x="${x}" y="${y}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${size}" fill="${fill}" ${attrs}>${esc(label)}</text>`;
export function wrap(slug,title,body,extraDefs='') {
  const id = `bev-${slug.replace(/[^a-z0-9-]/gi,'')}-`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 260" role="img" aria-labelledby="${id}title"><title id="${id}title">${esc(title)}</title><defs>
<linearGradient id="__ID__metal"><stop stop-color="#aeb4b3"/><stop offset=".2" stop-color="#f8f8f1"/><stop offset=".48" stop-color="#d3d8d5"/><stop offset=".8" stop-color="#9ba5a1"/><stop offset="1" stop-color="#dce2dd"/></linearGradient>
<linearGradient id="__ID__glass"><stop stop-color="#fff" stop-opacity=".65"/><stop offset=".18" stop-color="#fff" stop-opacity=".12"/><stop offset=".65" stop-color="#fff" stop-opacity=".02"/><stop offset="1" stop-color="#75867c" stop-opacity=".35"/></linearGradient>
<linearGradient id="__ID__shade"><stop stop-color="#000" stop-opacity=".12"/><stop offset=".2" stop-color="#fff" stop-opacity=".16"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset=".86" stop-color="#000" stop-opacity=".14"/><stop offset="1" stop-color="#fff" stop-opacity=".09"/></linearGradient>
<radialGradient id="__ID__shadow"><stop stop-color="#3c372d" stop-opacity=".18"/><stop offset="1" stop-color="#3c372d" stop-opacity="0"/></radialGradient>${extraDefs}</defs>${body}</svg>`.replaceAll('__ID__', id);
}
