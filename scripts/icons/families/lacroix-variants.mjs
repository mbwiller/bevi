import {wrap,shadow,ref,text} from '../style.mjs';

// Frozen can and hand-script geometry from sparkling-starters.mjs.
// New product recipes below retain separately inspected flavor artwork.
const can=(slug,title,label,{t=41,l=55,color='#f4f2e9',gold=false}={})=>{
 const r=200-l,rx=100-l-6,shape=`M${l+6} ${t}Q100 ${t-9} ${r-6} ${t}L${r} ${t+17}V220Q${r} 233 100 233T${l} 220V${t+17}Z`;
 return wrap(slug,title,`${shadow(55)}<path d="${shape}" fill="${color}"/><g clip-path="${ref('canclip')}">${label}<path d="${shape}" fill="${ref('shade')}"/><path d="M${l+9} ${t+21}V214" stroke="#fff" stroke-opacity=".20" stroke-width="2.8"/></g><ellipse cx="100" cy="${t}" rx="${rx}" ry="8" fill="${ref('metal')}" stroke="${gold?'#ba9342':'#9ca7a4'}" stroke-width="1.2"/><ellipse cx="100" cy="${t}" rx="${rx-5}" ry="5.4" fill="none" stroke="${gold?'#c2a04e':'#8d9892'}" stroke-width=".8"/><ellipse cx="104" cy="${t+1}" rx="8" ry="3.5" fill="#657169"/><path d="M93 ${t-2}h10q6 0 5 4t-8 3h-6q-6-1-1-7" fill="none" stroke="${gold?'#ead590':'#e6e8de'}" stroke-width="2.4"/><path d="M${l+3} 226q${r-l-6>>1} 12 ${r-l-6} 0" fill="none" stroke="${ref('metal')}" stroke-width="4"/><path d="M${l+6} 230q${r-l-12>>1} 7 ${r-l-12} 0" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1"/>`,`<clipPath id="__ID__canclip"><path d="${shape}"/></clipPath>`);
};

// Loose hand-drawn lettering is retained as paths instead of relying on a script font.
const lacroixLogo=`<g fill="none" stroke="#12285d" stroke-linecap="round" stroke-linejoin="round"><path d="M115 86c-5 15-13 41-17 53-3 8-10 8-12 3-3-8 11-8 20-2 7 4 13 11 20 11" stroke-width="4.7"/><path d="M126 111c-14 0-18 20-11 18l12-13-4 12q0 3 7 1" stroke-width="4.3"/><path d="M85 158c5-14 0-19-5-16-11 7-20 50-19 58 1 16 14 5 18 0" stroke-width="4.7"/><path d="m85 175 7-10-4 12 7-8q5 0 1 7l-5 11q-2 5 4 3" stroke-width="4.3"/><path d="M110 173c-10 3-14 20-6 20s15-22 6-20Z" stroke-width="4.6"/><path d="m120 177-6 13 7-4M131 173c-3 9-5 20-18 31m12-26c-1 8 7 18 14 11" stroke-width="4.6"/></g><path d="m124 162 5-3-4 5-3 1Z" fill="#fff"/>`;

function brushwork(colors,seed=0,keyLime=false){
 return colors.map((color,layer)=>Array.from({length:20},(_,i)=>{
   const x=49+((i*19+seed*7+layer*13)%105),w=3+(i+seed)%8;
   let y=(keyLime?104:42)+((i*11+seed*3+layer*23)%(keyLime?51:66));
   // Keep the small product-defining header clear at app sizes.
   if(!keyLime && y>=59 && y<=89)y+=33;
   if(seed===3 && x<96 && y>=59 && y<=101)y=45+(i%3)*4;
   return `<path d="m${x} ${y} ${w} -2 5-3-2 3 5-1-8 4-7 1 3-2Z" fill="${color}" opacity="${i%3===0?'.55':'.86'}"/>`;
 }).join('')).join('');
}
function draw(recipe){
 const {slug,name,base,wash,marks,waves,ink,flavor,seed,kind='standard'}=recipe;
 let artwork;
 if(kind==='key-lime'){
   artwork=`<path d="M51 76q40 10 98-5v145q-48 16-98 0Z" fill="${wash}"/>
   ${brushwork(marks,seed,true)}
   <path d="M54 211q37 18 84-4l-5 7q-44 16-78 3Z" fill="#e8e52e"/>
   <path d="M56 190q17-4 30 4t42 2l10-8-4 8q-16 12-46 5l-15-5-16-1Z" fill="#d57d2c"/>
   <path d="M55 73q42-9 87-10v15q-45-2-87 10Z" fill="#d7e632"/>
   ${text(100,61,'SPARKLING WATER',5.5,'#f4f4d8','font-weight="bold" letter-spacing=".8"')}
   ${text(100,79,'KEY LIME',9.5,'#16622a','font-weight="bold" letter-spacing=".25"')}
   ${text(88,88,'NATURALLY',4.4,'#c16e2f','font-weight="bold"')}${text(88,94,'ESSENCED',4.4,'#c16e2f','font-weight="bold"')}`;
 }else{
   const washPath=kind==='mango'?'M51 119q26 5 58-5l-6 20 8 8-6 7 8 10-4 8 8 11-3 10 9 11-5 9 3 19H51Z':'M51 111c20-10 48-9 61-16l-5 19 10 9-5 6 8 8-4 10 6 8-3 10 9 12-5 8 8 10-5 9 5 9-2 13H51Z';
   artwork=`<path d="${washPath}" fill="${wash}"/>${brushwork(marks,seed)}
   <path d="M58 194q14-9 33 1t42 2l-8 5-17 1-18-6-12-2-20 4Z" fill="${waves[0]}"/>
   <path d="M57 201q23 13 53 7l24-9-3 9-16 7-26-2-15-1Z" fill="${waves[1]}"/>`;
   if(kind==='mango')artwork+=`${text(75,65,'NATURAL',4.5,'#183661','font-weight="bold"')}${text(77,74,'MANGO',8.4,ink,'font-weight="bold"')}${text(77,81,'ESSENCED',4.4,'#183661','font-weight="bold"')}${text(76,91,'SPARKLING',4.5,'#183661','font-weight="bold" letter-spacing=".5"')}${text(76,98,'WATER',4.5,'#183661','font-weight="bold" letter-spacing=".6"')}`;
   else artwork+=`${text(98,67,'SPARKLING WATER',5.6,'#2b9fa6','font-weight="bold" letter-spacing=".8"')}${text(98,78,flavor,flavor.length>12?6.8:flavor.length>9?7.7:9.5,ink,'font-weight="bold" stroke="#f9f2df" stroke-width=".4" paint-order="stroke"')}${kind==='pure'?'':text(98,87,'NATURALLY ESSENCED',5.7,'#226b9d','font-weight="bold" letter-spacing=".2"')}`;
 }
 return can(slug,name,`${artwork}${lacroixLogo}${text(98,222,'12 FL OZ · 355 mL',4.5,kind==='key-lime'?'#edf3ba':'#236b9a','letter-spacing=".3"')}`,{color:base});
}

const supplier=(path,code)=>({pageUrl:`https://shop.coffeeloversnj.com/product/${path}/`,imageUrl:`https://ocs-images.nywebconsulting.com/${code}.jpg`});
const kroger=(path,upc)=>({pageUrl:`https://www.kroger.com/p/${path}/${upc}`,imageUrl:`https://www.kroger.com/product/images/large/front/${upc}`});
const recipes=[
 {slug:'lacroix-coconut',name:'LaCroix Coconut',flavor:'COCONUT',seed:1,base:'#fffaf0',wash:'#c7af73',marks:['#9a5b28','#b47c36'],waves:['#159e91','#197cbb'],ink:'#8a4d25',
  source:kroger('lacroix-coconut-flavored-sparkling-water-can','0001299310101'),
  observations:'Single Coconut can visually inspected: white/cream base, tan/gold left central wash, brown-gold ragged brushwork at shoulder, teal SPARKLING WATER, brown COCONUT, dark-blue hand-script logo, turquoise and blue lower brush sweeps; silver lid and foot. Coconut, not Pineapple Coconut.'},
 {slug:'lacroix-berry',name:'LaCroix Berry',flavor:'BERRY',seed:2,base:'#eac7e1',wash:'#b979b0',marks:['#a344a0','#b360ac'],waves:['#12a291','#168dbd'],ink:'#9c2b81',
  source:kroger('lacroix-sparkling-water-berry','0007336074751'),
  observations:'Separate Berry can visually inspected: lavender-pink base, mauve left wash, purple shoulder brush marks, purple BERRY header, turquoise SPARKLING WATER and blue NATURALLY ESSENCED, navy script and teal/blue lower sweeps. Not Cran-Raspberry, Razz-Cranberry or Black Razzberry.'},
 {slug:'lacroix-mango',name:'LaCroix Mango',flavor:'MANGO',seed:3,kind:'mango',base:'#fffdf4',wash:'#a8d650',marks:['#319b4e','#ed8d38'],waves:['#7ba947','#344b9a'],ink:'#d68735',
  source:{pageUrl:'https://beverageuniverse.com/products/lacroix-mango-12-oz-24-cans',imageUrl:'https://beverageuniverse.com/cdn/shop/files/lacroix-ooxx-croixmang-main_173dfafc-4bce-4944-9354-e019f4637906.jpg?v=1782485116'},
  observations:'Separate retailer Mango single-can photo inspected: white background with broad lime-green left/lower wash; green shoulder brushwork crossed by orange strokes; compact upper-left stacked NATURAL / MANGO / ESSENCED / SPARKLING WATER, rather than a centered horizontal header; dark-blue script, green and purple-blue lower brush sweeps; silver rims.'},
 {slug:'lacroix-passionfruit',name:'LaCroix Passionfruit',flavor:'PASSIONFRUIT',seed:4,base:'#fffdf4',wash:'#ed4775',marks:['#cc1288','#b2b52a'],waves:['#16a796','#1e8fc0'],ink:'#b6257d',
  source:kroger('lacroix-passionfruit-flavored-sparkling-water-can','0001299344101'),
  observations:'Separate Passionfruit can inspected: white base with hot coral/pink central/left wash; magenta shoulder brush strokes and an olive/lime accent streak below header; magenta PASSIONFRUIT, teal SPARKLING WATER and NATURALLY ESSENCED; navy script with teal and blue lower sweeps. No fruit illustration.'},
 {slug:'lacroix-cran-raspberry',name:'LaCroix Cran-Raspberry',flavor:'CRAN-RASPBERRY',seed:5,base:'#f8c6bd',wash:'#de7c7e',marks:['#ce2049','#dd5075'],waves:['#19a192','#2086af'],ink:'#b4254d',
  source:supplier('la-croix-sparkling-cr-rasp-24-12oz','101629'),
  observations:'Exact CRAN-RASPBERRY can independently inspected: pale blush base, dusty salmon central/left wash, crimson and pink shoulder brushwork, literal CRAN-RASPBERRY header, teal SPARKLING WATER, navy script and teal/blue lower sweeps, silver rims. This is the exact older named package, not the retailer outer carton currently labeled RAZZ-CRANBERRY.',
  extra:'Exact older CRAN-RASPBERRY name/package deliberately retained; supplier page does not date the image. Do not silently substitute RAZZ-CRANBERRY or assert formulation equivalence.'},
 {slug:'lacroix-lemon',name:'LaCroix Lemon',flavor:'LEMON',seed:6,base:'#fff1a3',wash:'#ead015',marks:['#d99c24','#ebbf38'],waves:['#19a097','#188dc4'],ink:'#b57d2f',
  source:supplier('la-croix-sparkling-lemon-24-12oz','101627'),
  observations:'Separate Lemon can inspected: pale lemon-yellow base, saturated yellow left wash, gold/orange shoulder marks, gold LEMON header outlined light, turquoise SPARKLING WATER, blue NATURALLY ESSENCED, navy script and teal/blue lower sweeps. Plain Lemon, not Limoncello.'},
 {slug:'lacroix-orange',name:'LaCroix Orange',flavor:'ORANGE',seed:7,base:'#ffe38b',wash:'#f0a11c',marks:['#e7792a','#ea9840'],waves:['#139d95','#128dc0'],ink:'#c65b32',
  source:supplier('lacroix-sparkling-orange-24-12oz','101632'),
  observations:'Separate Orange can inspected: pale golden-yellow base, amber/orange left wash, orange-red shoulder brushwork and ORANGE flavor header, teal/blue header text, navy script, turquoise and blue lower sweeps, silver rims. Distinct golden package rather than Tangerine graphics.'},
 {slug:'lacroix-key-lime',name:'LaCroix Key Lime',flavor:'KEY LIME',seed:8,kind:'key-lime',base:'#169047',wash:'#b2d832',marks:['#2c973e','#fffbd8'],waves:['#df8a30','#e9e331'],ink:'#196b2c',
  source:supplier('la-croix-sparkling-key-lime-24-12','103081'),
  observations:'Separate Key Lime can inspected: dark emerald-green top/side/base, broad bright lime-yellow central field, rustic green and white brushwork through the middle, yellow flavor stripe with green KEY LIME, white SPARKLING WATER near shoulder, orange NATURALLY ESSENCED; navy script, orange and yellow lower brush sweeps. Distinct from the existing pale Lime can.'},
 {slug:'lacroix-pure',name:'LaCroix Pure',flavor:'PURE',seed:9,kind:'pure',base:'#b9e7ee',wash:'#72c4d4',marks:['#258ec2','#4db1d0'],waves:['#109f98','#087eb5'],ink:'#14548c',
  source:supplier('la-croix-sparkling-plain-24-12','101633'),
  observations:'Separate Pure single can inspected: pale aqua base with cyan left wash, saturated blue shoulder brush marks, blue PURE below turquoise SPARKLING WATER; no NATURALLY ESSENCED line on the unflavored can. Navy hand-script, teal/blue lower strokes, silver rims. Supplier calls it Plain; visible can explicitly reads PURE.'},
 {slug:'lacroix-peach-pear',name:'LaCroix Peach-Pear',flavor:'PEACH-PEAR',seed:10,base:'#f3e8ad',wash:'#eea56b',marks:['#dc6035','#ef8a43'],waves:['#16a492','#138fc1'],ink:'#c64d32',
  source:supplier('la-croix-sparkling-peachpear24-12oz','101637'),
  observations:'Separate Peach-Pear can inspected: pale yellow/cream base, peach-orange left wash, red-orange shoulder brushwork and literal PEACH-PEAR header, turquoise SPARKLING WATER, blue NATURALLY ESSENCED, navy script with turquoise/blue lower sweeps, silver rims. Not Strawberry Peach.'},
];

export const records=recipes.map(recipe=>({
 slug:recipe.slug,family:'lacroix-standard-can',packageChoice:`US 12 fl oz / 355mL ${recipe.name} aluminum can; exact individually inspected flavor package.`,
 references:[{...recipe.source,inspectedAt:'2026-11-02',visuallyInspected:true,observations:recipe.observations}],
 uncertainty:`Manufacturer homepage/flavor pages returned403, so exact retailer/supplier can photos were inspected. Package revision dates are unverified. Shared hand-script paths preserve the existing LaCroix style; flavor-specific washes, headers and brushwork follow the references. Small claims/legal copy omitted. ${recipe.extra??''} Final aesthetic approval and native-device review pending.`,status:'needs-review',svg:draw(recipe),
}));
