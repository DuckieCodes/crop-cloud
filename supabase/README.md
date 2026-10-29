# Setting up accounts and cloud storage

Crop Cloud uses [Supabase](https://supabase.com) for sign-in, cloud storage, sharing projects and watch parties. Until `js/config.js` has a project in it, everything else works and sign-in is simply turned off.

## 1. Create the project

Make a new project at supabase.com. Any region close to you is fine.

Storage costs: the Free plan only includes a small amount of file storage and a low per-file size limit. Giving every member 10 GB needs a paid Supabase plan. Check supabase.com/pricing before you invite lots of people.

## 2. Create the tables

In the dashboard open **SQL Editor › New query**, paste all of `schema.sql` and press **Run**. You can run it again whenever the file changes.

It creates:

- `plans`: Free (10 GB) is on. Plus (100 GB) and Pro (1 TB) stay hidden until you give them a `price_cents` and set `active` to true.
- `profiles`: display name and plan for each person. People can change their name but never their plan.
- `allowed_signups`: the invite list. Only these emails can create an account.
- `projects`, `project_members`, `project_invites`, `comments`: sharing. Invited friends can view, watch and comment, never edit.
- Storage buckets `library` (your files for every app) and `projects` (shared project snapshots). Both count toward the plan's cap, and uploads are refused once you reach it.
- Watch-party access rules for Realtime channels named `party:<project id>`.

## 3. Sign-in settings

Email codes are off for now (`emailCodes: false` in `js/config.js`), so the server doesn't need to send email and new accounts work straight away.

1. Turn off email confirmation. On supabase.com: **Authentication › Sign In / Providers › Email › Confirm email** off. Self-hosted: `ENABLE_EMAIL_AUTOCONFIRM=true` in the server's `.env`.
2. Sign-ups are invite-only. Add your own email first, then each friend's, in **Table Editor › allowed_signups** or the SQL Editor:

   ```sql
   insert into public.allowed_signups (email) values ('you@example.com'), ('friend@example.com');
   ```

   Anyone else who tries to create an account is told they're not on the list.
3. If someone forgets their password, set a new one for them in the SQL Editor and tell them what it is:

   ```sql
   update auth.users
   set encrypted_password = extensions.crypt('their new password', extensions.gen_salt('bf'))
   where email = 'friend@example.com';
   ```

To turn email codes on later: give the server a way to send email (SMTP), turn email confirmation back on, put `{{ .Token }}` in the **Confirm signup** and **Reset password** email templates, and set `emailCodes: true`.

## 4. Connect the apps

Open **Project Settings › API** and copy the **Project URL** and the **anon public** key into `js/config.js`:

```js
const CONFIG = {
  supabaseUrl: 'https://abcd1234.supabase.co',
  supabaseAnonKey: 'eyJ...',
};
```

The anon key is meant to be public: the rules in `schema.sql` decide what it can do. Never put the `service_role` key in the app.

## Selling bigger plans

The plan picker already reads from `plans`. To offer a tier, set its price and `active = true` in **Table Editor › plans**. Taking payment isn't wired up yet, so the Upgrade button stays disabled until a payment provider is connected.
