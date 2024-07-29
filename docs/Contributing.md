# Contributing

This section of the documentation will give you what you need to know in order to contribute code to the repository.

## IDE

The standard is Visual Studio Code using the provided dev container configuration.  

## Collaboration

There are no super heros on the team.  The work we do is not individual but rather collective.  Often, it helps to work together with another contributor.  This might happen by each one contributing commits to the same branch, or by working together in a Live Share session.  In any case, it does not matter whose name is on the commit.  It is assumed that every line of code being contributed represents in some way a team effort.

## Code quality

Anyone contributing to this repository needs to think about quality, craftsmanship, and attention to detail.  The code that is accepted by the team and merged to `master`.  Therefore, `master` represents code that the team has accepted and owns.

When a Pull Request is raised, it must have already passed review by the contributor themselves.  (Unless it is a draft Pull Request, which is meant for discussion.)  The contributor is responsible for putting forward code of high quality.  Even details such as formatting and line breaks must be carefully aligned to standards.

Although we raise PR's in good faith with our best efforts, nobody is perfect and no one can reach the level of quality on their own that the team can reach together.  Therefore, the [review process](#reviews) is stringent.  Once code is merged to `master`, the team takes responsibility for it and any consequences that may happen because of bugs or mistakes.  The PR process is therefore not taken lightly.

Code quality is guided by the [documented coding standards](./Coding-standards.md) but it is more than a set of rules.  It results from a deep pride in the work we do, coupled by attention to detail and a passion for the art.

## Refactoring

> When debugging, novices insert corrective code; experts remove defective code.
― Richard Pattis

Code is constantly in the process of accumulating tech debt, despite the best intentions and best techniques.  We cannot prevent it entirely, but we can control it.  One important aspect of this is to be smart about refactoring.  When solving a problem, don't just try to make a correction.  Ask if the approach is correct. Can it be simplified?  Does the code reflect bad assumptions?  Focus on removing code, not adding it.  If you notice areas of complexity, take a moment to simplify them.  If you notice things that do not align with the [coding standards](./Coding-standards.md) then fix them.

One note about refactoring:  If you do work that is not directly related to the ticket you are working on, it is a smart move (and a kindness to the reviewer) to put this code into a separate commit.

## Coding workflow

See the [culture](./Culture.md) documentation for information about how culture influence our workflow.  Each member of the team is expected to be a professional, responsible for his own contributions.  This inherent trust is allows us to work as equals, and empowers individuals to make correct decisions about the code they contribute. 

### Tracking work

Work is divided into stories (issues) and tasks.  A story or issue describes _what_ needs to be done and represents a complete change in the system.  It has acceptance criteria and a description.  It results in value being added to the system. 

A story or issue has _tasks_.  Tasks are small chunks of work that can be independently implemented without breaking any existing functionality.  

When starting on a story or issue, cut a feature or bugfix branch in which to do the work.

### Coding (executing a task)

After cutting the branch...

1. Code something, adding both "production" code and tests.  Code as small a chunk as possible and write the tests along with it at the same time.  
2. Commit the code.  At the time you commit, the tests will run and coverage will be checked.  Fix any code coverage issues.  The commit hooks will not allow any commits where tests are not covering the code. 
3. Repeat until you come to a place where a task is complete. 

Remember, each commit should contain code that a) does not break anything and b) is fully covered by tests.  It is possible that in some cases, you might need to temporarily lower coverage or make other temporary changes as you implement the overall task.  Generally these should be removed before _merging_.  However, at times code must be left in a partial state between tasks.  Liberally use TODO's for such changes that are still to be done.  Use `TODO: #NNNNN <description>` with the issue or story number and a description of what needs to be done. 

Note:  The commit hooks and protocol is really designed to encourage a TDD approach to coding.  The tests will run with each commit, encouraging a) small and atomic changes and b) accompanying tests.  This will naturally tend to emerge from using TDD.

### Merging code

Code is merged into `master` by way of a pull request.  The pull request is a way of documenting the merge.  When you bring up the pull request, the *must review* this code before merging it (see the section below on [Reviews](#reviews)).  If the code passes the review, then feel free to merge it.    

When you merge code, various tests will potentially run.  Unit tests will run.  Generally these should pass since the commit hooks obligate you to run them.  After that, any functional tests will run (depending on the repo and where it fits into the overall system).  Any and all tests must result in a GREEN pipeline (all tests must pass).  If that is not the case (if a test fails), then the immediate and non-negotiable priority is to bring the pipeline back to a GREEN or passing state.  

Put another way, you will often merge work that is incomplete or features that are "dark" until a later date.  But you break something, must never never never allow the code in `master` to stay in a broken state.  You must _immediately_ *fix the problem or else revert the code*.  

After merging, continue working on the same branch.  This will help the _final reviewer_ to examine all the changes related to the same issue or story.  

### Resolving merge conflicts 

When merging happens often, conflicts are reduced to a minimal and are easier to resolve.  When conflicts occur, _merge `master` back to the work branch_.  

This might seem to be strange, but there is a specific reason for it.  Because the [final reviewer](#final-reviews)) will need to see all related changes.  Keeping the same branch with the original history will allow them to do so.  If we were to use rebasing, the history would be neater but the branch would lose track of changes that had already been merged.  

### Reviews

The typical PR process tends to create blockers and bureaucracy.  The review process protocol employed here focuses on a) not blocking coding b) personal responsibility.  

Reviews come in three different flavors:

#### Self reviews

As you are merging code via a pull request, you *must review your own code*.  When you do so, treat it as if it belongs to another person.  Review it meticulously and critically.  Be your own worst enemy.  Be the teammate you hate to work with because they are so picky.  

#### "Work in progress" reviews

Every team member should welcome feedback and actively seek it.  As you are working on a story or issue, you should be conscious of the need to invite others to review your code.  

Open a draft PR and tag a member of the team to review your code with you. Inform the person you need a review and then either get on a call together and walk through it doing the review in real time or else get an agreement with the person to do the review asynchronously.  Note that a review in real-time is preferable.  Nothing substitutes for a real conversation.  

In any case, feedback on the review should be document on the draft PR.  When complete, the contributor can then use the feedback to make changes to the code.  

You should request reviews often!

In addition to requested reviews, any team member should feel that they can review anyone else's code at any time.  Permission does not need to be requested.  In such a case, open a draft PR on the person's branch and provide the feedback.  However keep in mind that without good communication, you could be reviewing things that are in flux and may not represent what someone intends to finally merge. 

#### Final reviews

Before a story or issue can be complete, a final review should take place.  For very simple issues, this may not always be necessary.  The review process does not block _tasks_ but will block _features_ or _stories_.  

For the final review, bring up a draft PR and tag someone with it.  Generally the person tagged should be the maintainer of the repo.  There may be the need to iterate several times.  The final review finishes when the reviewer gives a LGTM. 

#### What to look for in a review 

Reviews look for things that cannot be caught by tests.  They should point out anything that needs to be changed, even if it is a small detail:

* Problems with logic
* Problems or concerns about complexity
* Suggestions about patterns or warnings about anti-patterns
* Suggestions about better ways to do things
* Suggestions about test cases that should be added.
* Suggestions about how to better align with the architecture and vision
* Coding standard suggestions
* Formatting suggestions.

All suggestions need to be carefully considered by the contributor.  They are welcome to make a case if they feel a suggestion should not be applied.  But in action for or against should have a basis.  If no agreement can be reached, then the repo maintainer can be called to help resolve the matter.

Some suggestions might be of such low importance that they could be skipped if no more changes are to be made because of weightier suggestions.  These can be prepended by `nit: ` by the reviewer.  Example:  `nit:  Remove extra line`

### Git history

History should be orderly and neat.  It should be organized in a way that makes it easy for a reviewer to understand the changes.  We officially use [conventional commits](https://www.conventionalcommits.org/en/v1.0.0/) to standardize the commit messages and commit hooks are in place in each repo to assist with compliance to the standard.  Here is a [handy cheat sheet](https://gist.github.com/qoomon/5dfcdf8eec66a051ecd85625518cfd13) to help you.

Generally speaking, each commit should be as small as possible and reasonable, and represent a complete change that can be reviewed independently. In any case, _always think about the reviewer_ and do to others as you would like to have them to do you.

As a final note, if you do not understand git well then you _must_ ask questions and learn how to use it properly.  It can be a bit difficult to understand sometimes; we've all been there.  Simply guessing will result in a mess and is not a good idea.

## Leave your ego at the door

It can be hard to have someone critique code that we have poured our heart into writing.  A sense of craftsmanship will often bring along with it a passion for the work.  That is fine.  But we have to be ready to accept even outright criticism of our code without getting offended.  Comments in PR's should never be insulting, but they can be direct and to the point.  This means that all contributors must be honest and leave their egos out of it.

## See also

* [Coding standards](./Coding-standards.md)
