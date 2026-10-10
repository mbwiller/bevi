Speaker A: All right, great. So what we want to develop from start to finish is a platform almost identical to the Belly platform, but for beverages.
Speaker B: So for Belly, Belly essentially is trying to rate, like, different, different restaurants. It's like you go around a city on a map, like, there's a bunch of different restaurants. It's a way for you to, like, blindly rank things because, like, you don't give it a score. It asks if it's like, higher or lower than like, other restaurants, and then it ranks it on like some fuck, like some fuck ass calculation they do on the back.
Speaker A: No, and the thing is, the thing is, Claude, this algorithm is almost certainly online and open source somewhere. I can almost assure you that there's been some, like, random dude on Reddit that's like, hey, I built the Belly algorithm from start to finish. Like, this is probably open source somewhere on the Internet or, like, relatively trivial to do. I feel like a main component of what Belly's advantage is, is they have this entire database of restaurants that they know specifics about from people ranking them. And then restaurants can go in and pay them money to like, be promoted on their program. I'm assuming that's how their business model works in addition to, like a subscription platform. So this irrelevant, but I'm like, oh,
Speaker B: I've never, I've never seen you go so far deep in the song. I was like, wow, he's going
Speaker A: deep.
Speaker B: Which is probably their entire business model, which. Anyways, so implement the fucking algorithm that Belly uses during BEVs, essentially. How are we going to do this? So like I was saying earlier, Belly ranks restaurants. We're rating beverages, meaning we're rating, like, individual, like beverage products. Such as, like a can of Coca Cola is different than a can of diet Coca Cola. So get that straight, that this is for bevs and people will take a picture of their Bev. They'll either already be in our database of beverages that are very common and already exist and, like, are out there, or if they discover a Bev that's not already in the database, they can, you know, add a row in the fucking SQL queries saying new Bev and they put in the Bev name. So it would be like if, if Bev not in database, then add new Bev. And then with these parameters being like, name of the Bev, flavor of the
Speaker C: Bev,
Speaker B: and you just take a picture of the nutrition label or something like that.
Speaker A: And we want that to be on the icon of what the BEV is itself.
Speaker B: Yeah, yeah. What for? Missing Bev.
Speaker A: So a Bev in and of itself needs to be its own data structure that contains.
Speaker B: Right, yes, yes, yes, exactly.
Speaker A: Multiple things. Like, like we are saying it contains the label first and foremost, the photograph and name of the beverage itself.
Speaker B: Every beverage has to have a photograph with it that like, resolves the shit.
Speaker A: Yeah, yeah. And this. This can be gone. Like. Like try to get photos on the Internet that are like, similar in nature and have clear backgrounds. So if you find the clear background ones. So we don't want like square photos of beverages. We want like clear background, ideally. Oh, that would be tough. Later on, we'll incorporate the price into the equation. That would be tough. Or we can. No, no.
Speaker B: Okay.
Speaker A: To incorporate the price of the beverage. If it's not clearly known. Estimate it. If it. If it is known. You have four dollar signs at your disposal for every bev. So if it's like, you know, a Diet Coke, it's gonna be like one or two. It's probably gonna be one of the dollar signs. But if it's. If this is like, you know, horchata from, you know, creates place, then maybe it's like two of the dollars.
Speaker B: And if it's like, you know, like an alcoholic beverage, that's very, very expensive.
Speaker A: See, this is similar to how Google Maps enforces that feature where they have dollar signs corresponding that typically on average, how expensive a given restaurant is.
Speaker C: Yeah,
Speaker A: Well, in this. In. In a given beverage, like its data structure. So. Yeah, in we have name, nutrition, label, name, name, and photo nutrit. Like price range.
Speaker C: Yeah.
Speaker A: And then add variables of average score that it obtains. What else? Average score, standard deviation of the score. So then. Because then we can normalize the score.
Speaker B: Oh, really? Okay.
Speaker A: And then. Yeah, yeah, because. Because the way. The way I. I've seen Belly twice with Marcos, and the way I saw it, I've never used it in my life, but the way I saw it is you get a restaurant and then it's kind of like Tinder where you're going, like, yes or no.
Speaker C: Yeah, yeah.
Speaker B: There's like a. That's how you do the range.
Speaker A: The gamified food application using the similar gamified techniques that dating apps use.
Speaker C: Yeah, I.
Speaker A: With that. Yeah, Good for them, bro.
Speaker B: No, it's like a good app. Oh, okay. What Belly does too, is it predicts how much, like, how what you're rating of a certain beverage would be. So it'd be like people trying to discover new bevs. They go and they like search up certain Bev in the database and then they can see. We think you would like it like this out of 10. You know what I mean?
Speaker A: Yeah.
Speaker B: So it's like you can see, like.
Speaker A: Yeah. And. And to do that. Well, okay, let's talk. I think we need to make sure Claude is like doing the right math to do that.
Speaker C: Yeah.
Speaker A: So what I envision. Feel free to chime in. What I envision is we partition the beverages into certain types. Obviously, you have your sodas, you have your fruits, like fruit, fruit juices, you have like water, like sparkling waters. That type. There's numerous classes of Bev. And so you partition each of those and you assign like, similarity scores to. To how similar they are within a certain group.
Speaker B: Yeah, right.
Speaker C: Yeah. And.
Speaker A: And then because, because we also. And, and also add some randomness because we. Like, what I'm saying here is like, to start, we can just rank the beverages within groups so that if you try, like a beverage that's near another one in a group plus some air, we recommend it maybe.
Speaker B: Oh, because it's like similar. Similar rankings in that sense.
Speaker C: Yeah.
Speaker A: No, no, no. Okay, but like, we would want to add some ranking or. Or we just like assign them to try the best one of like the best in that group.
Speaker C: Yeah, yeah.
Speaker B: Of like an ADJ group. Right?
Speaker C: Yeah, yeah, yeah.
Speaker A: And then. So, so then. But since we've defined these groups, each user has now like an average that they've given each of these groups. Right? Like, not only are we getting the average, like the mean standard deviation of each beverage that's getting ranked, we're getting what the users themselves are ranking.
Speaker C: Yeah, yeah, yeah.
Speaker A: And so you can normalize that as well and then use that normalize component to recommend.
Speaker C: Yeah, yeah, yeah, Yeah.
Speaker A: Or we can do something else.
Speaker B: Claude, if you can find out some other. Like, it's. All it is is we're building like a recommendation system. Like, I'm sure you can find. Or I'm sure you know yourself how to build a recommendation system. Like, don't need to overcomplicate it with everything we're saying. We just need you to find a recommendation system that we can use so people can see what the next Recommended Bev would be. You know what I mean? We could just delete.
Speaker A: Bro, I was way surprised.
Speaker B: Okay, okay. In terms of ui, we want this to look kind of like exactly like Belly in a way that, like, there's a bunch of different tab, not a bunch of different. There's like your home tab. Oh, yeah, I have it, I have it.
Speaker A: We can include screenshots.
Speaker C: Yeah, yeah.
Speaker B: So there should be a feedback. Oh, do we have like friends.
Speaker C: No,
Speaker A: dude, this could be like a multi FV venture.
Speaker B: Yeah, it's gonna have to be. I'm not gonna lie.
Speaker A: This would be pretty sick.
Speaker B: Yeah. Okay. Okay.
Speaker A: We need to do this, bro. Yo, because this goes along with the bit so well. But it's also like we're adding sophist
Speaker B: like now. Okay.
Speaker A: It's like, it's like, all right, we built bed maps. Like, boom. Now we have a whole back end of users in our database. Yo, we need to pray that like Supabase or somebody has like a free ass gear.
Speaker B: 20 people, bro. Yeah, no, we're not even getting 20 fucking people.
Speaker A: We're absolutely getting at least like. No, no, but we should have the capacity for 20 people. Yeah, yeah, because we're gonna at least in GPT that are going to be hilarious. And you should also like advertise it, but. Because then that's how our algorithm works. You didn't think that would hit you. Otherwise it's gonna be Claude recommending random.
Speaker B: Yeah. Ass CL. Clock it.
Speaker A: Even if you are saying yo clock find a similarity score between like a Bev and something that you'd recommend next figure out on yourself then what's the point in having. If you use or rank the beverage like for other people.
Speaker B: No, no, the way the recommendation system should work is that like it. It gets all the data that we were thinking like with the. With beverage rankings and individual categories, but like it'll see how other people rank those categories and where they rank it. Like it's. It's gonna be like a multi layer recommendation system.
Speaker A: I see.
Speaker C: Yeah, yeah.
Speaker B: That just adds like another, like another thing to it.
Speaker A: Wait, okay, let me see Belly again.
Speaker C: Yeah.
Speaker A: So it's a feed. It's like a Venmo feed.
Speaker B: Yeah, yeah.
Speaker A: Featured. Featured BEVs will have featured BEVs that are like, we can. We can just give Claude some really cool, nice generated AI photos of BEVs. And then I use like similar font.
Speaker C: Yeah, yeah.
Speaker A: And then your lists. So this is in any individual users. Like back end information contains all of this. These rankings.
Speaker B: Like, yeah, these are just previous rankings.
Speaker A: And then search. Search feature for Bevs.
Speaker B: This is like you adding a Bev. Like instead of search, it should be like add Bev. And then this is where you do the whole process.
Speaker A: Yeah, but in that. Yeah, and that was a lot that you said. Like, if it's not in the system. Leaderboard is based on. Dude, I. This should be leaderboard for Bevs. Because dude, dude, they're. They don't do leaderboard for restaurants because like then it's just gonna show like preferentials or maybe, maybe they do have like the hottest restaurants this month. But yeah, they're not gonna do overall rankings. I feel like that would just be a little.
Speaker B: Dude.
Speaker A: Yeah, culturally, culturally, like I feel like that wouldn't, that wouldn't fit in.
Speaker B: Yeah, yeah, I agree with you.
Speaker A: And then, but for bevs it's irrelevant because it's best.
Speaker B: You can see like, like literally the best bet.
Speaker A: And then, and then, and then. And the user's profile page itself in the bottom right hand corner, this is one that we need to get aesthetically very well.
Speaker B: All right.
Speaker A: This contains the user's profile, right top left, their name, top center, a circle with their name and initials. And under it their, their handle tells like that they've been profile. Yeah, that's what I said.
Speaker C: Okay.
Speaker A: Shows their followers and following and their rank on Bevy. And it shows three tabs that say that you. You've Bev'd. And then it's a tab that has the number of Bevs that you've Bev'd.
Speaker C: Alright.
Speaker A: And it takes you to your list, right, that just redirects the page to our lists page. And then there's a want to try tab which also redirects your list, but it's a sub tab in the your lists tab that you want to try. And it's Bev's that you might save because you might see someone else got a certain Bev, maybe Jack got a certain type of Boba drink at a store and he got a photo of what it was on the menu and he added it or the name of it and took a photo of his Bev and adds it to Bevy. You know, maybe I want to try that beverage and I. So I save it in my list where it's want to try. And then in my profile there's a tab that says want to try? And it's the number that I want to try. And it redirects that page. And then lastly. And this goes into the recommendations. This is the most important page that we tie to in the profile is our algorithmic recommendations. And then it shows your rank on Bevy, your streak. We can have streak add anything else.
Speaker B: And then like your past rankings. Like a feed of your past rankings.
Speaker A: Yeah, that's scrollable below.
Speaker C: Yeah, yeah.
Speaker B: Whoa.
Speaker A: I clicked the tab and I was like, whoa, I'm supposed to see what their settings page looks like.
Speaker B: No,
Speaker A: We don't need no damn privacy page.
Speaker B: Are you taking the out of Your IP.
Speaker A: Man location. We got that off forever.
Speaker B: We sending bits to you, flipping you. All right, wait, are we good?
Speaker A: Anything else you want to add? This is probably going to be a multi stage, multi sub agent based task. I think that if we could initially look for mobile based UI design skills open on the Internet, that would probably be good. I think dividing this task up into sub agents and also for us into like two to three development phases would be good. Also it'd be really helpful if you outline like which models we should use for which tasks so that we can create claud MDs to ensure that like sub agents are deployed with the right model and they're not just like randomly deployed using a model with like extra high effort for a task that maybe needs just high effort or something like that. So we don't just chew up tokens.
Speaker C: Yeah, yeah,
Speaker B: I think we're good. Okay, so Claude, make a, like a project MD file.
Speaker A: Vision md.
Speaker B: Vision md.
Speaker A: And then, and then this. So this vision. So this is going to be in the conversation MD file.
Speaker C: Yeah, yeah.
Speaker A: And that conversation IMD file is going to be fed to create the vision IMD file.
Speaker C: Yeah, yeah.
Speaker A: And then we go from there.
Speaker B: It's bevy b e v I bevy make our, make our logo look like belly with a v. Okay.
Speaker A: All right, thank you very much.
