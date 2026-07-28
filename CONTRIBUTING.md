# Contributing

## Setup

```bash
pnpm install
pnpm dev
```

This prepares the module stub and starts the playground app at `playground/`.

## Checks

```bash
pnpm lint
pnpm test
pnpm test:types
```

These run in CI on every PR and must pass before merge.

## Commit Message Format

This project follows the [Conventional Commits](https://www.conventionalcommits.org/) specification. All commit messages should be structured as follows:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types

- **feat**: A new feature
- **fix**: A bug fix
- **docs**: Documentation only changes
- **style**: Changes that do not affect the meaning of the code (white-space, formatting, etc)
- **refactor**: A code change that neither fixes a bug nor adds a feature
- **perf**: A code change that improves performance
- **test**: Adding missing tests or correcting existing tests
- **chore**: Changes to the build process or auxiliary tools and libraries

### Scopes

- **core**: Core functionality
- **types**: TypeScript type definitions
- **docs**: Documentation
- **deps**: Dependencies

### Examples

```bash
feat(core): add support for custom socket.io configuration
fix(realtime): resolve subscription memory leak on unmount
docs(readme): update implementation guide with examples
chore(deps): upgrade socket.io to v4.6.0
```
