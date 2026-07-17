import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const trpc = require('@trpc/server');
const t = trpc.initTRPC.context().create();
const inner = t.router({ getBusiness: t.procedure.query(() => 'ok') });
const router = t.router({ config: inner });
const caller = router.createCaller({});
console.log('typeof caller:', typeof caller);
const configVal = caller['config'];
console.log('typeof caller[config]:', typeof configVal);
console.log('caller[config] value:', configVal);
if (configVal && typeof configVal === 'object') {
  const getBusinessVal = configVal['getBusiness'];
  console.log('typeof caller[config][getBusiness]:', typeof getBusinessVal);
}
