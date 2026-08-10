(function () {
  if (!window.supabase || typeof window.supabase.createClient !== "function" || window.supabase.__cisAuthLoopFix) return;

  const originalCreateClient = window.supabase.createClient.bind(window.supabase);
  const wrappedClients = new WeakMap();
  const wrappedAuth = new WeakMap();

  window.supabase.createClient = function createClientWithAuthLoopGuard(...args) {
    const client = originalCreateClient(...args);
    if (wrappedClients.has(client)) return wrappedClients.get(client);

    const proxy = new Proxy(client, {
      get(target, prop, receiver) {
        if (prop === "auth") return wrapAuth(Reflect.get(target, prop, receiver));
        return Reflect.get(target, prop, receiver);
      }
    });

    wrappedClients.set(client, proxy);
    return proxy;
  };

  window.supabase.__cisAuthLoopFix = true;

  function wrapAuth(auth) {
    if (!auth || typeof auth.onAuthStateChange !== "function") return auth;
    if (wrappedAuth.has(auth)) return wrappedAuth.get(auth);

    const proxy = new Proxy(auth, {
      get(target, prop) {
        if (prop === "onAuthStateChange") {
          return (callback, ...args) => target.onAuthStateChange((event, session) => {
            if (event === "SIGNED_IN") return undefined;
            return callback(event, session);
          }, ...args);
        }

        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });

    wrappedAuth.set(auth, proxy);
    return proxy;
  }
})();
