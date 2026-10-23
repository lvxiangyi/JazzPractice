const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=__dirname;
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.xml':'application/xml','.musicxml':'application/xml','.json':'application/json','.wav':'audio/wav','.mp3':'audio/mpeg'};
// Lists every score in sheet/, so files added there appear in the app's score picker.
function readSheets(){
  const dir=path.join(root,'sheet');
  return fs.readdirSync(dir).filter(n=>/\.(musicxml|xml|mxl)$/i.test(n)).sort((a,b)=>a.localeCompare(b)).map(file=>{
      let title=file.replace(/\.(musicxml|xml|mxl)$/i,'').replace(/_/g,' ');
      if(!/\.mxl$/i.test(file))try{const head=fs.readFileSync(path.join(dir,file),'utf8').slice(0,4000);title=(head.match(/<work-title>([^<]+)/)||head.match(/<movement-title>([^<]+)/)||[])[1]?.trim()||title;}catch{}
      return {file:'sheet/'+file,title};
    });
}
function listSheets(res){
  let sheets;try{sheets=readSheets();}catch{res.writeHead(500);return res.end('[]');}
  res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(sheets));
}
// A static copy lets the page list scores even when served by an older or different static server.
try{fs.writeFileSync(path.join(root,'sheet','index.json'),JSON.stringify(readSheets(),null,1));}catch{}
const server=http.createServer((req,res)=>{
  let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);return res.end();}
  if(pathname==='/api/sheets')return listSheets(res);
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)||pathname.includes('node_modules')||pathname.includes('/.')){res.writeHead(403);return res.end('Forbidden');}
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found');}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);});
});
const port=Number(process.env.PORT)||5173;
server.listen(port,'127.0.0.1',()=>console.log(`Cadence ready: http://localhost:${port}`));
