const metrics={requests:0,errors:0,latencyMs:0,startedAt:Date.now()};
function middleware(req,res,next){const t=Date.now();metrics.requests++;res.on('finish',()=>{metrics.latencyMs+=Date.now()-t;if(res.statusCode>=500)metrics.errors++;});next();}
function snapshot(){const uptime=(Date.now()-metrics.startedAt)/1000;return {...metrics,uptimeSeconds:uptime,avgLatencyMs:metrics.requests?metrics.latencyMs/metrics.requests:0,errorRate:metrics.requests?metrics.errors/metrics.requests:0};}
module.exports={middleware,snapshot};
