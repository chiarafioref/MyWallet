// L'app importa supabase-js da esm.sh (nessun bundler): Node non può risolvere quell'URL,
// quindi nei test l'import viene reindirizzato a uno stub locale.
import { registerHooks } from "node:module";

const SUPABASE_STUB = new URL("./helpers/supabase-stub.js", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("https://esm.sh/@supabase/supabase-js")) {
      return { url: SUPABASE_STUB, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
