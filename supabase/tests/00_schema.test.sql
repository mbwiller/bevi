begin;
select plan(19);

select ok(to_regclass('public.categories') is not null, 'categories exists');
select ok(to_regclass('public.profiles') is not null, 'profiles exists');
select ok(to_regclass('public.bevs') is not null, 'bevs exists');
select ok(to_regclass('public.bev_aliases') is not null, 'bev_aliases exists');
select ok(to_regclass('public.bev_stats') is not null, 'bev_stats exists');
select ok(to_regclass('public.rankings') is not null, 'rankings exists');
select ok(to_regclass('public.comparisons') is not null, 'comparisons exists');
select ok(to_regclass('public.follows') is not null, 'follows exists');
select ok(to_regclass('public.want_to_try') is not null, 'want_to_try exists');
select ok(to_regclass('public.user_stats') is not null, 'user_stats exists');
select ok(to_regclass('public.user_category_stats') is not null, 'user_category_stats exists');
select ok(to_regclass('public.streaks') is not null, 'streaks exists');
select ok(to_regclass('public.featured_bevs') is not null, 'featured_bevs exists');
select ok(to_regclass('public.feed_events') is not null, 'feed_events exists');
select ok(to_regclass('public.bev_reports') is not null, 'bev_reports exists');
select ok(to_regclass('public.user_bev_predictions') is not null, 'user_bev_predictions exists');
select ok(to_regclass('public.recommendation_jobs') is not null, 'recommendation_jobs exists');
select ok(to_regclass('public.user_actions') is not null, 'user_actions exists');
select ok(to_regclass('public.global_stats') is not null, 'global_stats exists');

select * from finish();
rollback;
