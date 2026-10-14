<!--
Raw transcript of the second Bevi planning session (2026-10-14), recorded after both of us used
the launched app for a few days and after Arjun collected outside feedback. It is kept verbatim,
like CONVERSATION.md (the founding session that produced vision.md). This one produced TASKS.md
(the split task list) and docs/bevi-ranking-math.tex (the scoring and recommendation maths).
-->

Speaker A: Oh, all right, all right, so continue what you're saying. No, I'm saying. All right, you have the map functionality that you filter based on the user selecting, like three categories of BEVs or five categories of BEVs. So if they decide to select sodas, for example, those are going to be a lot more common and so their map is going to be a lot more populated, a lot more scattered. Because a lot of places have soda.
Speaker B: Yeah, yeah.
Speaker A: And so what we do, we can separate it by bev category. We could also separate it by retailer. So you have like your duane reads and CVS's and targets that have, like, they have a subset of BEVs. Like, they're always gonna have Gatorades, Red Bulls, you know, like Cokes, Pepsi's, they're gonna have more soda.
Speaker B: Focus.
Speaker A: Whereas what I was saying is the real, the real value comes when you have a user that's really into coffees and like stylistic lattes or cocktails or, you know, like more unique bevs that are more artistic, craft driven. This would be a great product studio topic for how might we improve access to art, bro. But you filter. You filter some way and that's the map that's shown. And then we iterate on bed maps as a button that's located somewhere cleanly on the same page as the map itself.
Speaker B: Like a fine.
Speaker A: Yeah, yeah, like, kind of just like a fine bet button on the. The map screen somewhere.
Speaker B: And then, and then what we can do
Speaker A: is. I wonder how expensive this would be is. Every user, we just like, learn more about their bed preference and so then they can just have a feature where you know how Spotify has like the smart shuffle. Yeah, it can just be smart recommends and it's based on the beverages that you've ranked. So if you have enough and you as a user are comfortable doing smart recommend, then you throw that shit on and then the map is populated only with, like, spots that we would recommend you try.
Speaker B: But don't we already have a list of recommended.
Speaker A: We just have a list of beverages. Like the recommended. Yeah, the recommended functionality. I don't really know, like, exactly how
Speaker B: it works, but I kind of do like that. But I almost want to, like, challenge that. That might be like, too complicated in the terms that it might overwhelm the user. I feel like we can't keep throwing at that bevy and like, thinking it's gonna still look good. At a certain point we reach the, like, bottleneck of, like, crazy.
Speaker A: Too many features.
Speaker B: Yeah, too many features. And like it, like being functional and like you being able to use it.
Speaker A: Yeah, very fair. All right, so in terms of like. Like, I think we should. We should break down this conversation into topics that we think like and then we discuss them in the order that we list. So I think the first should be like external feedback. The second should be like our experience and immediate changes we want. Similar to that is we're going to talk about the UI UX in its own category. Just getting more granular with like what we exactly want to be shown right now. And then we wanna. Should we talk about additional functionalities we want or like this should just be like the next, Next. Next generation of Bevy?
Speaker B: Yeah, yeah. Okay.
Speaker A: This should be an exhaust conversation.
Speaker B: Yeah, yeah, yeah, yeah. Let me see what we text each other.
Speaker A: Additional features. Anything else?
Speaker B: Does Betty have a map feature? Like a.
Speaker A: Like maps where like it directs you
Speaker B: to the place that you're trying to go?
Speaker A: That's what bed maps is.
Speaker B: Okay.
Speaker A: But no, we don't have. So that's, that's what I think. I think I'm gonna add that after. External feedback is like. No, that's additional features, like once you click on.
Speaker B: But.
Speaker A: But I think we need to talk about like what is stored in the database.
Speaker B: Yeah.
Speaker A: And I don't know if like. And then, and then let's like granular response.
Speaker B: Scoring
Speaker A: algorithms. Slash. Features.
Speaker B: Yeah, the ranking. Right. Wait, talk about nutrition label too. All right, I guess that's additional features, right?
Speaker A: Yeah, additional features. So we'll add additional features. Maps and nutrition. Yeah. Anything else? Like Bev maps integration.
Speaker B: Right.
Speaker A: Okay. So that you know, so that Claude knows. Here are the topics. Number one, external feedback. Number two, our experience and immediate changes. We want. Number three, user interface. User experience. Number four, additional features which include maps, nutrition label, Bev maps integration. Those three points. Number five, what is stored in the database per user. And then number six, granular response about the scoring algorithms. Slash rankings. So from the top, what's the. Do you like this organization?
Speaker B: Yeah, but I think we're going to realize things like going on, which is fine.
Speaker A: Yeah, yeah. But I think overall, like we should in this conversation hit on each of these Topics.
Speaker B: Yeah, yeah. 100.
Speaker A: If you want to go out of order, it's. It's also totally fine.
Speaker B: Okay, wait, what do you mean by external feedback?
Speaker A: Like the, the whatever you gathered from Anisha?
Speaker B: Okay, yeah, so what I gathered and
Speaker A: I have some things I want to say.
Speaker B: To me, it's like. And like. Okay, the first, first of all, I don't think that they. Like, Anisha was saying that she doesn't. Or Jot and Raya were saying they don't use Belly to find drinks. Like simply food.
Speaker A: Yo. But I saw some people on Belly posting drinks.
Speaker B: Yeah. And then Anisha said she does, but she said like, not as much, obviously. So I think this, the market that we're in, like, could be very good. Like we could exploit something that's like very low on like Belly users on their minds. Right, right, right, absolutely. And then like continuing off of that, one thing I, I noticed was like, Anisha, bro, she might just be a brick. Or like she had a really hard time deciding like, like she didn't like the idea of like you ranking against like other types of devs. I mean, other types of like food cuisines. So it's like she was like, oh, I'd always take like mid Indian food over top tier American food.
Speaker A: Because that was the point I saw in the text.
Speaker B: Yeah, yeah, yeah, yeah.
Speaker A: Oh, that's such a great point. So we is defining categories.
Speaker B: Yeah, we need to find categories and find adjacent bevs that you've ranked. It has. That's like the top priority in that ranking system of the first things you rank it against. Right. You need.
Speaker A: So if, for example, if you get like a latte from Starbucks and then you go to like some craft coffee place in New York City that has some like, niche, like. Yeah, yeah, 12 matcha.
Speaker B: Those are two.
Speaker A: You know, those are two. No, but like it's still a cafe. But you're saying like, no, that that needs. So if it's like similar types of bevs. Like for example, you're ranking mochas against other mochas. Matches against other.
Speaker B: Yeah, yeah. It has to be that.
Speaker A: Okay, but that is like as you're going through the database, it's like if Bev in category.
Speaker B: Yeah, yeah. That's how then this database got to be.
Speaker A: Then populate those like user input decisions first. Else, like, do we have adjacent categories where we assign. Yeah, so we have like some ML model assigned similarity scores.
Speaker B: It's like, it'll be like hierarchical categories. Right. So it'd be like cafe would be like. Yeah. And then it would be like hot, cold. Right. And then in hot it would be like subcategories like that.
Speaker A: That's. You know what I think we do. Instead we have our. No, this. Okay. We have our bevs in a graph database.
Speaker B: Exactly, exactly. Yeah. And then each one of those holds a weight and like one like, you know, you know the ones that like they have these.
Speaker A: Yes, yes, yes, do that.
Speaker B: Let's do that.
Speaker A: Understand that.
Speaker B: Yeah.
Speaker A: Facts, facts. Yo, I'm not going to be big. Oh, my mom. That cliffy.
Speaker B: Oh. All right, continue.
Speaker A: All right, next one is probably the most important part of the conversation. This is topic 2. Our experience and immediate changes we want. So nothing better than. Than to go to the Bevy app itself. First and foremost, this was a comment I feel like we both had is when you're saving a beverage, it should not be on the feed. All right. Like this should just. You should just see if a similar beverage pops up that you have it saved. It shouldn't be something that multiple users see on the feed. You know, do you think it should be on an individual user's page or. No, I don't think. I don't think saving a beverage warrants being on the.
Speaker B: No, no, we should get rid of that 100.
Speaker A: All right. And staying on the topic of the feed itself, feel free to chime in. What we need to add is the ability to like posts comments and send non, maybe not liking comments in like specifically. And I want the like to be identified identical to Instagram likes.
Speaker B: And the fact like the UI component of you pressing it and it.
Speaker A: Or you can double tap the screen.
Speaker B: Oh, I like double tap.
Speaker A: You know, like, I like that. That is very necessary. And this, this component needs to be very seamless. This, this liking only applies to like comments or like if people post a picture of their bet, but most importantly people posting a picture of their bed.
Speaker B: Yeah. And then for the likes, we want the heart color to be the same purple as the Bevy logo and the adv logo.
Speaker A: Yeah, absolutely.
Speaker B: And
Speaker A: that is like linear on the screen with the comment button. That is exactly like the Instagram comment button. And this then opens up like a very clean ui, like multi user comment section type review. But it's not one of those comment sections that you have to like click to expand. Unless it's like 10. The seven messages. Seven plus messages. After seven messages, click to expand. And anything specifically about like how the feed looks.
Speaker B: I think, I mean should there be,
Speaker A: should there be like a global and your friends?
Speaker B: No, I should have just be friends. Why would we have a global, Woody? I mean like a, like an explorer.
Speaker A: You know how Venmo has that where it's like one. No, no, but. Well, I think they have like person like one connection away or like two connections away from you. So like a friend. Yeah, yeah.
Speaker B: Okay.
Speaker A: And so, so, so. And that is populated. That's. That is in our system populated by bevs that are getting the Most likes.
Speaker B: Yes.
Speaker A: You know, popular beds and then more people. Like the Bevs.
Speaker B: Yeah, the higher it is on that. Higher the global ranking. On the global ranking. Bevs. Okay, okay, okay. Or like, the population ranking.
Speaker A: But. But that's also. No, no, but that's also. Yo, Bev of the day.
Speaker B: That should be, like, the top thing on the top.
Speaker A: Yo, on the feed, there needs to be Bev of the day and Bev of the area and Bev of the week. So, like, for New York City, if.
Speaker B: If there's like.
Speaker A: Oh, there's a certain. No, no, we're. We're staying with New York City.
Speaker B: This is nyc, bro.
Speaker A: This is strictly New York City. Like. Yeah, yeah, yeah. And. All right, so I'm thinking at the top of the feed. Hear me out, bro. Lock in. All right.
Speaker B: Wait. Yeah, yeah. I. John. John, them are baking cookies, and, like. Oh, that's how they're gonna run out. So I was just saying, like, it's calm because this is more important.
Speaker A: All right, Two. Two, like, components, side by side. At the top of the feed. Bev of the day, Bev of the week.
Speaker B: Okay, okay, okay.
Speaker A: That's at the top of the feed below. Search of Bever person. Yeah, yeah, yeah.
Speaker B: Wait, I was thinking. I was thinking, imagine on the global page, Bev of the day is, like, the first post, and Bev of the week is a post afterwards. I think having two things might make this look like a really messy feed. I kind of like how simple. It's just like, your feed and you scroll it. Like, I don't. I don't know about having. No, no, no.
Speaker A: It's. It's just the Bev itself. Like.
Speaker B: Oh, like, not the.
Speaker A: Yeah, not. Not a post. Cuz you know how we have leaderboards for Bevs?
Speaker B: Yeah, yeah, yeah.
Speaker A: We do that on, like, a daily. Weekly basis. Like, whatever. This is simply equal to, like, for the day. Like, Bev with max score is Bev of the day. Yeah, yeah, but we can. We can further refine that to Bevs ranked that day.
Speaker B: Yeah, I think it should be that.
Speaker A: Yeah. So Bevs ranked that day are held for the day. Right. Because we're gonna have the rankings each day in our database of all Bevs that get stored.
Speaker B: Right? Yeah.
Speaker A: And we're just creating this, like, ongoing matrix, I guess.
Speaker B: Exactly. And
Speaker A: so. So the ASP of the day, same logic for Bev of the week on a weekly basis. And then I'm saying just the Bev, like. Like, think like this with the name underneath this little, like, Bev card or photo like that, like. Dude, did you see this?
Speaker B: That is tough, bro.
Speaker A: This loading page, bro.
Speaker B: What kind of car that is? I a. Yeah, that's.
Speaker A: Got the nutrition label.
Speaker B: Oh, you added that?
Speaker A: Dude, dude, no, it's just like I. Yeah, yeah, yeah, that's what. It's sore. It's like per post.
Speaker B: That's fine.
Speaker A: That was like a. That was a real honest like input into the system. Same with this Mexican coke that I dead ass. Bev said shit's busting. And that is really honestly. And this is what Claude needs to hear as well. That's what makes me number one on Bevy. I'm the number one Bevy user in the world. Genuinely. I'm the number one. Look at this, look at this. I'm the number one BevY user in the world. I have a two day streak. I have 12 points, bro.
Speaker B: Who are you? I gotta get my Bevy up.
Speaker A: Wait.
Speaker B: Okay.
Speaker A: On that note, I really like the user page.
Speaker B: Yeah, I think it looks gas.
Speaker A: User page looks great. I think, like, do you think anything with like the font sizes? I think this looks great. Leaderboard. I think, I think we need to add icons here. People. I don't really know what leaderboard of people is. This is probably just the points like that are arbitrarily.
Speaker B: This one should. I agree. We should have icon of the guest of the Bev.
Speaker A: And this, this score should be like.
Speaker B: I lowkey don't like how the score looks because of the like purple thing on it.
Speaker A: Like, I feel like that's like two people voted and.
Speaker B: Okay.
Speaker A: What we also need to understand is what the. This number comes up with because
Speaker B: what do you rate it like?
Speaker A: Dude? All right, listen. I rated it a 7 6. You rated it like lower. Is it just the average? Check what you did.
Speaker B: Yeah, I am, I am. It says 2.0.
Speaker A: Okay. Okay. Well, 9.6 divided by 2 is not 5.9. So that's what I was saying. I think it's, it's. It's weighed by your ranking on the leaderboard, which is interesting. We just need Claude to tell us what that, what, what the logic there is.
Speaker B: Yeah.
Speaker A: And then the. Your list. This needs like a significant enhancement. This needs to be a little bit more gamified, I think.
Speaker B: Really? I feel like it like this looks like what Belly looks like.
Speaker A: Yeah, dude, we're trying to do better than Belly, bro.
Speaker B: Like, how would you make this better?
Speaker A: Like the Bevs that you've Bev'd, bro, I think that there's like numerous ways you can like make this better. I think having like icons for sure. Like that you're collecting something like that. You know, we have categories that are constantly growing and like, you know, if it gets to it, we can just tell users like, oh, you know, you've tried this percentage of BEVs in this category, like, etc.
Speaker B: Yeah, yeah, yeah, yeah. Like a graph of bevs, you can really represent data in a lot of ways. You just have to find a good one.
Speaker A: Like if there was the icon to
Speaker B: this, I think the icons would make.
Speaker A: I think, yeah, just adding icons to this. What is it? Store by Score recent. When you press on the, your lists, when you press on the name Score recent, the page fluctuates. It like shoots down.
Speaker B: It shoots to the bottom of the scroll bar. Yeah.
Speaker A: So that, that needs to be a much more seamless button. These look fine. You can click on them. A lot of FS categories want to try save, recommend like this. We need to know how the recommendation system is.
Speaker B: Yeah.
Speaker A: Add Bev needs a good amount of changing. This seems to be a lot more seamless. Right. Like when you search a Bev, I think there should be a miniature icon of the Bev in the corner. And that's why we need to add branding to our, our image creation. That's why I think one day we like deploy a bunch of sub agents that create these little icons. We create a skill to make, we make one really good icon. We create a skill to make the icons and we replicate it and we just like, and we just like, like, we just have like, we can even like have Claude just find photos from the web. I feel like manually doing that would be a. Yeah. For every Bev though.
Speaker B: I like icons more than photos though. But you're saying photos to like see what the bed looks like.
Speaker A: No, I think, I think like when you post a bev on the feeder, when you search for a Bev, it should show the icon of the Bev. And for example, like the Mexican cola here is a, is like a soda can when in reality it's a glass bottle.
Speaker B: Oh yeah, yeah.
Speaker A: You know, like stuff like that. We need to be more intricate about the animations of the bevs that we have.
Speaker B: Do you think like, okay, how deep in this should we get of the fact that like you can consume bevs in different, like in different transportation modes of cans. Meaning like you can get a can, you can get a glass bottle, you can get a, a plastic water or a plastic bottle. Like do those, should those be treated as different bevs? John Paul, what do you Think.
Speaker A: Should those be different Bevs plastic bottle versus, like.
Speaker B: Yeah. Are we getting, like, too deep?
Speaker A: I don't think they should be treated as different bread.
Speaker B: Okay. No, no.
Speaker A: Coca Cola is Coca Cola. And you can input how. How large it was. Like, actually, we don't even need to input the fluid ounces. You can just say, like, I bev the Coca Cola, and that's that. If you bev a Mexican Coca Cola, it's a glass bottle, though.
Speaker B: Oh, yeah.
Speaker A: Those are independent bets.
Speaker B: Wait, but, like, in my opinion, my question. My question is different. Like, for Coke, should Coke always be in that? Like, for. For Cokes that are not Mexican Coke?
Speaker A: I think, like, what.
Speaker B: What would warrant, like, a different type?
Speaker A: Like, I. I like this. I like this Coke. Yeah.
Speaker B: Okay, so, but, like, do you think if someone drink it out, like, imagine they. They Bev. They took a picture of it and it was like, in, like, regular Coke in a glass bottle. How do we, like, you know.
Speaker A: No, that's why this is the icon with Bev. It's like you Bev Coca Cola. And somewhere, like, smaller, there's an icon like this. And then you either post a photo or you don't.
Speaker B: Okay, but like, the. You're saying the icon should stay the same for Cokes that are getting dabbed
Speaker A: in different things, you know?
Speaker B: Wait, no, never mind there. Logi Stride company. All right.
Speaker A: Anything else?
Speaker B: Are you going back in?
Speaker A: Yeah, I'm, like, really cool. All right, we'll be. We'll be in a sec, bro.
Speaker B: All right.
Speaker A: Anything else you want to add?
Speaker B: I think that's good for now. And I think we should have another FBA for V, like, four or whatever. Whatever.
Speaker A: Yeah. UIux. Like, do you like the theme and everything?
Speaker B: I think it looked. I genuinely think it looks really nice.
Speaker A: Yeah, me too.
Speaker B: I really.
Speaker A: I just think, like, we can make the. I think we can make the list and feed, like, less. Like, more aesthetic, less crowded.
Speaker B: Yeah, I agree.
Speaker A: I think. I think just, like, you know, with the dollars, like, them all having approximate,
Speaker B: like, it's a lot of info.
Speaker A: Yeah. And it's just not, like, laid out very cleanly. I also think, like, the Add Bev button, where it's like, you know, loved it, liked it, hated it, or whatever. Those buttons are just kind of. They stick out a lot.
Speaker B: Yeah.
Speaker A: And they need to change because I don't know if we can get the Glass Morphism UI unless we're doing this, like, Apple developer route.
Speaker B: Yeah.
Speaker A: So I think. Yeah, I think more important part is another thing that we should. All right. Look at this. Here's. Here's like the system.
Speaker B: All right.
Speaker A: Like kombucha, let's say. Yeah. I had one of these. Loved it. Right? This UI is like. Which is better? Do you like the way that this looks? Do you like how these buttons work?
Speaker B: I like them.
Speaker A: Do you like. I honestly like that better.
Speaker B: I think this honestly looks great.
Speaker A: Do you like to add a note?
Speaker B: Yeah, yeah, I do.
Speaker A: I don't think tells you the score. I think when it tells you the score, it should. It should show the number and, like, animates a little bit.
Speaker B: Yeah, yeah. It's like pulling a little bit, right?
Speaker A: Look at this, bro. Searching for Bevs is amazing.
Speaker B: All right.
Speaker A: I think that's it for UI UX for this time. Additional features. Maps. So where do we want to add maps?
Speaker B: I mean, I. I think it has to be in, like, recommended, right? Like, maybe it's like a button that says Find Bev on the top.
Speaker A: On the feed. Or no, no, no, no, no.
Speaker B: Maybe on Explore, you're exploring above.
Speaker A: Where's Explore?
Speaker B: Or go to feed. Wait, I think. Okay. I think it should. Wait, wait.
Speaker A: In. In Add Bev, we can say like, search for Bev. This already has you filter for Bev to add the Bev. But, like, what if we change this from Add Bev to, like, what do they. They have. There's a search, and you just search the Bev. Instead of Add Bev, it's Search, and then we have like a tab that's the map. And so we have Bev's people maps, right?
Speaker B: Yeah. And then like, maps just says, like, find a bed.
Speaker A: Yeah, no, no. And maps is a map of New York City that has like, okay, the. The markers for, like, where spots are like this.
Speaker B: Yeah, yeah.
Speaker A: And we should include screenshots because yours is probably more advanced than mine. You should include screenshots of, like, what it looks like when those places are open and popular on the map. And this is the filtering we were talking about.
Speaker B: Yeah,
Speaker A: but that's their sports.
Speaker B: Wait, and then, like, after you get into the map, should there be like a button? Find Bev. Like, you're on a map. You're on the bed.
Speaker A: Yeah, yeah, yeah. Then it takes you to bed maps. It should be like this. But, you know, find that.
Speaker B: Yeah. Wait. I kind of liked it. I kind of think it could be cool if it was like, you know how fine BET has this. But this iconic button. Imagine we just put that, like, smack
Speaker A: right there o that. I really like that button, bro.
Speaker B: Yeah.
Speaker A: Wholesome factory.
Speaker B: What the Is that.
Speaker A: Hey, where is that bed?
Speaker B: Yo? Bed maps.
Speaker A: Trying to get me killed?
Speaker B: Imagine Bev maps as a setup, bro.
Speaker A: Okay, Nutrition label. How do we want that handle? I think we make open source LLM calls to free or cheap models that. That process the images. Some cheap VLM that can process nutrition labels. Because I guarantee there's a really cheap free open source one that exists.
Speaker B: Yeah, yeah.
Speaker A: And then that takes the photo of the nutrition label and populates the nutrition of the beverage itself. That's broken up then. Then it's broken up by, you know, like volume. So only in the nutrition is it really broken up into volume. And that and the calories and the nutrition are just for the user themselves to see, right?
Speaker B: Yeah, yeah, yeah, exactly.
Speaker A: Like, there's no. And then we can add nutrition components to the platform eventually if I'm keeping this quiet so it doesn't work. Yeah, wouldn't that be tough? Bev maps integration. What we just talked about looking into integrating Bev maps initially as a button, you know, like towards the bottom of the map. And that button being like really? Exactly. The button we currently have, which is really amazingly aesthetic. Glassmorphic button. Great. What is stored in the database for a user? Well, let's. Instead of talking about what is stored in the database, let's talk about what's not stored that needs to be stored.
Speaker B: Yeah, yeah. You don't. Yeah. Wait, what do we. Okay, yeah.
Speaker A: What do we not store that you want to have? What is Taste Profile and why is it coming?
Speaker B: Yeah. Yo, can we get rid of Taste profile
Speaker A: or wait, no, I feel like we don't get rid of taste, but profile should.
Speaker B: Taste profile be like you like this kind of drink more than other kind of drinks. Like you prefer these kind of drinks. It could be like that. Like.
Speaker A: Wait, wait, should we. I think, I think that this should just be like binary of like whether you've had a Bev or not, rather than like the number of times you've had a Bev. So if you've already drank Coke, then you input it once, you know.
Speaker B: Yeah, yeah, no, I agree with you, but I'm saying taste profile could be like your average score of cafe drinks could be this number out of 10. And like that could be your profile. Profile meaning like your. Your taste of like different types of drinks.
Speaker A: Yeah, yeah.
Speaker B: So like that could literally just be like us calling our. Our graph. Our graph database.
Speaker A: Yeah, but this, the problem is this graph database might grow pretty large if people input bevs like that are similar into like different names. Right? Like someone like Inputting a new name of a Bev that's like the same as some other name. Oh, but there's two components within. Yeah, like a duplicate. But that's why we have photos.
Speaker B: Yeah, we. We need to get enough like unique identifiers to like see if two things are duplicates or not and then we can just like have a flagging duplicate Bev thing. So like.
Speaker A: Yeah, What else? I think another thing that's like a very minor change is the UI in dark mode. The top of the screen is still white.
Speaker B: Yeah, yeah.
Speaker A: Like near the navbar or whatever. Not navbar, like the top button thing. The camera on iPhone the top of the screen is white so it needs to shift with the system. Scoring algorithms ranking. Yeah. I think with this be really nice if Claude could like design a markdown file. It's honestly like oh no, instead of a markdown file, please design a latex document describing the algorithm. Yeah, I think a latex document that outlines it mathematically is exactly what we need.
Speaker B: Yeah, yeah. We need to fully understand what math it's doing to actually verify and we can carry out with this type of algorithm.
Speaker A: And this needs to be in the format of like academics doing research, like that type of.
Speaker B: Yeah, yeah.
Speaker A: Like very educational.
Speaker B: Like.
Speaker A: Yeah, yeah. Proof based but also just outline all the mathematics that are used and what you know that includes like what we are thinking about further implementing as well. That's different from what's currently present anyways that we needed to granular document. I think that's the full conversation. Good.
Speaker B: Yeah.
