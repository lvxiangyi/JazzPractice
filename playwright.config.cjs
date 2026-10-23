const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({testDir:'./tests',workers:1,use:{channel:'msedge',headless:true,baseURL:'http://127.0.0.1:5173',viewport:{width:1440,height:1100}},webServer:{command:'node server.cjs',url:'http://127.0.0.1:5173',reuseExistingServer:true}});
