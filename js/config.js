// Online services. Both values are safe to ship: the anon key only allows what
// the row-level security in supabase/schema.sql allows.
// The server is self-hosted Supabase on the Pi (~/crop-cloud-server); the anon key is ANON_KEY in its .env.
const CONFIG = {
  supabaseUrl: 'https://cropcloud.willythepi.com',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzkzMjg0NjM5LCJleHAiOjE5NTA5NjQ2Mzl9.IFdfK_GARCKMxiMvk9VYbtopm6vXu5e99woMhy9xr94',
  // 6-digit email codes for confirming new accounts and resetting passwords.
  // Off until the server can send email; sign-ups are invite-only either way.
  emailCodes: false,
};
