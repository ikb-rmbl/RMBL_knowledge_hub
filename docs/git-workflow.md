# Git workflow — RMBL Knowledge Hub

Patterns for branching, stacking, and merging on this repo. Distilled from the v0.9 → v0.11 stories arc where stacked PRs caused base-branch auto-closure and rebase pain.

## Branch off main, merge to main

- **Always branch from `main`.** Never commit directly to `main`.
- **Open PRs against `main`** by default. Squash-merge.
- **End commits** with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` when Claude pair-programmed.
- **End PR bodies** with the Claude Code tagline when Claude authored the PR.

## One PR per craft arc, not per spec micro-version

When iterating rapidly on a single artifact — a spec section, a prompt, a script's prose — keep adding commits to the same branch. Open one PR. Amend the PR description as the work evolves.

A spec moving v0.9 → v0.10 → v0.11 in one afternoon is one craft arc. It is not three PRs.

**Signal that you've moved to a new arc** (and so should open a new branch + PR):
- The work changes character: new feature, new file, different scope.
- The first arc landed and you're starting from a clean main.
- A reviewer is partway through and a parallel slice has become independent.

When you're inside a single arc, the iterations are bookkeeping, not review checkpoints. The spec's own revision log captures the evolution. The squashed commit message captures the arc's identity.

## When stacking is genuinely needed

Sometimes stacks are right: two independently reviewable slices, parallel work where waiting is wasteful, a long-running base that descendants need to build on. When you do stack:

1. **Squash earlier commits before opening the dependent PR.** Each branch in the stack should have exactly one logical commit. Reviewer can read a branch's diff against its base as the spec delta.
2. **Retarget descendants *before* merging the base.** Otherwise the base branch gets deleted on squash-merge and GitHub auto-closes the descendant.

   ```bash
   # Before merging the base:
   gh pr edit <descendant> --base main
   git rebase --onto main <old-base-branch> <descendant-branch>
   git push --force-with-lease

   # Then merge the original base.
   ```

3. **Keep "delete head branches on squash-merge" enabled** for the repo as a default — but for stack roots, either disable it on that specific PR before merging, or do step 2 first so descendants no longer depend on the soon-to-be-deleted base.

## Reconciling an accidental stack into a single PR

You will sometimes notice mid-iteration that what you opened as three PRs is really one craft arc. Collapse rather than dance:

```bash
# All three branches descend from main with N total commits between them.
# The leaf branch already contains every commit in the stack.

git switch <leaf-branch>
gh pr edit <leaf-PR> --base main      # retarget — usually just works
gh pr edit <leaf-PR> --title "<unified-arc title>" --body "<unified description>"

# Close the intermediate PRs with a redirect note:
gh pr close <intermediate-PR-1> --comment "Collapsed into <leaf-PR>."
gh pr close <intermediate-PR-2> --comment "Collapsed into <leaf-PR>."
```

The leaf branch already has every commit in the stack, so no rebase is needed if main hasn't moved.

If main *has* moved since the bottom of your stack was branched:

```bash
git rebase main <leaf-branch>      # replays the stack's commits on top of new main
git push --force-with-lease
```

## Force-push hygiene

- Always use `--force-with-lease`, not `--force`. Protects against silently overwriting a teammate's push.
- After a force-push, mention it in the PR thread if anyone has reviewed prior commits — the inline comments may now point at deleted SHAs.

## Why this works for this repo

One developer + LLM pair-programming. Review is gated through the same person who's writing. Multi-version spec iteration is normal. The cost of an accidental stack is real (rebases, force-pushes, auto-closures) but easy to avoid by treating "one arc = one branch" as the default and stacking only on explicit signal.
