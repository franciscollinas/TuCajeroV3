import { initTRPC } from '@trpc/server';
const t = initTRPC.create();
const sub = t.router({ hi: t.procedure.query(() => 'hi') });
const app = t.router({ sub });
const caller = app.createCaller({});
console.log('sub type:', typeof (caller as any).sub);
console.log('sub.hi type:', typeof (caller as any).sub?.hi);
