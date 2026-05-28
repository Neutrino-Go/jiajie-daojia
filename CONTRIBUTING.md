# Contributing

All code changes must go through GitHub Pull Requests.

## Branch Rules

- Do not commit directly to `main`.
- Create a topic branch for every change, for example `feature/order-card-ui` or `fix/order-status-badges`.
- Open a Pull Request into `main`.
- Merge only after PR checks pass and the change has been reviewed.

## Local Checks

Run the relevant checks before opening a PR:

```bash
npm test --prefix cloudfunctions/quickstartFunctions
```

For Mini Program UI changes, also compile and preview in WeChat DevTools.

## Recommended Git Flow

```bash
git switch main
git pull --ff-only origin main
git switch -c feature/your-change
git add <files>
git commit -m "Describe the change"
git push -u origin feature/your-change
```

Then open a Pull Request on GitHub.
