# Contributing

This section of the documentation will give you what you need to know in order to contribute code to the repository.

## IDE

The standard is Visual Studio Code using the provided dev container configuration.  

## Collaboration

There are no super heros on the team.  The work we do is not individual but rather collective.  Often, it helps to work together with another contributor.  This might happen by each one contributing commits to the same branch, or by working together in a Live Share session.  In any case, it does not matter whose name is on the commit.  It is assumed that every line of code being contributed represents in some way a team effort.

## Code quality

Anyone contributing to this repository needs to think about quality, craftsmanship, and attention to detail.  

When a Pull Request is raised, it must have already passed review by the contributor themselves.  (Unless it is a draft Pull Request, which is meant for discussion.)  The contributor is responsible for putting forward code of high quality.  Even details such as formatting and line breaks must be carefully aligned to standards.

Although we raise PR's in good faith with our best efforts, nobody is perfect and no one can reach the level of quality on their own that the team can reach together.  Therefore, the [review process](#reviews) is stringent.  Once code is merged to `master`, the team takes responsibility for it and any consequences that may happen because of bugs or mistakes.  So everyone has the right to review code and to contribute toward it's quality. 

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

When starting on a story or issue, cut a feature or bugfix branch in which to do the work.  Generally, you will continue to use that same branch until the feature is complete.  When merging, retain the branch until the feature is complete.  Note that if the branch gets deleted from the remote, it's not big deal.  It will be created again when you push.  **The key is that the branch must be there until the [final review](#final-reviews-and-progressive-reviews)**

### Coding (executing a task)

After cutting the branch...

1. Code something, adding both "production" code and tests.  Code as small a chunk as possible and write the tests along with it at the same time.  
2. Commit the code.  At the time you commit, the tests will run and coverage will be checked.  Fix any code coverage issues.  The commit hooks will not allow any commits where tests are not covering the code. 
3. Repeat until you come to a place where a task is complete. 

Remember, each commit should contain code that a) does not break anything and b) is fully covered by tests.  It is possible that in some cases, you might need to temporarily lower coverage or make other temporary changes as you implement the overall task.  Generally these should be removed before _merging_.  However, at times code must be left in a partial state between tasks.  Liberally use TODO's for such changes that are still to be done.  Use `TODO: #NNNNN <description>` with the issue or story number and a description of what needs to be done. 

Note:  The commit hooks and protocol is really designed to encourage a TDD approach to coding.  The tests will run with each commit, encouraging a) small and atomic changes and b) accompanying tests.  This will naturally tend to emerge from using TDD.  However, if you are not using TDD, you will need to be disciplined about writing tests.  The commit hooks will not allow you to commit without tests.

### Merging code

Code is merged into `master` by way of a pull request.  The pull request is a way of documenting the merge.  When you bring up the pull request, the *must review* this code yourself as a first step (see the section below on [Reviews](#reviews)).  

Regarding whether you can simply approve your own PR and merge it will depend on a few factors.  In this, your best judgement as a professional is key.  

Generally, get a review of your code synchronously by pulling someone it to review your code with you together in a conversation.  If no-one is available or this is not possible, get an agreement with someone to review your code within the next few hours.  If this is not possible, then you can merge the code yourself.  In such a case, get a review asynchronously as soon as possible.  In other words, you can merge the code and proceed, but the review must happen. 

So to summarize:
1. It is preferred to review code synchronously and in real time with another team member.
2. If that is not possible, then get an agreement to review the code asynchronously.
3. If that is not possible, then you can merge the code yourself.  But you must get a review as soon as possible.
4. If the changes are small and fairly trivial, you can opt to skip the review.  If you merge code without a review, you must be prepared to answer for this decision.

When you merge code, various tests will potentially run.  Unit tests will run.  Generally these should pass since the commit hooks obligate you to run them.  After that, any functional tests will run (depending on the repo and where it fits into the overall system).  Any and all tests must result in a GREEN pipeline (all tests must pass).  If that is not the case (if a test fails), then the immediate and non-negotiable priority is to bring the pipeline back to a GREEN or passing state.  

Put another way, you will often merge work that is incomplete or features that are "dark" until a later date.  But you break something, must never never never allow the code in `master` to stay in a broken state.  You must _immediately_ *fix the problem or else revert the code*.  In fact, broken code in `master` becomes the problem of the entire team.  So a RED state is disruptive and must be fixed immediately.

After merging, **continue working on the same branch**.  This will help the _final reviewer_ to examine all the changes related to the same issue or story.  **Do not delete the branch until the [final review](#final-reviews-and-progressive-reviews) is complete**

Obviously, this means that some features will be shipped "dark" because code for those changes could get into production well ahead of the the feature being fully ready.  This takes us back to the absolutely non-negotiable rule:  Never break anything existing.  

The other piece that is necessary at times in order to ship dark is the use of _feature flags_ that can control when something becomes visible to the user.  See the [section on feature flags](#feature-flags) for more information. 

**IMPORTANT NOTE ABOUT MERGE MESSAGES!!!**
When merging a PR, you **must** ensure the title (and therefore the merge message) follows the standard for [conventional commits](#conventional-commits).  

### Resolving merge conflicts 

When merging happens often, conflicts are reduced to a minimal and are easier to resolve.  When conflicts occur, _merge `master` back to the work branch_.  

This might seem to be strange, but there is a specific reason for it.  Because the [final reviewer](#final-reviews)) will need to see all related changes.  Keeping the same branch with the original history will allow them to do so.  If we were to use rebasing, the history would be neater but the branch would lose track of changes that had already been merged.  

### Reviews

The typical PR process tends to create blockers and bureaucracy.  The review process protocol employed here focuses on a) not blocking coding b) personal responsibility.  

Reviews come in different flavors:

#### Self reviews

As you bring up pull requests, you *must review your own code*.  When you do so, treat it as if it belongs to another person.  Review it meticulously and critically.  Be your own worst enemy.  Be the teammate you hate to work with because they are so picky.  

#### PR reviews (i.e., task-oriented reviews)

Every team member should welcome feedback and actively seek it.  As you are working on a story or issue, you should be conscious of the need to invite others to review your code.  

Generally speaking you will want to have someone review your code with each PR.  You can also open a draft PR and ask a member of the team to review your code with you. Inform the person you need a review and then either get on a call together and walk through it doing the review in real time or else get an agreement with the person to do the review asynchronously.  Note that a review in real-time is preferable.  Nothing substitutes for a real conversation.  

In any case, feedback on the review should be documented on the draft PR.  When complete, the contributor can then use the feedback to make changes to the code.  

Note that a distinguishing feature of these reviews is that they concentrate on the _task_ being done, not on the whole body of changes in the story or issue.  Reviews that look at all the changes together are [final reviews or "progressive" reviews](#final-reviews-and-progressive-reviews).

You should request reviews often!

In addition to requested reviews, any team member should feel that they can review anyone else's code at any time.  Permission does not need to be requested.  In such a case, open a draft PR on the person's branch and provide the feedback.  However keep in mind that without good communication, you could be reviewing things that are in flux and may not represent what someone intends to finally merge. 

#### "Pulse" reviews

Work that is done across all repos should be reviewed on a daily basis.  These reviews are not as deep obviously and are meant to keep a finger on the "pulse" of the project.  For this, some tooling has been created to get a snapshot of all changes that have occurred recently in all repos.  This is a good way to keep up with what is happening in the project.

Generally speaking this type of review will be done by whoever is acting as the lead engineer at the time.  However, any team member can do this type of review. 

If a reviewer notices something on one of these reviews, generally he will bring it up directly to the person.  He might also bring up a draft PR and tag the person with it.  This is a way to keep the process moving forward. 

#### Final reviews and "progressive" reviews

Before a story or issue can be complete, a final review should take place.  For very simple issues, this may not always be necessary.  This final review process does not block _tasks_ but will block _features_ or _stories_.  It looks at the entire set of changes involved in a story or issue in order to give a final approval and check for any anti-patterns, etc.

For this final review, we use a draft PR that is a diff between the head of the branch and the parent commit of the branch.  All changes from the beginning will be included.  To create this diff, create a temporary "review branch" from the parent commit and then bring up a draft PR pointing at it from the feature branch.  After bringing up the draft PR, delete the temporary branch.  For convenience, we have a script that will do this automatically, `raise-review-pr.sh`.  

Generally the person tagged for final review should be the maintainer of the repo.  There may be the need to iterate several times.  The final review finishes when the reviewer gives a LGTM.  If the rest of the review process is functioning well, then this review should be quick and easy.  If not, then the maintainer may need to help other reviewers to improve their process.

Along with final reviews, occasionally it might be advisable to do a "progressive" review which includes all changes while the feature is still being developed.  A progressive review follows the same pattern using a draft PR.   

_Note, why we are using a draft PR between the HEAD and parent of the branch:  Using a standard PR would not reflect changes that have been going on for a while and getting merged.  By cutting a temporary branch from the original parent commit of the branch and raising a draft PR from the HEAD to that branch, we can get a diff of all the changes that have been made._

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

## Git history

History should be orderly and neat.  It should be organized in a way that makes it easy for a reviewer to understand the changes.  

Generally speaking, each commit should be as small as possible and reasonable, and represent a complete change that can be reviewed independently. In any case, _always think about the reviewer_ and do to others as you would like to have them to do you.

As a final note, if you do not understand git well then you _must_ ask questions and learn how to use it properly.  It can be a bit difficult to understand sometimes; we've all been there.  Simply guessing will result in a mess and is not a good idea.

The [next section](#conventional-commits) will give you some guidance on how to structure your commit messages.

### Conventional commits

We officially use [conventional commits](https://www.conventionalcommits.org/en/v1.0.0/) to standardize the commit messages and commit hooks are in place in each repo to assist with compliance to the standard.  Here is a [handy cheat sheet](https://gist.github.com/qoomon/5dfcdf8eec66a051ecd85625518cfd13) to help you.

A brief summary: 

* Use `fix:` for a fix that does not add a feature (patch)
* Use `feat:` for a feature that does not break anything (minor)
* Use `refactor:` for refactoring that does not add a feature or fix a bug
* Use `docs:` for anything that purely changes documentation
* Use `chore:` for other things that are not code related and that should not result in a version up.
* Use the exclamation point for breaking changes.  For example `feat!:`

#### How conventional commits play with CI/CD and continuously merging small changes.  

You might have a question about how convention commits work with CI/CD.  After all, we are merging changes that are not yet complete and should not yet be used even though they may get published in the packages as part of the merging process.  Just keep it simple and think in terms of the _public interface_.  In most cases, this resolves any confusion.  For example, let's say you are working on a new method of an existing interface.  When you first add the method, maybe the implementation throws a `NotImplemented` exception.  This gets committed and merged and makes it's way into `master`.  Perhaps you will supply the implementation in the _next_ PR and merge.  _When should you use `feat:`?  With the first commit and merge or with the second one, when the feature is actually complete?_

With the first commit, you are making a change to the **interface** that the code exposes.  This is a feature.  Even though the implementation is not complete, the public interface now exposes it.  So you should use `feat:` in the first commit.  The second commit is a "fix", since technically the feature was not fully working before.  So you should use `fix:` for the second one.  This is the general rule.  If you are not sure, ask someone until it becomes natural.

Common sense then becomes the guide as to when to update a consuming project for the one you are working on.  If the change is not yet complete, then the consuming project should not be updated.  If the change is complete, then the consuming project should be updated to whatever version number has all the changes.  Assuming you follow the rule to **never break anything existing** (at least, not breaking without being explicit about what is happening), then any project that picks up a new version with a feature in progress will not break. 

#### What about breaking changes that are part of a feature that is not yet complete?

##### For Branches Not Yet Merged:

1. **Committing a Breaking Change in a Feature Branch:**
   - Since the branch has not been merged yet, and you are working on an ongoing feature, you don't need to signal a breaking change explicitly in the context of the feature branch. 
   - Continue to use `feat:` for your new features. 
   - When introducing a breaking change within this same branch, it's not necessary to use `feat!:` or `fix!:` because the changes are contained within the branch and not yet visible to `master`.

   **Example:**
   - Initial commit: `feat: add new authentication module`
   - Breaking change commit: `feat: update authentication module to use OAuth2`

   When you squash and merge this branch, the breaking change will be included in the single `feat:` commit.

##### For Features Already in Master but Dark:

2. **Breaking Changes to Dark Features in Master:**
   - When a feature has been merged into `master` and is dark (not yet used), and you later introduce a breaking change to it, you should still follow the conventions to signal the breaking change.
   - In this case, since the feature is already in `master`, use `fix!` to indicate the breaking change. This helps maintain transparency and adherence to conventional commit messages, ensuring that any changes that might affect other developers or the CI/CD process are properly documented.

   **Example:**
   - Feature merged to master: `feat: add new authentication module`
   - Breaking change commit: `fix!: update authentication module to use OAuth2`

##### Summary:

- **Unmerged Branch:** Use `feat:` for new features and include any breaking changes within that context without special notation. Squash merging will combine these into a single `feat:` commit.
- **Dark Feature in Master:** Use `fix!:` to indicate the breaking change, even if the feature is dark, ensuring proper documentation and adherence to conventional commits.

By following these guidelines, you maintain clarity and consistency in your commit history, making it easier for others to understand the context and impact of changes.

## Exploratory or experimental work

There are times when it may be necessary to do some exploratory work or other work where you do not want the git hooks to run.  This might be work that is not directly related to a story or issue, perhaps to  understand a problem or to try out a solution.  Or it may be other work that you do not intend to be a part of the official commit history.  In such cases, you should use a branch that is prefixed with `exploratory-`.  Other prefixes could be `wip-` or `tmp-`.  

### Skipping Git Hooks

For a Single Command
Most Git commands include a -n/--no-verify option to skip hooks:

`git commit -m "..." -n # Skips Git hooks`

For commands without this flag, disable hooks temporarily with HUSKY=0:

`HUSKY=0 git ... # Temporarily disables all Git hooks`

To disable hooks for an extended period (e.g., during rebase/merge):

```
export HUSKY=0 # Disables all Git hooks
git ...
git ...
unset HUSKY # Re-enables hooks
```

Disabling commit hooks allows you to work freely without the constraints they impose.  However, you should still commit often and write good commit messages.  When you are done with the exploratory work, you can merge it into a branch that is subject to the commit hooks.  This will allow you to clean up the history and make it presentable.

## Feature flags

By merging often, changes will make their way into `master` and be shipped often long before they are fully ready.  As long as nothing is broken by code in `master`, this is not a problem.  However, sometimes it is necessary to ship code will make changes that a user would see if nothing was otherwise done.  This is where feature flags come in.

Feature flags are a set of configurable values that allow code to make a branching decision.  When the feature flag is _disabled_, the code will continue to execute along the previous (deprecated) path.  When the feature flag is _enabled_, the code will execute along the new path.  This allows code to be shipped "dark" and then turned on when it is ready.  It also allows for A/B testing and other types of experimentation.

## Daily meetings

There is usually at least one meeting per day when the team will work together for a period of time.  This is an ideal time to look at reviews that have been waiting.  It is also a good time for the team lead to do ["pulse" reviews](#pulse-reviews).  If something is noticed that should be discussed, the team is all there.  The reviewer can bring up quick issues right on the call, or else schedule another conversation later. 

## Leave your ego at the door

It can be hard to have someone critique code that we have poured our heart into writing.  A sense of craftsmanship will often bring along with it a passion for the work.  That is fine.  But we have to be ready to accept even outright criticism of our code without getting offended.  Comments in PR's should never be insulting, but they can be direct and to the point.  This means that all contributors must be honest and leave their egos out of it.

## See also

* [Coding standards](./Coding-standards.md)
