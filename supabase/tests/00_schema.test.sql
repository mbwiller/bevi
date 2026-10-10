begin;
select plan(19);

select has_table('public', 'categories');
select has_table('public', 'profiles');
select has_table('public', 'bevs');
select has_table('public', 'bev_aliases');
select has_table('public', 'bev_stats');
select has_table('public', 'rankings');
select has_table('public', 'comparisons');
select has_table('public', 'follows');
select has_table('public', 'want_to_try');
select has_table('public', 'user_stats');
select has_table('public', 'user_category_stats');
select has_table('public', 'streaks');
select has_table('public', 'featured_bevs');
select has_table('public', 'feed_events');
select has_table('public', 'bev_reports');
select has_table('public', 'user_bev_predictions');
select has_table('public', 'recommendation_jobs');
select has_table('public', 'user_actions');
select has_table('public', 'global_stats');

select * from finish();
rollback;
