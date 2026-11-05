import{expect,test}from'bun:test';import{requireLocalOrigin}from'../src/lib/pq/api';
function enabled(fn:()=>void){const previous=process.env.QRAFT_LOCAL_PQ_SERVICE;process.env.QRAFT_LOCAL_PQ_SERVICE='1';try{fn();}finally{if(previous===undefined)delete process.env.QRAFT_LOCAL_PQ_SERVICE;else process.env.QRAFT_LOCAL_PQ_SERVICE=previous;}}
test('loopback browser Host is accepted when Next internally normalizes URL to localhost',()=>enabled(()=>{
 requireLocalOrigin(new Request('http://localhost:3006/api/pq/accounts',{headers:{host:'127.0.0.1:3006',origin:'http://127.0.0.1:3006'}}));
}));
test('other origins and mismatched ports cannot invoke the optional gas helper',()=>enabled(()=>{
 for(const origin of ['https://attacker.invalid','http://localhost:9999','http://127.0.0.1:9999'])expect(()=>requireLocalOrigin(new Request('http://localhost:3006/api/pq/accounts',{headers:{host:'127.0.0.1:3006',origin}}))).toThrow();
}));
test('missing Origin is rejected',()=>enabled(()=>{expect(()=>requireLocalOrigin(new Request('http://localhost:3006/api/pq/accounts',{headers:{host:'127.0.0.1:3006'}}))).toThrow();}));
