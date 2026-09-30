// Client Supabase fittizio: nessuna chiamata di rete. La Edge Function risponde sempre
// con un errore, così l'assistente usa l'interprete locale come quando l'AI è offline.
// `authMock` permette ai test di simulare sessione, login e logout.
export const authMock = {
  session: null,
  listeners: new Set(),
  rpcCalls: [],
  emit(session) {
    this.session = session;
    for (const cb of this.listeners) cb(session ? "SIGNED_IN" : "SIGNED_OUT", session);
  },
};

const query = () => {
  let single = false;
  const q = {
    select: () => q,
    insert: () => q,
    update: () => q,
    upsert: () => q,
    delete: () => q,
    eq: () => q,
    order: () => q,
    single: () => ((single = true), q),
    maybeSingle: () => ((single = true), q),
    then: (resolve) => resolve({ data: single ? null : [], error: null }),
  };
  return q;
};

export function createClient() {
  return {
    from: query,
    rpc: async (name) => {
      authMock.rpcCalls.push(name);
      return { data: null, error: null };
    },
    channel: () => ({
      on() {
        return this;
      },
      subscribe() {
        return this;
      },
    }),
    removeChannel: () => {},
    auth: {
      getSession: async () => ({ data: { session: authMock.session } }),
      onAuthStateChange: (cb) => {
        authMock.listeners.add(cb);
        return { data: { subscription: { unsubscribe: () => authMock.listeners.delete(cb) } } };
      },
      signOut: async () => authMock.emit(null),
      signInAnonymously: async () => {
        authMock.emit({ user: { id: "anon", is_anonymous: true, created_at: new Date().toISOString() } });
        return { data: {}, error: null };
      },
    },
    functions: {
      invoke: async () => ({ data: null, error: new Error("offline") }),
    },
  };
}
