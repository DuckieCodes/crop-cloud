// Crop Cloud accounts (Supabase Auth with email and password). The session is
// kept in localStorage, so people sign in once per computer.
const Account = (() => {
  const listeners = new Set();
  let client = null;
  let user = null;
  let profile = null;   // { display_name, plan_id }
  let storage = null;   // { used, cap, planId, planName }
  let ready = false;

  const emit = () => listeners.forEach((fn) => fn());
  const configured = () => !!(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey && window.supabase);

  // Supabase's messages are written for developers; these are for people.
  function friendly(error) {
    const msg = String(error?.message || error || '');
    const code = error?.code || '';
    if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return 'That email and password don’t match an account.';
    if (code === 'email_not_confirmed' || /email not confirmed/i.test(msg)) return 'Confirm your email first. Check your inbox for the code.';
    if (code === 'user_already_exists' || /already registered/i.test(msg)) return 'There’s already an account with that email. Sign in instead.';
    // The invite-only check in schema.sql reaches the app as a generic database error.
    if (/database error saving new user|invite-only/i.test(msg)) return 'That email isn’t on the invite list. Ask whoever runs your Crop Cloud server to add it.';
    if (code === 'signup_disabled' || /signups not allowed/i.test(msg)) return 'New accounts are turned off on this server.';
    if (code === 'weak_password' || /password should be/i.test(msg)) return 'Use a longer password: at least 8 characters.';
    if (code === 'otp_expired' || /token has expired|invalid.*otp|otp.*invalid/i.test(msg)) return 'That code is wrong or has expired. Request a new one.';
    if (code === 'over_email_send_rate_limit' || /rate limit/i.test(msg)) return 'Too many attempts. Wait a minute and try again.';
    if (/failed to fetch|network/i.test(msg)) return 'Can’t reach the Crop Cloud servers. Check your internet connection.';
    return msg || 'Something went wrong. Please try again.';
  }

  async function call(promise) {
    const { data, error } = await promise;
    if (error) throw new Error(friendly(error));
    return data;
  }

  async function loadDetails() {
    if (!user) { profile = null; storage = null; return; }
    const [p, s] = await Promise.all([
      client.from('profiles').select('display_name, plan_id').eq('id', user.id).maybeSingle(),
      client.rpc('storage_status'),
    ]);
    profile = p.data || null;
    const row = Array.isArray(s.data) ? s.data[0] : s.data;
    storage = row ? { used: Number(row.used_bytes), cap: Number(row.cap_bytes), planId: row.plan_id, planName: row.plan_name } : null;
  }

  async function setUser(next) {
    const changed = (next?.id || null) !== (user?.id || null);
    user = next ? { id: next.id, email: next.email } : null;
    if (changed || !profile) await loadDetails().catch(() => {});
    emit();
  }

  return {
    get configured() { return configured(); },
    get ready() { return ready; },
    get user() { return user; },
    get signedIn() { return !!user; },
    get profile() { return profile; },
    get storage() { return storage; },
    get client() { return client; },

    async init() {
      if (!configured()) { ready = true; emit(); return; }
      client = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'cropcloud.auth' },
      });
      const { data } = await client.auth.getSession();
      await setUser(data.session?.user || null);
      ready = true;
      emit();
      client.auth.onAuthStateChange((_event, session) => {
        // Supabase asks for callbacks to return quickly; do the work afterwards.
        setTimeout(() => setUser(session?.user || null), 0);
      });
    },

    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    async signIn(email, password) {
      const data = await call(client.auth.signInWithPassword({ email, password }));
      await setUser(data.user);
    },

    // Returns { needsCode: true } when the project asks new accounts to confirm their email.
    async signUp(email, password, name) {
      const data = await call(client.auth.signUp({ email, password, options: { data: { name } } }));
      if (data.session) { await setUser(data.user); return { needsCode: false }; }
      return { needsCode: true };
    },

    async verifySignup(email, token) {
      const data = await call(client.auth.verifyOtp({ email, token, type: 'signup' }));
      await setUser(data.user);
    },

    sendPasswordCode: (email) => call(client.auth.resetPasswordForEmail(email)),

    async resetPassword(email, token, password) {
      await call(client.auth.verifyOtp({ email, token, type: 'recovery' }));
      const data = await call(client.auth.updateUser({ password }));
      await setUser(data.user);
    },

    async signOut() {
      await client.auth.signOut();
      await setUser(null);
    },

    async setDisplayName(name) {
      if (!user) return;
      await call(client.from('profiles').update({ display_name: name }).eq('id', user.id));
      profile = { ...profile, display_name: name };
    },

    async refresh() {
      await loadDetails().catch(() => {});
      emit();
    },

    plans: async () => call(client.from('plans').select('id, name, storage_bytes, price_cents, currency, interval').eq('active', true).order('sort')),

    friendly,
  };
})();
