# Architectural Change Guide

How to approach significant architectural changes to an existing codebase. High-stakes work — redesigning a running system without breaking it.

## Your Role

1. **Understand deeply before proposing changes**: Architectural changes fail when the current system isn't fully understood
2. **Maintain AI_Progress.md**: Create this in the target repo's feature branch to track findings, decisions, and rationale
3. **Work in phases**: Never jump to migration before the target design is approved
4. **Preserve the safety net**: Tests must pass at every step; track test count as a health metric

---

## How to Engage

### Phase 0: Understand the Current State

Before ANY code changes, build a complete picture:

#### 1. Restate the Problem

- Summarize the architectural issue in your own words
- Identify the category: overloaded abstraction, improper separation, concept leakage, outgrown model, wrong mechanism, or naming mismatch
- Confirm your understanding with the human

#### 2. Map the Affected Components

Create a table in AI_Progress.md:

```markdown
## Affected Components

| Component | Role | Why Affected |
|-----------|------|--------------|
| [Interface.cs] | Defines the problematic pattern | Core of the issue |
| [Impl1.cs] | Implements the pattern | Must change when interface changes |
| [Consumer.cs] | Uses the pattern | Must migrate to new pattern |
```

#### 3. Understand the Constraints

Ask for and document:

- Can we make a clean break, or must we maintain backward compatibility?
- What's the test baseline? (e.g., "897 tests, all passing")
- Are there serialized formats (database, messages) affected?
- What timeline and risk tolerance exists?

#### 4. Identify the "Why"

Document in AI_Progress.md:

- Why did the current design seem right originally?
- What changed (requirements, scale, understanding) that made it problematic?
- What symptoms reveal the problem? (boilerplate, null-checks, confusion, bugs)

### Phase A: Design the Target State

#### 1. Propose the New Architecture

Present the target design clearly:

- New abstractions (interfaces, base classes, types)
- How they differ from current ones
- Key design decisions and their rationale

#### 2. Show Before/After

```markdown
## Design Comparison

### Before (Current)

[Code snippet showing the problematic pattern]

### After (Proposed)

[Code snippet showing the clean pattern]
```

#### 3. Identify Migration Path

- Which files will be created?
- Which files will be modified?
- Which files will be deleted?
- What order must changes happen in?

#### 4. Wait for Approval

Do not proceed to implementation until the human approves the design.

### Phase B: Additive Changes (Create New Alongside Old)

**Principle**: Create before delete

1. Create new abstractions (interfaces, base classes) in new files
2. Implement any new infrastructure
3. Add tests for new abstractions
4. **Do not modify or delete existing code yet**

At the end of this phase:

- New pattern exists and is tested
- Old pattern still works
- All tests pass

Update AI_Progress.md:

```markdown
## Phase B Complete

- Created: [list new files]
- Tests added: X new tests
- Test baseline: Was 897, now 905
- Both patterns coexist
```

### Phase C: Migration

**For Clean Break (all consumers can change atomically):**

1. Plan the atomic migration commit
2. List every file that will change
3. Propose the migration in one reviewable batch:
   - Update all consumers to use new pattern
   - Delete old abstractions
   - Update affected tests
4. Execute as single commit

**For Gradual Migration (backward compatibility required):**

1. Create adapter layer if needed
2. Migrate consumers incrementally:
   - Migrate one consumer
   - Test
   - Commit
   - Repeat
3. Track migration progress in AI_Progress.md
4. Plan deprecation timeline for old pattern

#### Migration Notes Pattern

For significant interface changes, document the migration pattern:

```markdown
## Migration Notes

**Before:**

[Code showing old usage]

**After:**

[Code showing new usage]
```

### Phase D: Cleanup

1. Remove any temporary compatibility layers
2. Delete deprecated code that was kept for transition
3. Update or remove obsolete tests
4. Final test count confirmation
5. **Delete AI_Progress.md before merge**

---

## Key Principles for Architectural Changes

### 1. Never Break the Build Mid-Phase

Each commit must:

- Compile successfully
- Pass all tests
- Be independently revertible

### 2. Tests Are First-Class

- Track test count throughout (started: X → current: Y)
- If tests need to change, explain why
- Consider creating test helpers for new patterns

### 3. Document Decisions

In AI_Progress.md and commit messages, explain:

- What changed
- Why this approach was chosen
- What alternatives were considered

### 4. Interface Segregation

When splitting a monolithic interface:

- Identify natural groupings of methods
- Create focused interfaces for each group
- Consider which implementations need which interfaces
- Use composition over inheritance where sensible

### 5. Abstract Base Classes for Optional Overrides

When replacing delegate-based flexibility:

- Use abstract methods for required operations
- Use virtual methods with sensible defaults for optional operations
- This gives "override what you need" without null-checking

---

## Common Architectural Patterns

### Pattern: Overloaded DTO → Specialized Types

**Before:**

```csharp
public class EntityEnvelope {
    public string? Id { get; set; }
    public byte[]? Content { get; set; }  // Used by sync, not by events
}
```

**After:**

```csharp
// For events (lightweight)
public class EventEntityReference {
    public required string Id { get; init; }
    public required ulong ChangeLevel { get; init; }
}

// For sync (full content)
public class EntityEnvelope {
    public string? Id { get; set; }
    public byte[]? Content { get; set; }
}
```

### Pattern: Delegate Interface → Abstract Base Class

**Before:**

```csharp
public interface IHandlers<T> {
    DoSomething_Handler<T>? DoSomething { get; }  // Nullable delegate
}
// Every caller: handlers.DoSomething?.Invoke(...)
```

**After:**

```csharp
public abstract class HandlersBase<T> {
    public abstract Task DoRequired(Context ctx);  // Must implement
    public virtual Task DoOptional(Context ctx) => Task.CompletedTask;  // Override if needed
}
// Callers: handlers.DoRequired(ctx)
```

### Pattern: Coupled Concerns → Explicit Composition

**Before:**

```csharp
public interface ISyncDescriptor {
    IReadOnlyCollection<IEventDescriptor> ConsumesEvents { get; }  // Hidden coupling
}

await AddSync(descriptor);  // Secretly subscribes to events too!
```

**After:**

```csharp
public interface ISyncDescriptor {
    // No event configuration
}

await AddSync(descriptor);  // Only adds sync
await SubscribeToEvent(event, handler);  // Explicit event subscription
```

### Pattern: Outgrown Model → Type Hierarchy

**Before:**

```csharp
public class User {
    public string? FirstName { get; set; }  // Null for process actors
    public string? Password { get; set; }   // Null for process actors
    public bool IsProcess { get; set; }     // Type flag!
}
```

**After:**

```csharp
public abstract class Actor {
    public required string Id { get; init; }
}

public class HumanUser : Actor {
    public required string FirstName { get; init; }
    public required string Password { get; init; }
}

public class ProcessActor : Actor {
    public required string ServiceName { get; init; }
}
```

---

## AI_Progress.md Template

```markdown
# AI Progress: [Architectural Change Name]

## Problem Summary

[One paragraph describing the issue]

## Affected Components

| Component | Role | Impact |
|-----------|------|--------|
| | | |

## Constraints

- Breaking change allowed: Yes/No
- Test baseline: X tests passing
- Serialization concerns: None / [details]
- Timeline: [details]

## Target Design

[Description of proposed solution]

### Before/After Comparison

[Code snippets]

## Phase Progress

### Phase B: Additive Changes

- [ ] Created new abstractions
- [ ] Added tests
- Test count: X → Y

### Phase C: Migration

- [ ] Migrated consumer 1
- [ ] Migrated consumer 2
- [ ] Deleted old code
- Test count: Y → Z

### Phase D: Cleanup

- [ ] Removed compatibility layers
- [ ] Final verification
- [ ] Ready to delete this file

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| | | |

## Open Questions

- [ ] [Question 1]
```

---

## When You're Stuck

1. **Too many affected files?** Consider whether the scope is too large — break into smaller changes
2. **Unclear migration path?** Map dependencies to find the right order
3. **Tests failing unexpectedly?** This often reveals hidden coupling you didn't know about
4. **Human seems uncertain?** Pause and ask clarifying questions before proceeding

---

## Final Checklist Before Merge

- [ ] All tests pass
- [ ] Test count is tracked (before → after)
- [ ] No temporary compatibility code left behind
- [ ] Commit messages explain the "why"
- [ ] AI_Progress.md is deleted
- [ ] New patterns are consistent with existing codebase style
