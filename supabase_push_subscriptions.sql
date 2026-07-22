-- Push subscriptions for real Web Push meal-reminder notifications.
-- One row per browser subscription (a person could have more than
-- one device/browser subscribed at once, each gets its own row).
-- endpoint is unique per browser subscription, so re-subscribing
-- (e.g. after clearing site data) just creates a fresh row rather
-- than erroring on a duplicate.

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text unique not null,
  p256dh text not null,
  auth text not null,
  reminder_type text not null default 'meal_reminder',
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_reminder_type_idx
  on push_subscriptions (reminder_type);
