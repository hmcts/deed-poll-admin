# Create a PR

- Ensure you're on an appropriate branch, if not create a new branch
- Extract issue number from branch name (format: `feature/<issue-number>-description`)
- Check that the progress is updated in `docs/tickets/<issue-number>/tasks.md` if there are no relevant items in the file, don't add them
- Update the `docs/ARCHITECTURE.md` for any MAJOR architectural changes made in this branch. Only do it if necessary
- Add an ADR in `docs/adr/` for any MAJOR architectural changes made in this branch. Only do it if necessary
- If you have been working off a specification in a `docs/tickets/<issue-number>/specification.md`:
  - create a summary of the context and conversation in `docs/tickets/<issue-number>/prompts.md` - remove any sensitive information or profanity
  - update the `docs/tickets/<issue-number>/specification.md` with any relevant changes
  - update the `docs/tickets/<issue-number>/tasks.md` with any relevant changes
- Commit the changes with a clear message
- Create the PR with a clear title and description linking to the GitHub issue (e.g., "Fixes #<issue-number>"). If a PR already exists, update it with the latest changes.
