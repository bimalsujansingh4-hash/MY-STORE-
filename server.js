
const express=require("express"), helmet=require("helmet"), rateLimit=require("express-rate-limit"),
bcrypt=require("bcryptjs"), jwt=require("jsonwebtoken"), cookieParser=require("cookie-parser"),
multer=require("multer"), path=require("path"), fs=require("fs");

const app=express(), PORT=process.env.PORT||3000;
const SUPA_URL=(process.env.SUPABASE_URL||"").replace(/\/$/,""), SUPA_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
const JWT_SECRET=process.env.JWT_SECRET||"CHANGE_ME";
const STORE_WHATSAPP=(process.env.STORE_WHATSAPP||"919019899943").replace(/\D/g,"");
const WA_TOKEN=process.env.META_WA_TOKEN||"", WA_PHONE_ID=process.env.META_WA_PHONE_ID||"", WA_VER=process.env.META_WA_API_VERSION||"v23.0";

if(!SUPA_URL||!SUPA_KEY) console.warn("WARNING: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured.");
const headers=()=>({"apikey":SUPA_KEY,"Authorization":`Bearer ${SUPA_KEY}`,"Content-Type":"application/json"});
async function sb(pathname,opts={}){
 const r=await fetch(`${SUPA_URL}/rest/v1/${pathname}`,{...opts,headers:{...headers(),...(opts.headers||{})}});
 const txt=await r.text(); let data; try{data=txt?JSON.parse(txt):null}catch{data=txt}
 if(!r.ok) throw new Error(typeof data==="object"&&data?.message?data.message:`Supabase ${r.status}`);
 return data;
}
async function list(table,query=""){return sb(`${table}?${query}`)}
async function one(table,query){const x=await list(table,query);return x[0]||null}
async function insert(table,row){return sb(table,{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify(row)})}
async function update(table,query,row){return sb(`${table}?${query}`,{method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify(row)})}
async function remove(table,query){return sb(`${table}?${query}`,{method:"DELETE",headers:{"Prefer":"return=representation"}})}
async function storageUpload(file){
 if(!SUPA_URL||!SUPA_KEY) throw new Error("Supabase is not configured");
 const bucket=process.env.SUPABASE_BUCKET||"product-images";
 const p=`${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname).toLowerCase()}`;
 const buf=fs.readFileSync(file.path);
 const r=await fetch(`${SUPA_URL}/storage/v1/object/${bucket}/${p}`,{method:"POST",headers:{"Authorization":`Bearer ${SUPA_KEY}`,"apikey":SUPA_KEY,"Content-Type":file.mimetype,"x-upsert":"true"},body:buf});
 if(!r.ok) throw new Error("Image upload failed");
 fs.unlinkSync(file.path);
 return `${SUPA_URL}/storage/v1/object/public/${bucket}/${p}`;
}
async function ensureAdmin(){
 const a=await one("admin_settings","id=eq.1&select=id,password_hash");
 if(!a){
  const pw=process.env.ADMIN_PASSWORD||"MANISH@admin";
  await insert("admin_settings",{id:1,password_hash:await bcrypt.hash(pw,12)});
  console.log("Created initial admin password from ADMIN_PASSWORD.");
 }
}
async function seed(){
 const p=await list("products","select=id&limit=1"); if(!p.length){
  await insert("products",[
   {id:"p1",name:"iPhone 15",category:"Electronics",price:29999,old_price:34999,rating:4.8,reviews:"1200+",stock:12,image:"/phone.svg",description:"Premium smartphone with a bright display, powerful performance and modern camera system."},
   {id:"p2",name:"Dell Inspiron 15",category:"Electronics",price:49999,old_price:59999,rating:4.6,reviews:"856+",stock:8,image:"/laptop.svg",description:"Versatile laptop for work, study and everyday productivity."},
   {id:"p3",name:"Adidas Sneakers",category:"Fashion",price:2999,old_price:4999,rating:4.4,reviews:"420+",stock:25,image:"/shoe.svg",description:"Comfortable everyday sneakers with a sporty lightweight design."}
  ]);
 }
 const c=await list("coupons","select=code&limit=1"); if(!c.length) await insert("coupons",[
  {code:"WELCOME10",type:"percent",value:10,min_order:999,active:true},
  {code:"FLAT200",type:"flat",value:200,min_order:1999,active:true},
  {code:"FREESHIP",type:"shipping",value:99,min_order:499,active:true}
 ]);
 await ensureAdmin();
}
app.use(helmet({contentSecurityPolicy:false,crossOriginResourcePolicy:{policy:"same-site"}}));
app.use(express.json({limit:"500kb"})); app.use(cookieParser());
app.use("/api/",rateLimit({windowMs:15*60*1000,max:300}));
const loginLimit=rateLimit({windowMs:15*60*1000,max:8});
const tmp=path.join("/tmp","mystore");fs.mkdirSync(tmp,{recursive:true});
const upload=multer({dest:tmp,limits:{fileSize:5*1024*1024},fileFilter:(q,f,cb)=>cb(null,["image/jpeg","image/png","image/webp","image/gif"].includes(f.mimetype))});

function auth(req,res,next){const t=req.cookies.admin_session;if(!t)return res.status(401).json({error:"Admin login required"});try{req.admin=jwt.verify(t,JWT_SECRET);if(req.admin.role!=="admin")throw 0;next()}catch{res.clearCookie("admin_session");res.status(401).json({error:"Session expired"})}}
function productOut(p){return {...p,oldPrice:p.old_price}}
function clean(body){const price=Number(body.price),old=Number(body.oldPrice||body.price),stock=Math.max(0,Math.floor(Number(body.stock)||0));if(!body.name||!body.category||!Number.isFinite(price)||price<0)throw Error("Invalid product details");return {name:String(body.name).trim().slice(0,120),category:String(body.category).trim().slice(0,40),price,old_price:Number.isFinite(old)?old:price,stock,description:String(body.description||"").slice(0,1000)}}
function orderText(o){return `🛍️ NEW MYSTORE ORDER\nOrder ID: ${o.id}\nCustomer: ${o.name}\nPhone: ${o.phone}\nAddress: ${o.address}, ${o.city} - ${o.pin}\nItems:\n${o.items.map(x=>`• ${x.name} × ${x.qty} = ₹${x.price*x.qty}`).join("\n")}\nTotal: ₹${o.total}\nPayment: ${o.payment}\nStatus: ${o.status}`}
async function metaWA(to,text){if(!WA_TOKEN||!WA_PHONE_ID)return {sent:false,reason:"Meta WhatsApp API not configured"};const r=await fetch(`https://graph.facebook.com/${WA_VER}/${WA_PHONE_ID}/messages`,{method:"POST",headers:{Authorization:`Bearer ${WA_TOKEN}`,"Content-Type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",to,type:"text",text:{body:text}})});return {sent:r.ok,data:await r.json()}} 

app.post("/api/admin/login",loginLimit,async(req,res)=>{try{const a=await one("admin_settings","id=eq.1&select=password_hash"),ok=a&&await bcrypt.compare(String(req.body.password||""),a.password_hash);if(!ok)return res.status(401).json({error:"Invalid password"});const token=jwt.sign({role:"admin"},JWT_SECRET,{expiresIn:"8h"});res.cookie("admin_session",token,{httpOnly:true,sameSite:"strict",secure:process.env.NODE_ENV==="production",maxAge:8*3600000});res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});
app.post("/api/admin/logout",(q,s)=>{s.clearCookie("admin_session");s.json({ok:true})});
app.get("/api/admin/me",auth,(q,s)=>s.json({ok:true}));
app.post("/api/admin/change-password",auth,async(req,res)=>{try{const cur=String(req.body.currentPassword||""),next=String(req.body.newPassword||"");if(next.length<8)return res.status(400).json({error:"New password must be at least 8 characters"});const a=await one("admin_settings","id=eq.1&select=password_hash");if(!a||!(await bcrypt.compare(cur,a.password_hash)))return res.status(401).json({error:"Current password is incorrect"});await update("admin_settings","id=eq.1",{password_hash:await bcrypt.hash(next,12),updated_at:new Date().toISOString()});res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});

app.get("/api/products",async(req,res)=>{try{let q="select=*";const cat=String(req.query.category||"All"),term=String(req.query.q||"").trim();if(cat!=="All")q+=`&category=eq.${encodeURIComponent(cat)}`;q+="&order=created_at.desc";let p=await list("products",q);if(term){const t=term.toLowerCase();p=p.filter(x=>(x.name+" "+x.category+" "+(x.description||"")).toLowerCase().includes(t))}res.json(p.map(productOut))}catch(e){res.status(500).json({error:e.message})}});
app.get("/api/products/:id",async(req,res)=>{try{const p=await one("products",`id=eq.${encodeURIComponent(req.params.id)}&select=*`);p?res.json(productOut(p)):res.status(404).json({error:"Product not found"})}catch(e){res.status(500).json({error:e.message})}});

app.get("/api/coupons",async(req,res)=>res.json(await list("coupons","active=eq.true&select=*")));
app.post("/api/coupons/apply",async(req,res)=>{try{const code=String(req.body.code||"").toUpperCase(),sub=Number(req.body.subtotal)||0,c=await one("coupons",`code=eq.${encodeURIComponent(code)}&active=eq.true&select=*`);if(!c)return res.status(400).json({error:"Invalid or inactive coupon"});if(sub<c.min_order)return res.status(400).json({error:`Minimum order is ₹${c.min_order}`});let d=0;if(c.type==="percent")d=Math.min(sub,Math.round(sub*c.value/100));if(c.type==="flat")d=Math.min(sub,c.value);res.json({code:c.code,type:c.type,value:c.value,discount:d,shippingFree:c.type==="shipping"})}catch(e){res.status(500).json({error:e.message})}});

app.post("/api/admin/products",auth,upload.single("image"),async(req,res)=>{try{const x=clean(req.body);x.id="p_"+Date.now().toString(36);x.image=req.file?await storageUpload(req.file):"/assets/product-placeholder.svg";x.rating=4.5;x.reviews="New";const r=await insert("products",x);res.status(201).json(productOut(r[0]))}catch(e){if(req.file&&fs.existsSync(req.file.path))fs.unlinkSync(req.file.path);res.status(400).json({error:e.message})}});
app.put("/api/admin/products/:id",auth,upload.single("image"),async(req,res)=>{try{const x=clean(req.body);if(req.file)x.image=await storageUpload(req.file);const old=await one("products",`id=eq.${encodeURIComponent(req.params.id)}&select=image`);if(!x.image)x.image=old?.image||"/assets/product-placeholder.svg";const r=await update("products",`id=eq.${encodeURIComponent(req.params.id)}`,x);res.json(productOut(r[0]))}catch(e){res.status(400).json({error:e.message})}});
app.delete("/api/admin/products/:id",auth,async(req,res)=>{try{await remove("products",`id=eq.${encodeURIComponent(req.params.id)}`);res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});

app.post("/api/orders",async(req,res)=>{try{
 const {name,phone,address,city,pin,payment,items,couponCode}=req.body;if(!name||!phone||!address||!city||!pin||!Array.isArray(items)||!items.length)return res.status(400).json({error:"Complete order details are required"});
 const ids=items.map(x=>x.id),ps=await list("products",`id=in.(${ids.map(encodeURIComponent).join(",")})&select=*`);let cleanItems=[],sub=0;
 for(const it of items){const p=ps.find(x=>x.id===it.id),qty=Math.max(1,Math.min(99,Number(it.qty)||1));if(!p)return res.status(400).json({error:"A selected product is unavailable"});if(p.stock<qty)return res.status(400).json({error:`Only ${p.stock} left for ${p.name}`});sub+=p.price*qty;cleanItems.push({id:p.id,name:p.name,price:p.price,qty})}
 let discount=0,free=false,applied="";if(couponCode){const c=await one("coupons",`code=eq.${encodeURIComponent(String(couponCode).toUpperCase())}&active=eq.true&select=*`);if(c&&sub>=c.min_order){applied=c.code;if(c.type==="percent")discount=Math.min(sub,Math.round(sub*c.value/100));if(c.type==="flat")discount=Math.min(sub,c.value);if(c.type==="shipping")free=true}}
 const delivery=free||sub-discount>=1000?0:99,total=Math.max(0,sub-discount+delivery),id="MS"+Date.now().toString().slice(-8);
 const o={id,created_at:new Date().toISOString(),name:String(name).slice(0,100),phone:String(phone).slice(0,30),address:String(address).slice(0,500),city:String(city).slice(0,80),pin:String(pin).slice(0,10),payment:String(payment||"Cash on Delivery").slice(0,40),items:cleanItems,subtotal:sub,discount,delivery,total,coupon:applied,status:"Confirmed"};
 await insert("orders",o);
 for(const it of cleanItems){const p=ps.find(x=>x.id===it.id);await update("products",`id=eq.${encodeURIComponent(p.id)}`,{stock:p.stock-it.qty})}
 let whatsapp={sent:false};try{whatsapp=await metaWA(STORE_WHATSAPP,orderText(o))}catch(e){whatsapp={sent:false,reason:e.message}}
 res.status(201).json({...o,createdAt:o.created_at,whatsapp});
}catch(e){res.status(500).json({error:e.message})}});
app.get("/api/orders/track",async(req,res)=>{try{const id=String(req.query.id||""),phone=String(req.query.phone||"").replace(/\D/g,"");const o=await one("orders",`id=eq.${encodeURIComponent(id)}&select=*`);if(!o||o.phone.replace(/\D/g,"").slice(-10)!==phone.slice(-10))return res.status(404).json({error:"Order not found. Check Order ID and phone number."});res.json({...o,createdAt:o.created_at})}catch(e){res.status(500).json({error:e.message})}});
app.get("/api/admin/orders",auth,async(q,s)=>s.json(await list("orders","select=*&order=created_at.desc")));
app.patch("/api/admin/orders/:id",auth,async(req,res)=>{try{const allowed=["Confirmed","Packed","Shipped","Delivered","Cancelled"],status=req.body.status;if(!allowed.includes(status))return res.status(400).json({error:"Invalid status"});const r=await update("orders",`id=eq.${encodeURIComponent(req.params.id)}`,{status});const o=r[0];let whatsapp={sent:false};try{whatsapp=await metaWA(o.phone.replace(/\D/g,""),`Update for MyStore order ${o.id}: your order status is now *${o.status}*.`)}catch(e){}res.json({...o,whatsapp})}catch(e){res.status(500).json({error:e.message})}});
app.get("/api/admin/coupons",auth,async(q,s)=>s.json(await list("coupons","select=*&order=code.asc")));
app.post("/api/admin/coupons",auth,async(req,res)=>{try{const c={code:String(req.body.code||"").trim().toUpperCase(),type:String(req.body.type||"flat"),value:Number(req.body.value)||0,min_order:Number(req.body.minOrder)||0,active:req.body.active!==false};if(!c.code||!["flat","percent","shipping"].includes(c.type))return res.status(400).json({error:"Invalid coupon"});await remove("coupons",`code=eq.${encodeURIComponent(c.code)}`);const r=await insert("coupons",c);res.json(r[0])}catch(e){res.status(400).json({error:e.message})}});
app.delete("/api/admin/coupons/:code",auth,async(req,res)=>{try{await remove("coupons",`code=eq.${encodeURIComponent(req.params.code.toUpperCase())}`);res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});

app.use(express.static(__dirname,{extensions:["html"]}));
app.get("/{*splat}",(req,res)=>req.path.startsWith("/api/")?res.status(404).json({error:"Not found"}):res.sendFile(path.join(__dirname,"index.html")));
(async()=>{try{if(SUPA_URL&&SUPA_KEY)await seed();app.listen(PORT,"0.0.0.0",()=>console.log(`MyStore online on port ${PORT}`))}catch(e){console.error("Startup failed:",e);process.exit(1)}})();
