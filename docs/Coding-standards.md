# Coding standards

This section is not trying to be an exhaustive list of rules regarding coding.  Each contributor must have good sense about the code he/she contributes.  Rather, these are to be understood as some general rules-of-thumb that should be practiced.  It can also serve as a sort of a checklist when reviewing PRs.  There may be cases when a contributor might choose to decline to apply one or more of these.  In such a case though, he/she should be prepared to vigorously defend that position and explain why it is necessary.

If there were just two common guiding principles around standards, they would be:

1) _Readability_: Code is meant to be read by humans.

> “Indeed, the ratio of time spent reading versus writing is well over 10 to 1. We are constantly reading old code as part of the effort to write new code. ...[Therefore,] making it easy to read makes it easier to write.”
― Robert C. Martin, Clean Code: A Handbook of Agile Software Craftsmanship

2) _Testability_: Code that is fully testable is generally _good_ code for two reasons:  the same principles that make code testable tend to make it high quality and code that is testable will naturally be better because tests will catch bugs.

> "Always code as if the guy who ends up maintaining your code will be a violent psychopath who knows where you live."
― Martin Golding

## General formatting

### .cs file headers

* Place the namespace declaration on the very first line of a .cs file.
* Usings follow next, starting on the third line
* Significant code should follow the usings, with a single line of separation.

Please note that by default, vs code likes to put the namespace _after_ the usings.  You may have to move things.

### Separation

* In most cases when things need to be separated, use a _single blank line_.
* If you need to mark off a section of code within a method, use a comment and optionally an H2 single line `// ------------- `.  Use the extension to insert it so that it remains consistent.  Be selective about when you do this.
```
    var someVal = "";
    var formatted = formatter.Format(p);

    // -------------------------------------------------------------------

    var response = client.DoSomethingInteresting(formatted);
    ...
```
* If you need to mark off a section of declarations (like a section of methods), then use an H1 comment `// ========`.  This should have a simple description to help the reader understand what follows.
```
    // ===================================================================
    // Interesting method implementations
    // ===================================================================
    public void SomeInterestingMethod(string val)
    {
        ...
    }

    public void SomeOtherInterestingMethod(string val)
    {
        ...
```

### Method signatures and long parameter lists

* Method signatures should have the standard placement of keywords.
* No space should be used between the method name and the paren, or between the paren and the arguments.
* Long lists of parameters are hard to read.  If a method signature requires scrolling horizontally, then put a new line after the opening paren and then put each argument on a separate line.
```
    public async Task MyMethod(string rawData);

    public async Task MyMethod(
        string rawData,
        FormattingOptions options = null,
        IFormatter formatter = null
    );
```

### Brace and parenthesis placement

* Curly braces should generally be placed on the following line per the C# standards. However, if curly braces (or parens, etc) end up on a series of lines all by themselves, it's better to combine them into one line.   Use common sense with this.
```
    try
    {
        ...
    }
    catch
    {
        ...
    }


    void DoAction(new Request
    {
        ...
    });
```

* When code forms a block that is dependent on a statement or keyword, _always_ use curly braces.  Do not depend on the compiler implicitly interpreting code blocks.

For example, this:
```
    if (condition)
    {
        Console.Write(".....");
    }
```

_not_ this:

```
    if (condition)
        Console.Write(".....");
```
* If a code block is one short line and doing so makes code more readable, you can include it on the same line.
```
    if (condition) { Console.Write("....."); }
```

## Comments and Documentation

* Comments should be used judiciously.  They should generally explain _why_ something is being done, not _how_ it is being done.  If there is a need to explain _how_ code works, then it probably needs to be refactored.
* Think about the reader.  What would you like commented if you were looking at this code for the first time?
* Generally, _all_ interface members and _most_ public members should be documented with the standard `/// <summary>` notation.  The notes made should give the caller hints about how to consume the code.
* Each project (library or service) should have a README that gives a high-level understanding of the purpose of the project and how it is implemented.
* See [Separation](#separation) for info on how to use comment blocks to separate sections of code.

## Patterns and Best Practices

### DRY vs WET

* Generally we prefer DRY (Don't Repeat Yourself) over WET (Write Every Time).  In other words, if code is used repeatedly, it is better to factor it into a common place so that it only exists once.
* What are some factors that would make us prefer WET in a given case?
    * Code that is extremely simple may not be worth the trouble of centralizing.
    * Code that is likely to change and possibly break consumers might need to stay separate.  In other words, if there is the possibility that code will diverge along different evolutionary paths.
    * Code that addresses fundamentally _different use cases_ even if it is similar at the moment is much more likely to evolve along different paths, and therefore is likely a candidate for centralizing in multiple places or else maintained as WET.
* A strong argument in favor of DRY (when there are no other factors to consider) is that tests do not need to be repeated over and over again for each case that code appears when WET.
* When deciding _where_ to put DRY code, common sense must be used.  If the use cases for a given piece of code are confined to a particular domain, obviously the code should be placed in that domain.
* The most important guiding principle of DRY versus WET is simplicity.  Which way makes the code easier to understand?  Even though we favor DRY, if making code DRY makes it harder to follow, go with the path that makes life easier for the reader.

### Naming

* Names are part of how code is implicitly documented, and should assist the reader in acquiring context for understanding the code.
* Names of things should always be descriptive, but never noisy.
* Names of methods should describe what they do, not how they are implemented.
* Names of variables should describe their purpose
* Names of classes and interfaces should describe their purpose and can reference the pattern they follow.  Example:  `IDbAdaptor`, `IEventListener`
* When a variable is not being used, use the discard name `_` where possible.
* Do not submit code with spelling errors.

### Literals

* Prefer using constants and avoid magic literals.
    * The name of the constant serves to help understand the semantic meaning of the literal.
    * Constants help avoid mistakes in typing.

### Dependencies on interfaces versus concrete classes

* When one class has dependencies on another, strongly prefer interfaces instead of concrete classes. This promotes loose coupling and aids greatly in testability.
* Compose dependencies using injection
* Favor the use of factories (Factory pattern) rather than `new`.  This helps avoid coupling to concrete classes.  If you are doing a `new` and not in the process of composing a class or a test, then question if there is a design problem.
    * An explicit factory is a good option in many cases.  Another possibly acceptable option for a fast implementation might be a static factory method.

### S.O.L.I.D

* The principles of S.O.L.I.D. have stood the test of time.  SOLID should be a part of the DNA of the code.  We are not going to review them in detail here (you should know them well already), but as a quick bullet list:
    * [Single Purpose](https://stackify.com/solid-design-principles/):  Each class or method should have only one purpose, and therefore only one reason to change.
    * [Open/Closed](https://stackify.com/solid-design-open-closed-principle/):  Code design should prefer extension rather than change.
    * [Liskov Substitution Principle](https://stackify.com/solid-design-liskov-substitution-principle/): Subclasses should never implement functionality that redefines (or breaks) the superclass.
    * [Interface Segregation](https://stackify.com/interface-segregation-principle/):  Only provide as much functionality as is needed in an interface, and nothing should be forced to depend upon interfaces that it does not use.
    * [Dependency Inversion](https://stackify.com/dependency-inversion-principle/):  Provide dependencies by way of composition.  High-level modules, which provide complex logic, should be easily reusable and unaffected by changes in low-level modules,

### Async versus Sync

* Prefer `async` code over sync code.  Writing `async` code allows the runtime to optimize execution in ways that are basically free, and will result in more performant code.
* `async` tends to promote more `async`; that is, it tends to spread.  There is no way to avoid it, therefore embrace it. (There are arguments that could be made that `async/await` is a bad pattern from the start.  Languages like Go have implemented other ways to handle this use case.  We don't care.  This is what we have to work with and no philosophical debate will change that.  It is really only problematic if you use bad practices.)
* The transition from sync to async is dangerous.  That is, if you have sync code that calls async code.
    * Avoid this type of transition if possible.
    * If not possible, use the [provided methods](../core/OMSNIC.Services.Core.Common/Util/TaskUtil.cs) which are tested and found to work in order to handle it.

### Explicitly implement interface members

Prefer explicit implementations of interface members.  For example

This is preferable ...
```
class MyClass : IMyInterface
{
    int IMyInterface.SomeMethod(string str)
    {
        ...

```
Rather than this ...
```
class MyClass : IMyInterface
{
    public int SomeMethod(string str)
    {
        ...
```

Why is this generally a good idea?
* Prevents accidental coupling to the concrete class, because the interface members are only available when referencing the object as the interface.  Likewise, it prevents accidentally coupling to members of other interfaces.
* Allows for proper segregation of functionality by interface and avoids crossing use cases with a member that has the same signature in different interfaces.

### Design patterns

Design patterns can help greatly when reasoning on code, because they provide a predefined solution to a problem that is already (and separately) understood.  But keep in mind that not all design patterns are created equal.  The [Repository Pattern](https://lostechies.com/derekgreer/2018/02/20/ditch-the-repository-pattern-already/) was widely used at one point, and is now considered by some to be an anti-pattern.

* Prefer the use of design patterns in the following situations:
    * When they fit the problem
    * When the pattern in question is currently considered best practice.
    * When they simplify understanding the code
* When using less common patterns, include a link to a reference about it in comments.

## Control complexity

There are various types of complexity.
* On a design and implementation level, some complexity is necessary, and some is not ([essential versus accidental](https://www.nutshell.com/blog/accidental-complexity-software-design)).  There are a whole lot of interesting articles on the subject.  It takes a concerted effort to maintain accidental complexity to a minimum.
* [NPath and cyclomatic complexity](https://www.axelerant.com/blog/reducing-cyclomatic-complexity-and-npath-complexity-steps-for-refactoring) have to do with how many branches and paths of execution code can take.  The code coverage tool will analyze this type of complexity and warn about areas of concern.  To keep this type of complexity in check...
    * Keep if/else statements to a minimum
    * Keep methods small

The [coverage report](./How-to-build-and-test.md#coverage-report) will help you to understand where there is potential complexity.  Do not ignore any indications that you may need to refactor.

## Noise

Various things can create "noise" in code; that is, things that break the concentration of the reader or interfere with his/her ability to reason on code.  "Clean" code is code with a low level of noise.

A few examples of things to avoid:

* Do not ignore compiler warnings.  In the best case they create noise and in the worst they could be telling you about real problems in your code.  Resolve them, or if they are truly unhelpful, explicitly add a directive to suppress them, with an explanation as to why.
* Do not leave spelling errors in code.  Use the extension provided in the dev container to find spelling errors and fix them.  If they are intentional, then add them to the list of ignored words in the workspace settings.
* Keep formatting consistent.
* Do not include unnecessary comments.
* Do not make names excessively long or wordy.
* Generally speaking, remove any methods or variables that are not used.
* Generally speaking, avoid commenting out code and committing it that way.  Delete it.

## Tests

Tests are an _extremely_ important part of creating quality code, at the same time as tests themselves need to be quality code.  It is expected that a large part of a given development effort will be in writing unit tests.  Tests will sometimes take more development time than writing the main body of code for the project.  At the same time, tests are not a substitute for common sense.  Testing based on a bad interpretation of requirements for example will produce code that passes tests and yet does not accomplish it's goal.

The standard for [test coverage is 100%](./How-to-build-and-test.md#100-code-coverage).  See the [section on building and testing](./How-to-build-and-test.md) for more information on how to test.

In the context of coding standards ...

* When writing an interface for code that will do significant work and will need to be stubbed for code that depends on it, it is a kindness to write a test class that implements the interface in a testing context to help with stubbing and assertions.
* Test names should be significant and should describe what the test is trying to prove.
* Tests should use the [AAA pattern](./How-to-build-and-test.md#aaa-pattern-for-tests) for tests to make them easier to read.
* Remember that tests are code also, so all the same code standards apply.  (WET versus DRY, constants, etc)
