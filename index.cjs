// All callbacks route to the currently bound host account + pet scope.
module.exports.activate = async function activate(pet) {
  const { createHash } = require('node:crypto');
  const { createEngine } = await import('./src/engine.mjs');
  const { createController, SERVICE } = await import('./src/controller.mjs');
  if (!pet.profile?.getScope) throw Error('当前宿主尚未提供插件身份隔离接口，请使用支持 B 站生活的测试宿主。');
  let controller, engine, bound, disposed = false, setup = Promise.resolve(), contextEpoch = 0;
  const handlers = new Map(), registered = new Set();
  const proxy = { ...pet, tools: { register(spec) {
    handlers.set(spec.name, spec.handler);
    if (registered.has(spec.name)) return;
    registered.add(spec.name);
    return pet.tools.register({ ...spec, handler: (...args) => {
      if (!controller || disposed || !handlers.has(spec.name)) throw Error('宠物身份正在切换，请稍后重试。');
      return handlers.get(spec.name)(...args);
    } });
  } } };
  async function rebind() {
    const epoch = contextEpoch;
    const next = await pet.profile.getScope();
    if (disposed || epoch !== contextEpoch || bound?.scopeId === next.scopeId && bound?.revision === next.revision) return;
    const previous = controller; controller = null; bound = null; handlers.clear();
    engine?.dispose();
    if (previous) await previous.dispose();
    if (disposed || epoch !== contextEpoch) return;
    const scopeKey = createHash('sha256').update(String(next.scopeId)).digest('hex').slice(0, 32);
    const candidate = await createEngine({ pet, scopeKey, secretKey: 'bili.credentials.' + scopeKey, notifySecretKey: 'bili.notify.' + scopeKey });
    engine = candidate;
    let created;
    try {
      created = await createController({ pet: proxy, engine: candidate, scopeKey, scopeId: next.scopeId, scopeRevision: next.revision });
      const actual = await pet.profile.getScope();
      if (disposed || epoch !== contextEpoch || actual.scopeId !== next.scopeId || actual.revision !== next.revision) { await created.dispose(); return; }
      controller = created; bound = next;
      created.registerTools(); await created.start();
    } catch (error) { candidate.dispose(); throw error; }
  }
  const queueRebind = () => {
    contextEpoch++;
    engine?.dispose();
    const previous = controller; controller = null; bound = null; handlers.clear();
    const cleanup = previous?.dispose();
    setup = setup.then(async () => { await cleanup; await rebind(); }).catch(() => { engine?.dispose(); controller = null; });
    return setup;
  };
  // Subscribe before the first asynchronous scope read, then reconcile once more.
  pet.events.on('host:context-changed', queueRebind);
  setup = setup.then(rebind);
  let pending; do { pending = setup; await pending; } while (pending !== setup);
  await (setup = setup.then(rebind));
  if (!controller) throw Error('宠物身份已变化，请重新启用 B 站生活。');
  const methods = Object.fromEntries(Object.keys(controller.api).map(method => [method, (...args) => {
    if (disposed || !controller) throw Error('宠物身份正在切换，请稍后重试。');
    return controller.api[method](...args);
  }]));
  await pet.services.provide(SERVICE, methods);
  await (setup = setup.then(rebind));
  const dispose = async () => {
    if (disposed) return;
    disposed = true; engine?.dispose();
    const previous = controller; controller = null; handlers.clear();
    await previous?.dispose();
  };
  process.once('disconnect', dispose);
  process.once('SIGTERM', dispose);
  process.once('beforeExit', dispose);
  process.parentPort?.once?.('close', dispose);
  return { dispose };
};
