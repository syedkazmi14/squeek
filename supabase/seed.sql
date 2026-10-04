-- Demo data only. Domains use the reserved .example TLD; phone numbers use the fictional 555-01xx range.
-- Replace the numbers with phones your team owns before testing real incoming calls.

insert into public.blocked_domains (domain, label, source) values
  ('irs-refund-claim.example', 'Demo: fake tax refund site', 'seed'),
  ('paypal-account-verify.example', 'Demo: fake PayPal login', 'seed'),
  ('usps-redelivery-fee.example', 'Demo: fake delivery fee', 'seed')
on conflict do nothing;

insert into public.blocked_numbers (e164, label, source) values
  ('+15555550100', 'Demo: reported scam caller', 'seed'),
  ('+15555550101', 'Demo: reported scam caller', 'seed'),
  ('+15555550102', 'Demo: reported scam caller', 'seed')
on conflict do nothing;
